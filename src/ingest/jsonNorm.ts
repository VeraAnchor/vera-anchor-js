// ============================================================================
// File: src/ingest/jsonNorm.ts
// Version: 1.0-hf-ingest-json-norm-v1 | 2026-03-06
// Purpose:
//   Deterministic JSON normalization for ingest evidence.
// Notes:
//   - Uses shared canonical JSON contract from src/hashing/canonicalJson.ts.
//   - Produces canonical UTF-8 bytes + canonical text.
//   - Intended for ingest material.kind = "json".
// ============================================================================

import { canonicalize } from "../hashing/canonicalJson.js";
import { MAX_JSON_BYTES_DEFAULT } from "./limits.js";
import { IngestError } from "./errors.js";

export type CanonicalJsonResult = Readonly<{
  canonical_text: string;
  canonical_bytes: Uint8Array;
  bytes: number;
}>;

export function normalizeJsonValue(value: unknown, maxBytes: number = MAX_JSON_BYTES_DEFAULT): CanonicalJsonResult {
  let canonicalBytes: Uint8Array;
  try {
    canonicalBytes = canonicalize(value);
  } catch (cause) {
    throw new IngestError("json_canonicalization_failed", {
      code: "JSON_CANONICALIZATION_FAILED",
      statusCode: 400,
      cause,
    });
  }

  const bytes = canonicalBytes.byteLength;
  if (bytes > maxBytes) {
    throw new IngestError("json_payload_too_large", {
      code: "JSON_TOO_LARGE",
      statusCode: 413,
    });
  }

  const canonical_text = Buffer.from(canonicalBytes).toString("utf8");

  return Object.freeze({
    canonical_text,
    canonical_bytes: canonicalBytes,
    bytes,
  });
}