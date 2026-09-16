// ============================================================================
// File: src/datasets/verifier.ts
// Version: 1.0-hf-datasets-verifier-v1 | 2026-03-06
// Purpose:
//   Verify dataset bundles / receipts and optionally verify against a local directory.
// Notes:
//   - Uses runtime validation for safety.
//   - Keeps verification offline/local-first when root_dir is supplied.
// ============================================================================

import { bundleDigest, datasetFingerprint, idempotencyKey } from "./bundle.js";
import { merkleRoot } from "./merkle.js";
import { executeAnchor } from "./workflow.js";
import {
  parseDatasetBundleV1,
  parseDatasetReceiptV1,
  type DatasetReceiptV1,
} from "./validators.js";
import { hashJsonDigest } from "../hashing/contract.js";
import type { AnchorResult, DatasetIdentity, DatasetRules, DatasetBundleV1 } from "./types.js";

export type DatasetVerifyMismatch = Readonly<{
  field: string;
  expected: unknown;
  actual: unknown;
}>;

export type DatasetVerifyResult = Readonly<{
  ok: boolean;
  mismatches: ReadonlyArray<DatasetVerifyMismatch>;
  computed?: Readonly<Record<string, unknown>>;
}>;

function mismatch(field: string, expected: unknown, actual: unknown): DatasetVerifyMismatch {
  return Object.freeze({ field, expected, actual });
}

function recomputeReceiptId(receipt: DatasetReceiptV1): string {
  const { receipt_id: _discard, ...body } = receipt as any;
  return hashJsonDigest({
    domain: "va:dataset:receipt:v1",
    value: body,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

function toReplayRules(rules: unknown): DatasetRules | undefined {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return undefined;

  const src = rules as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (src.redact_paths !== undefined) out.redact_paths = Boolean(src.redact_paths);
  if (src.follow_symlinks !== undefined) out.follow_symlinks = Boolean(src.follow_symlinks);

  if (Array.isArray(src.include_globs)) out.include_globs = src.include_globs;
  if (Array.isArray(src.exclude_globs)) out.exclude_globs = src.exclude_globs;
  if (Array.isArray(src.allowed_suffixes)) out.allowed_suffixes = src.allowed_suffixes;

  if (src.max_files !== undefined) out.max_files = src.max_files;
  if (src.max_total_bytes !== undefined) out.max_total_bytes = src.max_total_bytes;
  if (src.max_single_file_bytes !== undefined) out.max_single_file_bytes = src.max_single_file_bytes;

  return Object.keys(out).length ? (Object.freeze(out) as DatasetRules) : undefined;
}

export function verifyDatasetBundle(bundle: unknown): DatasetVerifyResult {
  const parsed = parseDatasetBundleV1(bundle) as DatasetBundleV1;
  const mismatches: DatasetVerifyMismatch[] = [];

  const recomputedMerkle = merkleRoot(parsed.files as any);
  const recomputedBundleDigest = bundleDigest(parsed);
  const recomputedFingerprint = datasetFingerprint(parsed);
  const recomputedIdem = idempotencyKey(String(parsed.dataset_identity.dataset_key), recomputedFingerprint);

  const sumBytes = parsed.files.reduce((acc, f) => acc + Number((f as any).bytes || 0), 0);

  if (parsed.merkle.leaf_count !== parsed.files.length) {
    mismatches.push(mismatch("merkle.leaf_count", parsed.files.length, parsed.merkle.leaf_count));
  }
  if (parsed.merkle.root !== recomputedMerkle.root) {
    mismatches.push(mismatch("merkle.root", recomputedMerkle.root, parsed.merkle.root));
  }
  if (parsed.summary.file_count !== parsed.files.length) {
    mismatches.push(mismatch("summary.file_count", parsed.files.length, parsed.summary.file_count));
  }
  if (parsed.summary.total_bytes !== sumBytes) {
    mismatches.push(mismatch("summary.total_bytes", sumBytes, parsed.summary.total_bytes));
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      bundle_digest: recomputedBundleDigest,
      dataset_fingerprint: recomputedFingerprint,
      merkle_root: recomputedMerkle.root,
      idempotency_key: recomputedIdem,
      file_count: parsed.files.length,
      total_bytes: sumBytes,
    }),
  });
}

export function verifyDatasetReceipt(receipt: unknown): DatasetVerifyResult {
  const parsed = parseDatasetReceiptV1(receipt);
  const mismatches: DatasetVerifyMismatch[] = [];

  const receiptId = recomputeReceiptId(parsed);
  if (parsed.receipt_id !== receiptId) {
    mismatches.push(mismatch("receipt_id", receiptId, parsed.receipt_id));
  }

  const idem = idempotencyKey(
    String(parsed.dataset_identity.dataset_key),
    String(parsed.evidence.dataset_fingerprint)
  );
  if (parsed.evidence.idempotency_key !== idem) {
    mismatches.push(mismatch("evidence.idempotency_key", idem, parsed.evidence.idempotency_key));
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      receipt_id: receiptId,
      idempotency_key: idem,
      ...(parsed.hedera_network
        ? { hedera_network: parsed.hedera_network }
        : {}),
    }),
  });
}

export function verifySubmittedAnchorEvidence(opts: {
  identity: DatasetIdentity;
  evidence: AnchorResult;
  rules?: DatasetRules;
}): DatasetVerifyResult {
  const mismatches: DatasetVerifyMismatch[] = [];
  const bundle = parseDatasetBundleV1(opts.evidence.bundle) as DatasetBundleV1;

  const bundleCheck = verifyDatasetBundle(bundle);
  mismatches.push(...bundleCheck.mismatches);

  const recomputedBundleDigest = bundleDigest(bundle);
  const recomputedFingerprint = datasetFingerprint(bundle);
  const recomputedMerkle = merkleRoot(bundle.files as any).root;
  const recomputedIdem = idempotencyKey(String(bundle.dataset_identity.dataset_key), recomputedFingerprint);

  if (opts.evidence.dataset_key !== opts.identity.dataset_key) {
    mismatches.push(mismatch("evidence.dataset_key", opts.identity.dataset_key, opts.evidence.dataset_key));
  }

  if (bundle.dataset_identity.dataset_key !== opts.identity.dataset_key) {
    mismatches.push(
      mismatch("bundle.dataset_identity.dataset_key", opts.identity.dataset_key, bundle.dataset_identity.dataset_key)
    );
  }

  if ((opts.identity.program ?? null) !== (bundle.dataset_identity.program ?? null)) {
    mismatches.push(
      mismatch("bundle.dataset_identity.program", opts.identity.program ?? null, bundle.dataset_identity.program ?? null)
    );
  }

  if ((opts.identity.version_label ?? null) !== (bundle.dataset_identity.version_label ?? null)) {
    mismatches.push(
      mismatch(
        "bundle.dataset_identity.version_label",
        opts.identity.version_label ?? null,
        bundle.dataset_identity.version_label ?? null
      )
    );
  }

  if (opts.rules) {
    const expectedRedact = Boolean(opts.rules.redact_paths);
    const actualRedact = Boolean(bundle.rules.redact_paths);
    if (expectedRedact !== actualRedact) {
      mismatches.push(mismatch("bundle.rules.redact_paths", expectedRedact, actualRedact));
    }

    const expectedFollow = Boolean(opts.rules.follow_symlinks);
    const actualFollow = Boolean(bundle.rules.follow_symlinks);
    if (expectedFollow !== actualFollow) {
      mismatches.push(mismatch("bundle.rules.follow_symlinks", expectedFollow, actualFollow));
    }
  }

  if (opts.evidence.bundle_digest !== recomputedBundleDigest) {
    mismatches.push(mismatch("evidence.bundle_digest", recomputedBundleDigest, opts.evidence.bundle_digest));
  }
  if (opts.evidence.dataset_fingerprint !== recomputedFingerprint) {
    mismatches.push(mismatch("evidence.dataset_fingerprint", recomputedFingerprint, opts.evidence.dataset_fingerprint));
  }
  if (opts.evidence.merkle_root !== recomputedMerkle) {
    mismatches.push(mismatch("evidence.merkle_root", recomputedMerkle, opts.evidence.merkle_root));
  }
  if (opts.evidence.idempotency_key !== recomputedIdem) {
    mismatches.push(mismatch("evidence.idempotency_key", recomputedIdem, opts.evidence.idempotency_key));
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      dataset_key: bundle.dataset_identity.dataset_key,
      bundle_digest: recomputedBundleDigest,
      dataset_fingerprint: recomputedFingerprint,
      merkle_root: recomputedMerkle,
      idempotency_key: recomputedIdem,
      file_count: bundle.files.length,
      total_bytes: bundle.summary.total_bytes,
    }),
  });
}

export async function verifyDatasetMaterialAgainstReceiptOrBundle(opts: {
  receipt?: unknown;
  bundle?: unknown;
  root_dir: string;
}): Promise<DatasetVerifyResult> {
  const mismatches: DatasetVerifyMismatch[] = [];

  const receipt = opts.receipt ? parseDatasetReceiptV1(opts.receipt) : null;
  const bundle = opts.bundle ? (parseDatasetBundleV1(opts.bundle) as DatasetBundleV1) : null;

  const identity = receipt?.dataset_identity ?? bundle?.dataset_identity;
  const rules = toReplayRules((receipt?.rules as any) ?? bundle?.rules);
  if (!identity) {
    throw new Error("verifyDatasetMaterialAgainstReceiptOrBundle requires receipt or bundle");
  }

  const local = await executeAnchor({
    mode: "hash_only",
    identity: identity as any,
    root_dir: opts.root_dir,
    ...(rules ? { rules: rules as any } : {}),
  });

  if (receipt) {
    if (local.dataset_fingerprint !== receipt.evidence.dataset_fingerprint) {
      mismatches.push(mismatch("evidence.dataset_fingerprint", local.dataset_fingerprint, receipt.evidence.dataset_fingerprint));
    }
    if (local.bundle_digest !== receipt.evidence.bundle_digest) {
      mismatches.push(mismatch("evidence.bundle_digest", local.bundle_digest, receipt.evidence.bundle_digest));
    }
    if (local.merkle_root !== receipt.evidence.merkle_root) {
      mismatches.push(mismatch("evidence.merkle_root", local.merkle_root, receipt.evidence.merkle_root));
    }
    if (local.idempotency_key !== receipt.evidence.idempotency_key) {
      mismatches.push(mismatch("evidence.idempotency_key", local.idempotency_key, receipt.evidence.idempotency_key));
    }
    if (Number((local as any).bundle?.summary?.file_count ?? 0) !== Number(receipt.evidence.file_count)) {
      mismatches.push(mismatch("evidence.file_count", Number((local as any).bundle?.summary?.file_count ?? 0), receipt.evidence.file_count));
    }
    if (Number((local as any).bundle?.summary?.total_bytes ?? 0) !== Number(receipt.evidence.total_bytes)) {
      mismatches.push(mismatch("evidence.total_bytes", Number((local as any).bundle?.summary?.total_bytes ?? 0), receipt.evidence.total_bytes));
    }
  }

  if (bundle) {
    const bundleCheck = verifyDatasetBundle(bundle);
    mismatches.push(...bundleCheck.mismatches);

    const recomputedBundleDigest = bundleDigest(bundle);
    const recomputedFingerprint = datasetFingerprint(bundle);
    const recomputedMerkleRoot = merkleRoot(bundle.files as any).root;

    if (local.bundle_digest !== recomputedBundleDigest) {
      mismatches.push(mismatch("local.bundle_digest", recomputedBundleDigest, local.bundle_digest));
    }
    if (local.dataset_fingerprint !== recomputedFingerprint) {
      mismatches.push(mismatch("local.dataset_fingerprint", recomputedFingerprint, local.dataset_fingerprint));
    }
    if (local.merkle_root !== recomputedMerkleRoot) {
      mismatches.push(mismatch("local.merkle_root", recomputedMerkleRoot, local.merkle_root));
    }
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      local_dataset_fingerprint: local.dataset_fingerprint,
      local_bundle_digest: local.bundle_digest,
      local_merkle_root: local.merkle_root,
      local_idempotency_key: local.idempotency_key,
      local_file_count: (local as any).bundle?.summary?.file_count ?? null,
      local_total_bytes: (local as any).bundle?.summary?.total_bytes ?? null,
    }),
  });
}