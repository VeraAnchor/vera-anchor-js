// src/datasets/types.ts
// Version: 1.0-hf-datasets-types-v1 | 2026-03-05
// Purpose:
//   Public types for dataset anchoring workflow + bundle manifest.

export type DatasetAnchorMode = "hash_only" | "register_and_anchor";

export type DatasetRules = Readonly<{
  include_globs?: ReadonlyArray<string>;
  exclude_globs?: ReadonlyArray<string>;
  allowed_suffixes?: ReadonlyArray<string>;

  max_files?: number;
  max_total_bytes?: number;
  max_single_file_bytes?: number;

  follow_symlinks?: boolean; // default false
  redact_paths?: boolean; // default false (if true, do not include raw relative paths)
}>;

export type DatasetIdentity = Readonly<{
  dataset_key: string;
  version_label?: string | null;
  program?: string | null;
}>;

export type AnchorInput = Readonly<{
  identity: DatasetIdentity;
  root_dir: string;
  rules?: DatasetRules;
  mode?: DatasetAnchorMode;
  issue_certificate?: boolean;
}>;

export type AnchorPlan = Readonly<{
  dataset_key: string;
  plan_id: string;
  steps: ReadonlyArray<"scan" | "hash" | "bundle" | "core_upsert" | "core_version" | "core_publish">;
}>;

export type SubmittedAnchorEvidence = AnchorResult;

export type AnchorSubmitInput = Readonly<{
  mode: "register_and_anchor";
  identity: DatasetIdentity;
  evidence: SubmittedAnchorEvidence;
  display_name?: string | null;
  metadata?: Readonly<Record<string, unknown>>;
  evidence_pointer: string;
  publish_visibility?: "public" | "unlisted" | null;
  set_active?: boolean;
  issue_certificate?: boolean;
}>;

export type ScannedFile = Readonly<{
  path_rel: string;
  abs_path: string;
  bytes: number;
}>;

export type HashedFile = Readonly<{
  path_rel?: string; // omitted if redact_paths=true
  path_hash?: string; // present if redact_paths=true
  bytes: number;
  sha3_512: string; // hex_lower
  leaf_hash: string; // hex_lower
}>;

export type MerkleInfo = Readonly<{
  leaf_count: number;
  root: string; // hex_lower
}>;

export type DatasetBundleV1 = Readonly<{
  bundle_version: "v1";
  hash_contract: Readonly<{
    contract_id: "hf-contract-v1";
    frame: "hf:frame:v1";
    canonical_json: "hf:canonical-json:v1";
    algorithm: "sha3-512";
    encoding: "hex_lower";
  }>;
  dataset_identity: Readonly<{
    dataset_key: string;
    version_label?: string | null;
    program?: string | null;
  }>;
  rules: Readonly<{
    path_normalization: "posix_rel_no_dotdot";
    follow_symlinks: boolean;
    redact_paths: boolean;
    ordering: "path_rel_ascii_asc";
    merkle_rule: "dup_last_on_odd";
    include_globs?: ReadonlyArray<string>;
    exclude_globs?: ReadonlyArray<string>;
    allowed_suffixes?: ReadonlyArray<string>;
  }>;
  files: ReadonlyArray<HashedFile>;
  merkle: MerkleInfo;
  summary: Readonly<{
    file_count: number;
    total_bytes: number;
  }>;
}>;

export type AnchorResult = Readonly<{
  dataset_key: string;
  dataset_fingerprint: string; // hex_lower
  bundle_digest: string; // hex_lower (digest over bundle manifest)
  merkle_root: string; // hex_lower
  bundle: DatasetBundleV1;
  idempotency_key: string; // hex_lower
}>;