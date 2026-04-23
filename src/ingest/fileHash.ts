// ============================================================================
// File: src/ingest/fileHash.ts
// Version: 1.0-hf-ingest-file-hash-v1 | 2026-03-06
// Purpose:
//   Deterministic file hashing + media classification for ingest evidence.
// Notes:
//   - Files are hashed as raw bytes.
//   - Media type inference is conservative and suffix-based.
//   - Textual suffixes can optionally normalize line endings before hashing.
// ============================================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashJson, hashUtf8 } from "../hashing/hashFactory.js";
import { HASH_CHUNK_BYTES_DEFAULT, MAX_TEXT_BYTES_DEFAULT } from "./limits.js";
import { IngestError } from "./errors.js";
import { normalizeRelPath } from "./pathNorm.js";
import type { ScannedFile } from "./types.js";

export type FileMediaKind = "text" | "image" | "binary";

export type HashedScannedFile = Readonly<{
  path_rel: string;
  abs_path: string;
  bytes: number;
  media_type: string | null;
  media_kind: FileMediaKind;
  sha3_512: string;
}>;

const TEXT_SUFFIXES = new Set<string>([
  ".txt",
  ".text",
  ".csv",
  ".tsv",
  ".fasta",
  ".fa",
  ".fna",
  ".ffn",
  ".faa",
  ".frn",
  ".json",
  ".jsonl",
  ".ndjson",
  ".md",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
]);

const IMAGE_MEDIA_BY_SUFFIX: Record<string, string> = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
});

const TEXT_MEDIA_BY_SUFFIX: Record<string, string> = Object.freeze({
  ".txt": "text/plain",
  ".text": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".fasta": "chemical/seq-na-fasta",
  ".fa": "chemical/seq-na-fasta",
  ".fna": "chemical/seq-na-fasta",
  ".ffn": "chemical/seq-na-fasta",
  ".faa": "chemical/seq-aa-fasta",
  ".frn": "chemical/seq-na-fasta",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".ndjson": "application/x-ndjson",
  ".md": "text/markdown",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
});

function suffixOf(p: string): string {
  return path.extname(String(p ?? "")).trim().toLowerCase();
}

export function inferMediaTypeFromPath(p: string): string | null {
  const suffix = suffixOf(p);

  if (Object.prototype.hasOwnProperty.call(IMAGE_MEDIA_BY_SUFFIX, suffix)) {
    return IMAGE_MEDIA_BY_SUFFIX[suffix] ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(TEXT_MEDIA_BY_SUFFIX, suffix)) {
    return TEXT_MEDIA_BY_SUFFIX[suffix] ?? null;
  }

  return null;
}

export function classifyFileKind(p: string): FileMediaKind {
  const suffix = suffixOf(p);
  if (Object.prototype.hasOwnProperty.call(IMAGE_MEDIA_BY_SUFFIX, suffix)) return "image";
  if (TEXT_SUFFIXES.has(suffix)) return "text";
  return "binary";
}

async function statRegularFile(absPath: string, expectedBytes?: number): Promise<fs.Stats> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(absPath);
  } catch (cause) {
    throw new IngestError("file_stat_failed", {
      code: "FILE_READ_FAILED",
      statusCode: 500,
      cause,
    });
  }

  if (!st.isFile()) {
    throw new IngestError("not_regular_file", {
      code: "FILE_READ_FAILED",
      statusCode: 400,
    });
  }

  if (expectedBytes !== undefined) {
    const actual = Number(st.size);
    const expected = Number(expectedBytes);
    if (!Number.isFinite(expected) || expected < 0) {
      throw new IngestError("file_expected_bytes_invalid", {
        code: "FILE_READ_FAILED",
        statusCode: 400,
      });
    }
    if (actual !== expected) {
      throw new IngestError("file_changed_since_scan", {
        code: "FILE_MUTATED",
        statusCode: 409,
      });
    }
  }

  return st;
}

async function hashFileAsRaw(absPath: string, expectedBytes?: number): Promise<string> {
  await statRegularFile(absPath, expectedBytes);

  const stream = fs.createReadStream(absPath, { highWaterMark: HASH_CHUNK_BYTES_DEFAULT });
  const hash = crypto.createHash("sha3-512");

  try {
    for await (const chunk of stream) {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (cause) {
    try {
      stream.destroy();
    } catch {
      // ignore
    }
    throw new IngestError("file_read_failed", {
      code: "FILE_READ_FAILED",
      statusCode: 500,
      cause,
    });
  }

  return hash.digest("hex").toLowerCase();
}

async function hashFileAsNormalizedText(
  absPath: string,
  normalizeLineEndings: boolean,
  expectedBytes?: number
): Promise<string> {
  let raw: string;
  try {
    await statRegularFile(absPath, expectedBytes);
    raw = await fs.promises.readFile(absPath, "utf8");
  } catch (cause) {
    throw new IngestError("text_file_read_failed", {
      code: "FILE_READ_FAILED",
      statusCode: 500,
      cause,
    });
  }

  const text = normalizeLineEndings
    ? raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    : raw;

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_TEXT_BYTES_DEFAULT) {
    throw new IngestError("text_file_too_large_for_normalized_hash", {
      code: "TEXT_TOO_LARGE",
      statusCode: 413,
    });
  }

  return hashUtf8({
    domain: "va:ingest:file-text:v1",
    text,
    alg: "sha3-512",
    encoding: "hex_lower",
  }).digest;
}

export async function hashScannedFile(
  file: ScannedFile,
  opts?: Readonly<{
    normalize_line_endings?: boolean;
  }>
): Promise<HashedScannedFile> {
  const path_rel = normalizeRelPath(file.path_rel);
  const abs_path = String(file.abs_path);
  const bytes = Number(file.bytes);
  const media_kind = classifyFileKind(path_rel);
  const media_type = inferMediaTypeFromPath(path_rel);

  const normalizeText = Boolean(opts?.normalize_line_endings) && media_kind === "text";
  const sha3_512 = normalizeText
    ? await hashFileAsNormalizedText(abs_path, true, bytes)
    : await hashFileAsRaw(abs_path, bytes);

  return Object.freeze({
    path_rel,
    abs_path,
    bytes,
    media_type,
    media_kind,
    sha3_512,
  });
}

export function buildPathHash(pathRel: string): string {
  const normalized = normalizeRelPath(pathRel);
  return hashJson({
    domain: "va:ingest:path:v1",
    value: { path_rel: normalized },
    alg: "sha3-512",
    encoding: "hex_lower",
  }).digest;
}