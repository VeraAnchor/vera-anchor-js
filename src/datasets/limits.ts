// src/datasets/limits.ts
// Version: 1.0-hf-datasets-limits-v1 | 2026-03-05
// Purpose:
//   Limits and default rules for HF dataset anchoring (local-first).
// Notes:
//   - Keep these conservative for UI safety.

export const MAX_FILES_DEFAULT = 200_000 as const;
export const MAX_TOTAL_BYTES_DEFAULT = 2_000_000_000 as const; // 2GB default budget
export const MAX_SINGLE_FILE_BYTES_DEFAULT = 1_000_000_000 as const; // 1GB per file default

export const MAX_PATH_CHARS = 1024 as const; // after normalization
export const MAX_ROOT_SCAN_DEPTH = 64 as const;

export const HASH_CHUNK_BYTES_DEFAULT = 1_048_576; // 1MB