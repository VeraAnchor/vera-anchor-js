// src/datasets/pathNorm.ts
// Version: 1.0-hf-datasets-path-normalization-v1 | 2026-03-05
// Purpose:
//   Deterministic relative path normalization with traversal defense.
// Contract:
//   - Input: relative path segments from filesystem walk.
//   - Output: "posix rel" with "/" separators, no leading "./", no "..", no empty.
// Notes:
//   - Fail closed: reject anything suspicious.

import path from "node:path";
import { DatasetError } from "./errors.js";
import { MAX_PATH_CHARS } from "./limits.js";

function isSafeSegment(seg: string): boolean {
  if (!seg) return false;
  if (seg === "." || seg === "..") return false;
  if (seg.includes("\u0000")) return false;
  return true;
}

export function normalizeRelPath(rel: string): string {
  const raw = String(rel ?? "");
  if (!raw) throw new DatasetError("path_empty", { code: "PATH_INVALID", statusCode: 400 });

  const p = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = p.split("/").filter((s) => s.length > 0);

  if (!parts.length) throw new DatasetError("path_empty", { code: "PATH_INVALID", statusCode: 400 });

  for (const seg of parts) {
    if (!isSafeSegment(seg)) throw new DatasetError("path_invalid_segment", { code: "PATH_INVALID", statusCode: 400 });
  }

  const posix = parts.join("/");
  const norm = path.posix.normalize(posix);

  if (norm.startsWith("../") || norm === "..") {
    throw new DatasetError("path_traversal_forbidden", { code: "PATH_TRAVERSAL", statusCode: 400 });
  }
  if (norm.startsWith("/") || norm.includes("..")) {
    throw new DatasetError("path_invalid_normalized", { code: "PATH_INVALID", statusCode: 400 });
  }
  if (norm.length > MAX_PATH_CHARS) {
    throw new DatasetError("path_too_long", { code: "PATH_TOO_LONG", statusCode: 400 });
  }

  return norm;
}