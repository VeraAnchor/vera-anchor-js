// src/datasets/merkle.ts
// Version: 1.0-hf-datasets-merkle-v1 | 2026-03-05
// Purpose:
//   Deterministic Merkle root from leaf hashes.
// Rules:
//   - Leaves ordered by path_rel ASCII ascending (already enforced by scan sort).
//   - Odd node: duplicate last.
//   - Node hash = H( frame("va:dataset:node:v1", left_bytes || right_bytes) )

import { DatasetError } from "./errors.js";
import type { HashedFile, MerkleInfo } from "./types.js";
import { hashRaw } from "../hashing/contract.js";

function assertHexLowerDigest(s: string): void {
  if (typeof s !== "string" || s.length !== 128 || !/^[0-9a-f]+$/.test(s)) {
    throw new DatasetError("digest_invalid_hex_lower", { code: "MERKLE_INVALID" });
  }
}

function hexToBytes(hexLower: string): Uint8Array {
  assertHexLowerDigest(hexLower);
  return new Uint8Array(Buffer.from(hexLower, "hex"));
}

export function merkleRoot(files: ReadonlyArray<HashedFile>): MerkleInfo {
  if (!files.length) throw new DatasetError("merkle_no_leaves", { code: "MERKLE_EMPTY" });

  let level: Uint8Array[] = files.map((f) => hexToBytes(String(f.leaf_hash)));

  while (level.length > 1) {
    const next: Uint8Array[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (!left) throw new DatasetError("merkle_internal_missing_left", { code: "MERKLE_INVALID" });

      const right = i + 1 < level.length ? level[i + 1] : left;
      if (!right) throw new DatasetError("merkle_internal_missing_right", { code: "MERKLE_INVALID" });

      const combined = Buffer.concat([Buffer.from(left), Buffer.from(right)]);

      const r = hashRaw({
        domain: "va:dataset:node:v1",
        bytes: combined,
        alg: "sha3-512",
        encoding: "hex_lower",
      });

      next.push(hexToBytes(r.digest));
    }

    level = next;
  }

  const only = level[0];
  if (!only) throw new DatasetError("merkle_internal_empty", { code: "MERKLE_INVALID" });

  const rootHex = Buffer.from(only).toString("hex").toLowerCase();

  return Object.freeze({ leaf_count: files.length, root: rootHex });
}