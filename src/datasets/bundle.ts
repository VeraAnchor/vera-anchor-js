// src/datasets/bundle.ts
// Version: 1.0-hf-datasets-bundle-v1 | 2026-03-05
// Purpose:
//   Build v1 dataset evidence bundle manifest + deterministic fingerprints.

import type { DatasetBundleV1, DatasetIdentity, DatasetRules, HashedFile, MerkleInfo } from "./types.js";
import { HF_HASH_CONTRACT_INFO, hashJsonDigest } from "../hashing/contract.js";

function sumBytes(files: ReadonlyArray<HashedFile>): number {
  let t = 0;
  for (const f of files) t += Number(f.bytes) || 0;
  return t;
}

export function buildBundleV1(opts: {
  identity: DatasetIdentity;
  rules?: DatasetRules;
  files: ReadonlyArray<HashedFile>;
  merkle: MerkleInfo;
}): DatasetBundleV1 {
  const follow = Boolean(opts.rules?.follow_symlinks);
  const redact = Boolean(opts.rules?.redact_paths);

  const bundle: DatasetBundleV1 = Object.freeze({
    bundle_version: "v1",
    hash_contract: HF_HASH_CONTRACT_INFO,
    dataset_identity: Object.freeze({
      dataset_key: String(opts.identity.dataset_key),
      ...(opts.identity.version_label != null ? { version_label: String(opts.identity.version_label) } : {}),
      ...(opts.identity.program != null ? { program: String(opts.identity.program) } : {}),
    }),
    rules: Object.freeze({
      path_normalization: "posix_rel_no_dotdot",
      follow_symlinks: follow,
      redact_paths: redact,
      ordering: "path_rel_ascii_asc",
      merkle_rule: "dup_last_on_odd",
      ...(opts.rules?.include_globs ? { include_globs: Object.freeze(opts.rules.include_globs.slice()) } : {}),
      ...(opts.rules?.exclude_globs ? { exclude_globs: Object.freeze(opts.rules.exclude_globs.slice()) } : {}),
      ...(opts.rules?.allowed_suffixes ? { allowed_suffixes: Object.freeze(opts.rules.allowed_suffixes.slice()) } : {}),
    }),
    files: Object.freeze(opts.files.slice()),
    merkle: Object.freeze({ leaf_count: opts.merkle.leaf_count, root: String(opts.merkle.root) }),
    summary: Object.freeze({
      file_count: opts.files.length,
      total_bytes: sumBytes(opts.files),
    }),
  });

  return bundle;
}

export function bundleDigest(bundle: DatasetBundleV1): string {
  // Digest of the bundle manifest itself (canonical JSON under explicit domain)
  return hashJsonDigest({
    domain: "va:dataset:bundle:v1",
    value: bundle,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

export function datasetFingerprint(bundle: DatasetBundleV1): string {
  // Higher-level fingerprint (separate domain so we can evolve bundle digest semantics later if needed)
  return hashJsonDigest({
    domain: "va:dataset:fingerprint:v1",
    value: bundle,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

export function idempotencyKey(datasetKey: string, fingerprint: string): string {
  const s = `${String(datasetKey)}\u0000${String(fingerprint)}`;
  return hashJsonDigest({
    domain: "va:dataset:idem:v1",
    value: { dataset_key: String(datasetKey), fingerprint: String(fingerprint), sep: "\u0000", combined: s },
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}