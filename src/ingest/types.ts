// ============================================================================
// File: src/ingest/types.ts
// Version: 1.0-hf-ingest-types-v1 | 2026-03-06
// Purpose:
//   Public types for local-first generic ingest workflows.
// Notes:
//   - Separate from src/datasets/* on purpose.
//   - Supports generic artifacts smaller / broader than datasets.
// ============================================================================

export type IngestMode = "hash_only" | "merkle_only" | "register_and_anchor";

export type IngestObjectKind = "json" | "text" | "file" | "file_set";

export type IngestMaterialKind = "json" | "text" | "file" | "file_set";

export type IngestRules = Readonly<{
  include_globs?: ReadonlyArray<string>;
  exclude_globs?: ReadonlyArray<string>;
  allowed_suffixes?: ReadonlyArray<string>;

  max_files?: number;
  max_total_bytes?: number;
  max_single_file_bytes?: number;

  follow_symlinks?: boolean;
  redact_paths?: boolean;
  normalize_line_endings?: boolean;
}>;

export type IngestIdentity = Readonly<{
  object_key: string;
  object_kind: IngestObjectKind;
  version_label?: string | null;
  program?: string | null;
}>;

export type JsonMaterial = Readonly<{
  kind: "json";
  value: unknown;
}>;

export type TextMaterial = Readonly<{
  kind: "text";
  text: string;
  media_type?: string | null;
}>;

export type FileMaterial = Readonly<{
  kind: "file";
  path: string;
}>;

export type FileSetMaterial = Readonly<{
  kind: "file_set";
  root_dir: string;
  rules?: IngestRules;
}>;

export type IngestMaterial =
  | JsonMaterial
  | TextMaterial
  | FileMaterial
  | FileSetMaterial;

export type IngestInput = Readonly<{
  mode: IngestMode;
  identity: IngestIdentity;
  material: IngestMaterial;
  metadata?: Readonly<Record<string, unknown>>;
  evidence_pointer?: string | null;
  domain?: string | null;
  proof_date?: string | null;
  issue_certificate?: boolean;
}>;

export type IngestPlan = Readonly<{
  object_key: string;
  plan_id: string;
  steps: ReadonlyArray<
    "normalize" | "scan" | "hash" | "merkle" | "bundle" | "anchor_payload"
  >;
}>;

export type ScannedFile = Readonly<{
  path_rel: string;
  abs_path: string;
  bytes: number;
}>;

export type IngestItemKind = "json" | "text" | "file";

export type IngestItem = Readonly<{
  item_kind: IngestItemKind;
  path_rel?: string;
  path_hash?: string;
  media_type?: string | null;
  bytes: number;
  sha3_512: string;
  leaf_hash: string;
}>;

export type MerkleInfo = Readonly<{
  leaf_count: number;
  root: string;
}>;

export type IngestBundleV1 = Readonly<{
  bundle_version: "v1";
  hash_contract: Readonly<{
    contract_id: "hf-contract-v1";
    frame: "hf:frame:v1";
    canonical_json: "hf:canonical-json:v1";
    algorithm: "sha3-512";
    encoding: "hex_lower";
  }>;
  identity: Readonly<{
    object_key: string;
    object_kind: IngestObjectKind;
    version_label?: string | null;
    program?: string | null;
  }>;
  rules: Readonly<{
    path_normalization: "posix_rel_no_dotdot";
    follow_symlinks: boolean;
    redact_paths: boolean;
    normalize_line_endings: boolean;
    ordering: "deterministic_sort_v1";
    merkle_rule: "dup_last_on_odd";
    include_globs?: ReadonlyArray<string>;
    exclude_globs?: ReadonlyArray<string>;
    allowed_suffixes?: ReadonlyArray<string>;
  }>;
  items: ReadonlyArray<IngestItem>;
  merkle?: MerkleInfo;
  summary: Readonly<{
    item_count: number;
    total_bytes: number;
  }>;
}>;

export type IngestResult = Readonly<{
  object_key: string;
  object_kind: IngestObjectKind;
  fingerprint: string;
  bundle_digest: string;
  merkle_root?: string;
  bundle: IngestBundleV1;
  idempotency_key: string;
}>;