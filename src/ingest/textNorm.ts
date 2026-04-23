// ============================================================================
// File: src/ingest/textNorm.ts
// Version: 1.0-hf-ingest-text-norm-v1 | 2026-03-06
// Purpose:
//   Deterministic text normalization for ingest evidence.
// Notes:
//   - UTF-8 only.
//   - Optional line-ending normalization for text-like artifacts.
//   - Safe for text, csv, fasta, and similar textual files.
//   - Does NOT perform semantic normalization of CSV/FASTA content.
// ============================================================================

import { MAX_TEXT_BYTES_DEFAULT } from "./limits.js";
import { IngestError } from "./errors.js";

export type TextNormalizationInput = Readonly<{
  text: string;
  normalize_line_endings?: boolean;
}>;

export type NormalizedTextResult = Readonly<{
  text: string;
  bytes_utf8: Uint8Array;
  bytes: number;
}>;

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeText(
  input: TextNormalizationInput,
  maxBytes: number = MAX_TEXT_BYTES_DEFAULT
): NormalizedTextResult {
  const raw = String(input?.text ?? "");
  const normalized = input?.normalize_line_endings ? normalizeLineEndings(raw) : raw;
  const bytes_utf8 = Buffer.from(normalized, "utf8");
  const bytes = bytes_utf8.byteLength;

  if (bytes > maxBytes) {
    throw new IngestError("text_payload_too_large", {
      code: "TEXT_TOO_LARGE",
      statusCode: 413,
    });
  }

  return Object.freeze({
    text: normalized,
    bytes_utf8,
    bytes,
  });
}