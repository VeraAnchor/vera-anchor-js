// ============================================================================
// File: src/ingest/merkle.ts
// Version: 1.0-hf-ingest-merkle-v1 | 2026-03-06
// Purpose:
//   Deterministic Merkle root from ingest item leaf hashes.
// Rules:
//   - Leaf order is the deterministic input order passed into this function.
//   - Odd node: duplicate last.
//   - Node hash domain is explicit and ingest-specific.
// ============================================================================

import { hashRaw } from "../hashing/contract.js";
import { IngestError } from "./errors.js";
import type { IngestItem, MerkleInfo } from "./types.js";

const RE_HEX512 = /^[0-9a-f]{128}$/;

function assertHexLowerDigest(s: string): void {
  if (typeof s !== "string" || !RE_HEX512.test(s)) {
    throw new IngestError("merkle_invalid_leaf_hash", {
      code: "MERKLE_INVALID",
      statusCode: 400,
    });
  }
}

function hexToBytes(hexLower: string): Uint8Array {
  assertHexLowerDigest(hexLower);
  return new Uint8Array(Buffer.from(hexLower, "hex"));
}

export function merkleRootFromItems(items: ReadonlyArray<Pick<IngestItem, "leaf_hash">>): MerkleInfo {
  if (!Array.isArray(items) || items.length === 0) {
    throw new IngestError("merkle_no_leaves", {
      code: "MERKLE_EMPTY",
      statusCode: 400,
    });
  }

  let level: Uint8Array[] = items.map((item) => hexToBytes(String(item.leaf_hash)));

  while (level.length > 1) {
    const next: Uint8Array[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (!left) {
        throw new IngestError("merkle_internal_missing_left", {
          code: "MERKLE_INVALID",
          statusCode: 500,
        });
      }

      const right = i + 1 < level.length ? level[i + 1] : left;
      if (!right) {
        throw new IngestError("merkle_internal_missing_right", {
          code: "MERKLE_INVALID",
          statusCode: 500,
        });
      }

      const combined = Buffer.concat([Buffer.from(left), Buffer.from(right)]);
      const node = hashRaw({
        domain: "va:ingest:node:v1",
        bytes: combined,
        alg: "sha3-512",
        encoding: "hex_lower",
      });

      next.push(hexToBytes(node.digest));
    }

    level = next;
  }

  const root = level[0];
  if (!root) {
    throw new IngestError("merkle_internal_empty", {
      code: "MERKLE_INVALID",
      statusCode: 500,
    });
  }

  return Object.freeze({
    leaf_count: items.length,
    root: Buffer.from(root).toString("hex").toLowerCase(),
  });
}