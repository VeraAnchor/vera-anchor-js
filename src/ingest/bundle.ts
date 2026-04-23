// ============================================================================
// File: src/ingest/bundle.ts
// Version: 1.0-hf-ingest-bundle-v1 | 2026-03-06
// Purpose:
//   Build v1 ingest evidence bundle manifest + deterministic fingerprints.
// Notes:
//   - Pure, deterministic, side-effect free.
//   - Keeps bundle construction separate from execute orchestration.
// ============================================================================

import type {
  IngestBundleV1,
  IngestIdentity,
  IngestItem,
  IngestRules,
  MerkleInfo,
} from "./types.js";
import { IngestError } from "./errors.js";
import { HF_HASH_CONTRACT_INFO, hashJsonDigest } from "../hashing/contract.js";

function sumBytes(items: ReadonlyArray<IngestItem>): number {
  let total = 0;
  for (const item of items) {
    const bytes = Number(item.bytes);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new IngestError("bundle_item_bytes_invalid", {
        code: "BUNDLE_INVALID",
        statusCode: 400,
      });
    }
    total += bytes;
  }
  return total;
}

function cloneStringArray(v?: ReadonlyArray<string>): ReadonlyArray<string> {
  return Object.freeze((v ?? []).slice());
}

function buildBundleRules(rules?: IngestRules): IngestBundleV1["rules"] {
  const out: {
    path_normalization: "posix_rel_no_dotdot";
    follow_symlinks: boolean;
    redact_paths: boolean;
    normalize_line_endings: boolean;
    ordering: "deterministic_sort_v1";
    merkle_rule: "dup_last_on_odd";
    include_globs?: ReadonlyArray<string>;
    exclude_globs?: ReadonlyArray<string>;
    allowed_suffixes?: ReadonlyArray<string>;
  } = {
    path_normalization: "posix_rel_no_dotdot",
    follow_symlinks: Boolean(rules?.follow_symlinks),
    redact_paths: Boolean(rules?.redact_paths),
    normalize_line_endings: Boolean(rules?.normalize_line_endings),
    ordering: "deterministic_sort_v1",
    merkle_rule: "dup_last_on_odd",
  };

  if (rules?.include_globs?.length) out.include_globs = cloneStringArray(rules.include_globs);
  if (rules?.exclude_globs?.length) out.exclude_globs = cloneStringArray(rules.exclude_globs);
  if (rules?.allowed_suffixes?.length) out.allowed_suffixes = cloneStringArray(rules.allowed_suffixes);

  return Object.freeze(out);
}

export function buildIngestBundleV1(opts: {
  identity: IngestIdentity;
  rules?: IngestRules;
  items: ReadonlyArray<IngestItem>;
  merkle?: MerkleInfo;
}): IngestBundleV1 {
  if (!opts?.identity) {
    throw new IngestError("bundle_identity_required", {
      code: "BUNDLE_INVALID",
      statusCode: 400,
    });
  }

  if (!Array.isArray(opts.items) || opts.items.length === 0) {
    throw new IngestError("bundle_items_required", {
      code: "BUNDLE_INVALID",
      statusCode: 400,
    });
  }

  const bundleRules = buildBundleRules(opts.rules);

  const bundle: IngestBundleV1 = Object.freeze({
    bundle_version: "v1",
    hash_contract: HF_HASH_CONTRACT_INFO,
    identity: Object.freeze({
      object_key: String(opts.identity.object_key),
      object_kind: opts.identity.object_kind,
      ...(opts.identity.version_label != null ? { version_label: String(opts.identity.version_label) } : {}),
      ...(opts.identity.program != null ? { program: String(opts.identity.program) } : {}),
    }),
    rules: bundleRules,
    items: Object.freeze(opts.items.slice()),
    ...(opts.merkle
      ? {
          merkle: Object.freeze({
            leaf_count: Number(opts.merkle.leaf_count),
            root: String(opts.merkle.root).toLowerCase(),
          }),
        }
      : {}),
    summary: Object.freeze({
      item_count: opts.items.length,
      total_bytes: sumBytes(opts.items),
    }),
  });

  return bundle;
}

export function ingestBundleDigest(bundle: IngestBundleV1): string {
  return hashJsonDigest({
    domain: "va:ingest:bundle:v1",
    value: bundle,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

export function ingestFingerprint(bundle: IngestBundleV1): string {
  return hashJsonDigest({
    domain: "va:ingest:fingerprint:v1",
    value: bundle,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

export function ingestIdempotencyKey(objectKey: string, fingerprint: string): string {
  const object_key = String(objectKey);
  const fp = String(fingerprint);
  const combined = `${object_key}\u0000${fp}`;

  return hashJsonDigest({
    domain: "va:ingest:idem:v1",
    value: {
      object_key,
      fingerprint: fp,
      sep: "\u0000",
      combined,
    },
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}