// ============================================================================
// File: src/ingest/limits.ts
// Version: 1.0-hf-ingest-limits-v1 | 2026-03-06
// Purpose:
//   Conservative limits for local-first ingest workflows.
// Notes:
//   - Intended for smaller, general-purpose evidence ingestion.
//   - Dataset-scale ingestion remains in src/datasets/*.
// ============================================================================

export const MAX_OBJECT_KEY_LEN = 256 as const;
export const MAX_PROGRAM_LEN = 64 as const;
export const MAX_VERSION_LABEL_LEN = 64 as const;

export const MAX_TEXT_BYTES_DEFAULT = 5_000_000 as const; // 5 MB
export const MAX_JSON_BYTES_DEFAULT = 5_000_000 as const; // 5 MB canonicalized budget

export const MAX_FILES_DEFAULT = 50_000 as const;
export const MAX_TOTAL_BYTES_DEFAULT = 500_000_000 as const; // 500 MB
export const MAX_SINGLE_FILE_BYTES_DEFAULT = 100_000_000 as const; // 100 MB

export const MAX_PATH_CHARS = 1024 as const;
export const MAX_ROOT_SCAN_DEPTH = 64 as const;

export const MAX_ARRAY_ITEMS = 256 as const;
export const MAX_META_DEPTH = 8 as const;
export const MAX_JSON_DEPTH = 64 as const;

export const MAX_GLOB_LEN = 256 as const;
export const MAX_SUFFIX_LEN = 64 as const;
export const MAX_POINTER_LEN = 2048 as const;
export const MAX_DOMAIN_LEN = 64 as const;
export const MAX_MEDIA_TYPE_LEN = 128 as const;

export const HASH_CHUNK_BYTES_DEFAULT = 1_048_576 as const; // 1 MB