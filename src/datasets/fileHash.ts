// src/datasets/fileHash.ts
// Version: 1.0-hf-datasets-file-hash-v1 | 2026-03-05
// Purpose:
//   Streamed file hashing (sha3-512) + deterministic leaf hashing using HF contract.
// Notes:
//   - No buffering full files.
//   - Leaf hash commits to { path_rel OR path_hash, bytes, sha3_512 } via canonical JSON.

import fs from "node:fs";
import * as crypto from "node:crypto";
import { DatasetError } from "./errors.js";
import { HASH_CHUNK_BYTES_DEFAULT } from "./limits.js";
import type { DatasetRules, HashedFile, ScannedFile } from "./types.js";
import { hashJson, hashRaw } from "../hashing/contract.js";

function toHexLower(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toLowerCase();
}

export type HashProgress = Readonly<{
  event: "file_start" | "file_done";
  path_rel: string;
  index: number;
  total: number;
  bytes?: number;
  sha3_512_prefix?: string;
}>;

async function sha3_512_file(absPath: string, chunkBytes: number): Promise<Uint8Array> {
  const h = crypto.createHash("sha3-512");
  const stream = fs.createReadStream(absPath, { highWaterMark: chunkBytes });

  return await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => h.update(chunk));
    stream.on("error", (e) => reject(e));
    stream.on("end", () => resolve(new Uint8Array(h.digest())));
  });
}

function pathHash(pathRel: string): string {
  const r = hashRaw({
    domain: "va:dataset:path:v1",
    bytes: Buffer.from(String(pathRel), "utf8"),
    alg: "sha3-512",
    encoding: "hex_lower",
  });
  return r.digest;
}

export async function hashFiles(
  files: ReadonlyArray<ScannedFile>,
  rules?: DatasetRules,
  onProgress?: (p: HashProgress) => void
): Promise<ReadonlyArray<HashedFile>> {
  const redact = Boolean(rules?.redact_paths);
  const chunkBytes = HASH_CHUNK_BYTES_DEFAULT;

  const out: HashedFile[] = [];
  for (const [idx0, f] of files.entries()) {
    const i = idx0 + 1;
    onProgress?.({ event: "file_start", path_rel: f.path_rel, index: i, total: files.length });

    let digestBytes: Uint8Array;
    try {
      digestBytes = await sha3_512_file(f.abs_path, chunkBytes);
    } catch (e) {
      throw new DatasetError("file_hash_failed", { code: "HASH_FAILED", cause: e, statusCode: 500 });
    }

    const sha3_512 = toHexLower(digestBytes);

    const leafPayload = {
      bytes: f.bytes,
      sha3_512,
      ...(redact ? { path_hash: pathHash(f.path_rel) } : { path_rel: f.path_rel }),
    } as const;

    const leaf = hashJson({
      domain: "va:dataset:leaf:v1",
      value: leafPayload,
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    const rec: HashedFile = Object.freeze({
      ...(redact ? { path_hash: String((leafPayload as any).path_hash) } : { path_rel: f.path_rel }),
      bytes: f.bytes,
      sha3_512,
      leaf_hash: leaf.digest,
    });

    out.push(rec);

    onProgress?.({
      event: "file_done",
      path_rel: f.path_rel,
      index: i,
      total: files.length,
      bytes: f.bytes,
      sha3_512_prefix: sha3_512.slice(0, 16),
    });
  }

  return Object.freeze(out.slice());
}