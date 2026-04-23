// ============================================================================
// File: src/ingest/pathNorm.ts
// Version: 1.0-hf-ingest-path-norm-v1 | 2026-03-06
// Purpose:
//   Deterministic relative path normalization for ingest bundles.
// Notes:
//   - Produces POSIX-style relative paths only.
//   - Rejects empty, absolute, drive-qualified, and parent-escaping paths.
//   - Fail-closed for security and bundle determinism.
// ============================================================================

import path from "node:path";
import { MAX_PATH_CHARS } from "./limits.js";
import { IngestValidationError } from "./errors.js";

const RE_WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const RE_CONTROL = /[\u0000-\u001F\u007F]/;

function splitPosixSegments(input: string): string[] {
  return input.split("/").filter((seg) => seg.length > 0);
}

export function normalizeRelPath(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new IngestValidationError("path_empty", { code: "PATH_INVALID" });
  }

  if (raw.length > MAX_PATH_CHARS) {
    throw new IngestValidationError("path_too_long", { code: "PATH_INVALID" });
  }

  if (RE_CONTROL.test(raw)) {
    throw new IngestValidationError("path_control_chars", { code: "PATH_INVALID" });
  }

  if (raw.startsWith("/") || raw.startsWith("\\") || RE_WINDOWS_DRIVE.test(raw)) {
    throw new IngestValidationError("path_must_be_relative", { code: "PATH_INVALID" });
  }

  if (raw.startsWith("./") || raw.startsWith(".\\")) {
    throw new IngestValidationError("path_dot_prefix_forbidden", { code: "PATH_INVALID" });
  }

  const posixish = raw.replace(/\\/g, "/");
  const normalized = path.posix.normalize(posixish);

  if (!normalized || normalized === "." || normalized === "..") {
    throw new IngestValidationError("path_invalid", { code: "PATH_INVALID" });
  }

  if (normalized.startsWith("../") || normalized.includes("/../")) {
    throw new IngestValidationError("path_parent_escape", { code: "PATH_INVALID" });
  }

  const segments = splitPosixSegments(normalized);
  if (!segments.length) {
    throw new IngestValidationError("path_invalid", { code: "PATH_INVALID" });
  }

  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new IngestValidationError("path_segment_invalid", { code: "PATH_INVALID" });
    }
    if (RE_CONTROL.test(seg)) {
      throw new IngestValidationError("path_segment_control_chars", { code: "PATH_INVALID" });
    }
  }

  const out = segments.join("/");
  if (!out || out.length > MAX_PATH_CHARS) {
    throw new IngestValidationError("path_invalid", { code: "PATH_INVALID" });
  }

  return out;
}
