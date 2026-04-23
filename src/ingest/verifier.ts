// ============================================================================
// File: src/ingest/verifier.ts
// Version: 1.0-hf-ingest-verifier-v1 | 2026-03-06
// Purpose:
//   Verify ingest bundles / receipts and optionally verify file-set material
//   against a local directory.
// Notes:
//   - Uses runtime validation for safety.
//   - Keeps verification offline/local-first when root_dir is supplied.
//   - Local material verification is intentionally limited to file_set inputs.
// ============================================================================

import { ingestBundleDigest, ingestFingerprint, ingestIdempotencyKey } from "./bundle.js";
import { merkleRootFromItems } from "./merkle.js";
import { executeIngest } from "./execute.js";
import { IngestError } from "./errors.js";
import {
  parseIngestBundleV1,
  parseIngestReceiptV1,
} from "./validators.js";
import { hashJsonDigest } from "../hashing/contract.js";
import type { IngestBundleV1, IngestIdentity, IngestInput, IngestResult } from "./types.js";
import type { IngestReceiptV1 } from "./receipt.js";

export type IngestVerifyMismatch = Readonly<{
  field: string;
  expected: unknown;
  actual: unknown;
}>;

export type IngestVerifyResult = Readonly<{
  ok: boolean;
  mismatches: ReadonlyArray<IngestVerifyMismatch>;
  computed?: Readonly<Record<string, unknown>>;
}>;

function mismatch(field: string, expected: unknown, actual: unknown): IngestVerifyMismatch {
  return Object.freeze({ field, expected, actual });
}

function recomputeReceiptId(receipt: IngestReceiptV1): string {
  const { receipt_id: _discard, ...body } = receipt as Record<string, unknown>;
  return hashJsonDigest({
    domain: "va:ingest:receipt:v1",
    value: body,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

function sumItemBytes(bundle: IngestBundleV1): number {
  let total = 0;
  for (const item of bundle.items) {
    total += Number(item.bytes || 0);
  }
  return total;
}

export function verifyIngestBundle(bundle: unknown): IngestVerifyResult {
  const parsed = parseIngestBundleV1(bundle) as IngestBundleV1;
  const mismatches: IngestVerifyMismatch[] = [];

  const recomputedMerkle = parsed.merkle ? merkleRootFromItems(parsed.items) : undefined;
  const recomputedBundleDigest = ingestBundleDigest(parsed);
  const recomputedFingerprint = ingestFingerprint(parsed);
  const recomputedIdem = ingestIdempotencyKey(String(parsed.identity.object_key), recomputedFingerprint);
  const totalBytes = sumItemBytes(parsed);

  if (parsed.summary.item_count !== parsed.items.length) {
    mismatches.push(mismatch("summary.item_count", parsed.items.length, parsed.summary.item_count));
  }

  if (parsed.summary.total_bytes !== totalBytes) {
    mismatches.push(mismatch("summary.total_bytes", totalBytes, parsed.summary.total_bytes));
  }

  if (parsed.merkle) {
    if (parsed.merkle.leaf_count !== parsed.items.length) {
      mismatches.push(mismatch("merkle.leaf_count", parsed.items.length, parsed.merkle.leaf_count));
    }
    if (recomputedMerkle && parsed.merkle.root !== recomputedMerkle.root) {
      mismatches.push(mismatch("merkle.root", recomputedMerkle.root, parsed.merkle.root));
    }
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      bundle_digest: recomputedBundleDigest,
      fingerprint: recomputedFingerprint,
      idempotency_key: recomputedIdem,
      ...(recomputedMerkle ? { merkle_root: recomputedMerkle.root } : {}),
      item_count: parsed.items.length,
      total_bytes: totalBytes,
    }),
  });
}

export function verifyIngestReceipt(receipt: unknown): IngestVerifyResult {
  const parsed = parseIngestReceiptV1(receipt);
  const mismatches: IngestVerifyMismatch[] = [];

  const recomputedReceiptId = recomputeReceiptId(parsed);
  if (parsed.receipt_id !== recomputedReceiptId) {
    mismatches.push(mismatch("receipt_id", recomputedReceiptId, parsed.receipt_id));
  }

  const recomputedIdem = ingestIdempotencyKey(
    String(parsed.identity.object_key),
    String(parsed.evidence.fingerprint)
  );
  if (parsed.evidence.idempotency_key !== recomputedIdem) {
    mismatches.push(
      mismatch("evidence.idempotency_key", recomputedIdem, parsed.evidence.idempotency_key)
    );
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      receipt_id: recomputedReceiptId,
      idempotency_key: recomputedIdem,
    }),
  });
}

export function verifySubmittedIngestEvidence(opts: {
  identity: IngestIdentity;
  evidence: IngestResult;
}): IngestVerifyResult {
  const mismatches: IngestVerifyMismatch[] = [];
  const bundle = parseIngestBundleV1(opts.evidence.bundle) as IngestBundleV1;

  const bundleCheck = verifyIngestBundle(bundle);
  mismatches.push(...bundleCheck.mismatches);

  const recomputedBundleDigest = ingestBundleDigest(bundle);
  const recomputedFingerprint = ingestFingerprint(bundle);
  const recomputedMerkle = bundle.merkle ? merkleRootFromItems(bundle.items).root : undefined;
  const recomputedIdem = ingestIdempotencyKey(String(bundle.identity.object_key), recomputedFingerprint);

  if (opts.evidence.object_key !== opts.identity.object_key) {
    mismatches.push(
      mismatch("evidence.object_key", opts.identity.object_key, opts.evidence.object_key)
    );
  }

  if (opts.evidence.object_kind !== opts.identity.object_kind) {
    mismatches.push(
      mismatch("evidence.object_kind", opts.identity.object_kind, opts.evidence.object_kind)
    );
  }

  if (bundle.identity.object_key !== opts.identity.object_key) {
    mismatches.push(
      mismatch("bundle.identity.object_key", opts.identity.object_key, bundle.identity.object_key)
    );
  }

  if (bundle.identity.object_kind !== opts.identity.object_kind) {
    mismatches.push(
      mismatch("bundle.identity.object_kind", opts.identity.object_kind, bundle.identity.object_kind)
    );
  }

  if ((opts.identity.program ?? null) !== (bundle.identity.program ?? null)) {
    mismatches.push(
      mismatch("bundle.identity.program", opts.identity.program ?? null, bundle.identity.program ?? null)
    );
  }

  if ((opts.identity.version_label ?? null) !== (bundle.identity.version_label ?? null)) {
    mismatches.push(
      mismatch(
        "bundle.identity.version_label",
        opts.identity.version_label ?? null,
        bundle.identity.version_label ?? null
      )
    );
  }

  if (opts.evidence.bundle_digest !== recomputedBundleDigest) {
    mismatches.push(mismatch("evidence.bundle_digest", recomputedBundleDigest, opts.evidence.bundle_digest));
  }
  if (opts.evidence.fingerprint !== recomputedFingerprint) {
    mismatches.push(mismatch("evidence.fingerprint", recomputedFingerprint, opts.evidence.fingerprint));
  }
  if ((opts.evidence.merkle_root ?? null) !== (recomputedMerkle ?? null)) {
    mismatches.push(mismatch("evidence.merkle_root", recomputedMerkle ?? null, opts.evidence.merkle_root ?? null));
  }
  if (opts.evidence.idempotency_key !== recomputedIdem) {
    mismatches.push(mismatch("evidence.idempotency_key", recomputedIdem, opts.evidence.idempotency_key));
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      object_key: bundle.identity.object_key,
      object_kind: bundle.identity.object_kind,
      bundle_digest: recomputedBundleDigest,
      fingerprint: recomputedFingerprint,
      merkle_root: recomputedMerkle ?? null,
      idempotency_key: recomputedIdem,
      item_count: bundle.items.length,
      total_bytes: bundle.summary.total_bytes,
    }),
  });
}

export async function verifyIngestFileSetAgainstReceiptOrBundle(opts: {
  receipt?: unknown;
  bundle?: unknown;
  root_dir: string;
}): Promise<IngestVerifyResult> {
  const mismatches: IngestVerifyMismatch[] = [];

  const receipt = opts.receipt ? parseIngestReceiptV1(opts.receipt) : null;
  const bundle = opts.bundle ? (parseIngestBundleV1(opts.bundle) as IngestBundleV1) : null;

  const identity = receipt?.identity ?? bundle?.identity;
  const rules = (receipt?.rules ?? bundle?.rules) as IngestBundleV1["rules"] | undefined;

  if (!identity) {
    throw new IngestError("verify_requires_receipt_or_bundle", {
      code: "SCHEMA_INVALID",
      statusCode: 400,
    });
  }

  if (identity.object_kind !== "file_set") {
    throw new IngestError("verify_root_dir_requires_file_set", {
      code: "SCHEMA_INVALID",
      statusCode: 400,
    });
  }

  const localInput: IngestInput = Object.freeze({
    mode: "hash_only",
    identity: Object.freeze({
      object_key: String(identity.object_key),
      object_kind: "file_set",
      ...(identity.version_label != null ? { version_label: identity.version_label } : {}),
      ...(identity.program != null ? { program: identity.program } : {}),
    }),
    material: Object.freeze({
      kind: "file_set",
      root_dir: String(opts.root_dir),
      rules: Object.freeze({
        follow_symlinks: Boolean(rules?.follow_symlinks),
        redact_paths: Boolean(rules?.redact_paths),
        normalize_line_endings: Boolean(rules?.normalize_line_endings),
        ...(rules?.include_globs?.length ? { include_globs: Object.freeze(rules.include_globs.slice()) } : {}),
        ...(rules?.exclude_globs?.length ? { exclude_globs: Object.freeze(rules.exclude_globs.slice()) } : {}),
        ...(rules?.allowed_suffixes?.length ? { allowed_suffixes: Object.freeze(rules.allowed_suffixes.slice()) } : {}),
      }),
    }),
  });

  const local = await executeIngest(localInput);

  if (receipt) {
    if (local.fingerprint !== receipt.evidence.fingerprint) {
      mismatches.push(mismatch("evidence.fingerprint", local.fingerprint, receipt.evidence.fingerprint));
    }
    if (local.bundle_digest !== receipt.evidence.bundle_digest) {
      mismatches.push(mismatch("evidence.bundle_digest", local.bundle_digest, receipt.evidence.bundle_digest));
    }
    if ((local.merkle_root ?? null) !== (receipt.evidence.merkle_root ?? null)) {
      mismatches.push(mismatch("evidence.merkle_root", local.merkle_root ?? null, receipt.evidence.merkle_root ?? null));
    }
    if (local.idempotency_key !== receipt.evidence.idempotency_key) {
      mismatches.push(mismatch("evidence.idempotency_key", local.idempotency_key, receipt.evidence.idempotency_key));
    }
    if (Number(local.bundle.summary.item_count) !== Number(receipt.evidence.item_count)) {
      mismatches.push(mismatch("evidence.item_count", local.bundle.summary.item_count, receipt.evidence.item_count));
    }
    if (Number(local.bundle.summary.total_bytes) !== Number(receipt.evidence.total_bytes)) {
      mismatches.push(mismatch("evidence.total_bytes", local.bundle.summary.total_bytes, receipt.evidence.total_bytes));
    }
  }

  if (bundle) {
    const bundleCheck = verifyIngestBundle(bundle);
    mismatches.push(...bundleCheck.mismatches);

    const recomputedBundleDigest = ingestBundleDigest(bundle);
    const recomputedFingerprint = ingestFingerprint(bundle);
    const recomputedMerkle = bundle.merkle ? merkleRootFromItems(bundle.items) : undefined;

    if (local.bundle_digest !== recomputedBundleDigest) {
      mismatches.push(mismatch("local.bundle_digest", recomputedBundleDigest, local.bundle_digest));
    }
    if (local.fingerprint !== recomputedFingerprint) {
      mismatches.push(mismatch("local.fingerprint", recomputedFingerprint, local.fingerprint));
    }
    if ((local.merkle_root ?? null) !== (recomputedMerkle?.root ?? null)) {
      mismatches.push(mismatch("local.merkle_root", recomputedMerkle?.root ?? null, local.merkle_root ?? null));
    }
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      local_fingerprint: local.fingerprint,
      local_bundle_digest: local.bundle_digest,
      local_merkle_root: local.merkle_root ?? null,
      local_idempotency_key: local.idempotency_key,
      local_item_count: local.bundle.summary.item_count,
      local_total_bytes: local.bundle.summary.total_bytes,
    }),
  });
}