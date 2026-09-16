// ============================================================================
// File: src/ingest/leaf.ts
// Version: 1.0-hf-ingest-leaf-contract-v1 | 2026-09-09
// Purpose:
//   Canonical ingest leaf commitment shared by execution and verification.
// Notes:
//   - Pure and deterministic.
//   - Hedera network is intentionally excluded from content evidence.
// ============================================================================

import { hashJson } from "../hashing/hashFactory.js";
import type { IngestItem } from "./types.js";

export type IngestLeafInput = Readonly<{
  item_kind: IngestItem["item_kind"];
  path_rel?: string;
  path_hash?: string;
  media_type?: string | null;
  bytes: number;
  sha3_512: string;
}>;

export function buildIngestLeafHash(input: IngestLeafInput): string {
  return hashJson({
    domain: "va:ingest:leaf:v1",
    value: {
      item_kind: input.item_kind,
      ...(input.path_rel ? { path_rel: input.path_rel } : {}),
      ...(input.path_hash ? { path_hash: input.path_hash } : {}),
      ...(input.media_type ? { media_type: input.media_type } : {}),
      bytes: input.bytes,
      sha3_512: input.sha3_512,
    },
    alg: "sha3-512",
    encoding: "hex_lower",
  }).digest;
}