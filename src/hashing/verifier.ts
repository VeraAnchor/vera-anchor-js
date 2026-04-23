// src/hashing/verifier.ts
// Version: 1.1-hash-factory-verifier-v1 | 2026-02-17
// Purpose:
//   Offline verifier that recomputes a digest from material and compares to a HashEnvelopeV1.
// API:
//   verifyEnvelope(envelope, { value | text | bytes | bytes_b64url? }) -> { ok, expected_digest, mismatches, ... }
// Notes:
//   - Uses runtime parsing for safety (untrusted inputs).
//   - Recomputes using the same pure contract helpers.
//   - Reports mismatch details for enterprise debugging / auditing.
// V1.1: added helper to handle missing envelope material as a 400 error

import { hashJson as contractHashJson, hashRaw as contractHashRaw } from "./contract.js";
import { parseHashEnvelopeV1, HashValidationError } from "./validators.js";
import { decodeBase64UrlStrict } from "./base64url.js";
import * as crypto from "node:crypto";
import { MAX_PAYLOAD_BYTES, MAX_FRAMED_BYTES, SHA3_512_BYTES } from "./limits.js";
import {
  CANONICAL_JSON_ID,
  FRAME_ID,
  HASH_FACTORY_CONTRACT_ID,
  type HashEnvelopeV1,
  type HashEnvelopeJsonV1,
} from "./types.js";

export type VerifyMismatch = Readonly<{
  field: string;
  expected: unknown;
  actual: unknown;
}>;

export type VerifyResult = Readonly<{
  ok: boolean;
  expected_digest: string;
  actual_digest: string;
  mismatches: ReadonlyArray<VerifyMismatch>;
}>;

export type VerifyMaterial =
  | Readonly<{ value: unknown; text?: never; bytes?: never; bytes_b64url?: never }>
  | Readonly<{ text: string; value?: never; bytes?: never; bytes_b64url?: never }>
  | Readonly<{ bytes: Uint8Array; value?: never; text?: never; bytes_b64url?: never }>
  | Readonly<{ bytes_b64url: string; value?: never; text?: never; bytes?: never }>;

function mismatch(field: string, expected: unknown, actual: unknown): VerifyMismatch {
  return Object.freeze({ field, expected, actual });
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isJsonEnvelope(e: HashEnvelopeV1): e is HashEnvelopeJsonV1 {
  return e.kind === "json";
}

function missingMaterial(message: string): never {
  // Route-safe: treat missing verification material as a 400, not an internal error.
  throw new HashValidationError(message, {
    code: "VERIFY_MISSING_MATERIAL",
    statusCode: 400,
  });
}

export function verifyEnvelope(envelope: unknown, material?: VerifyMaterial): VerifyResult {
  const env = parseHashEnvelopeV1(envelope) as HashEnvelopeV1;
  const mismatches: VerifyMismatch[] = [];

  // Meta checks (these should be stable invariants in v1)
  if (env.contract_id !== HASH_FACTORY_CONTRACT_ID) {
    mismatches.push(mismatch("contract_id", HASH_FACTORY_CONTRACT_ID, env.contract_id));
  }
  if (env.frame !== FRAME_ID) {
    mismatches.push(mismatch("frame", FRAME_ID, env.frame));
  }
  if (isJsonEnvelope(env)) {
    const jsonEnv = env as HashEnvelopeJsonV1;
    if (jsonEnv.canonical_json !== CANONICAL_JSON_ID) {
      mismatches.push(mismatch("canonical_json", CANONICAL_JSON_ID, jsonEnv.canonical_json));
    }
  }

  // Resolve bytes for verification
  let payloadBytes: Uint8Array | null = null;

  if (isJsonEnvelope(env)) {
    if (material && "value" in material) {
      const r = contractHashJson({
        domain: env.domain,
        value: material.value,
        alg: env.alg,
        encoding: env.encoding,
      });
      payloadBytes = r.payloadBytes;

      if (env.payload_b64url) {
        const declared = decodeBase64UrlStrict(env.payload_b64url, { maxBytes: MAX_PAYLOAD_BYTES, allowEmpty: true });
        if (!eqBytes(declared, payloadBytes)) {
          mismatches.push(mismatch("payload_b64url", "matches canonicalize(value)", "mismatch"));
        }
      }
    } else if (env.payload_b64url) {
      payloadBytes = decodeBase64UrlStrict(env.payload_b64url, { maxBytes: MAX_PAYLOAD_BYTES, allowEmpty: true });
    } else {
      missingMaterial("verifyEnvelope_missing_material: json requires { value } or envelope.payload_b64url");
    }
  }

  if (env.kind === "utf8") {
    if (material && "text" in material) {
      payloadBytes = Buffer.from(String(material.text ?? ""), "utf8");
    } else if (env.payload_b64url) {
      payloadBytes = decodeBase64UrlStrict(env.payload_b64url, { maxBytes: MAX_PAYLOAD_BYTES, allowEmpty: true });
    } else {
      missingMaterial("verifyEnvelope_missing_material: utf8 requires { text } or envelope.payload_b64url");
    }
  }

  if (env.kind === "raw") {
    if (material && material.bytes instanceof Uint8Array) {
      payloadBytes = material.bytes;
    } else if (material && typeof material.bytes_b64url === "string") {
      payloadBytes = decodeBase64UrlStrict(material.bytes_b64url, {
        maxBytes: MAX_PAYLOAD_BYTES,
        allowEmpty: true,
      });
    } else if (env.payload_b64url) {
      payloadBytes = decodeBase64UrlStrict(env.payload_b64url, {
        maxBytes: MAX_PAYLOAD_BYTES,
        allowEmpty: true,
      });
    } else {
      missingMaterial(
        "verifyEnvelope_missing_material: raw requires { bytes } or { bytes_b64url } or envelope.payload_b64url"
      );
    }
  }

  if (!(payloadBytes instanceof Uint8Array)) {
    missingMaterial("verifyEnvelope_internal: payloadBytes not resolved");
  }

  const resolvedPayloadBytes: Uint8Array = payloadBytes;

  // Recompute digest from resolved payload bytes
  const rr = contractHashRaw({
    domain: env.domain,
    bytes: resolvedPayloadBytes,
    alg: env.alg,
    encoding: env.encoding,
  });

  const expected_digest = rr.digest;
  const actual_digest = env.digest;

  if (env.payload_bytes_len !== resolvedPayloadBytes.byteLength) {
    mismatches.push(
      mismatch("payload_bytes_len", resolvedPayloadBytes.byteLength, env.payload_bytes_len)
    );
  }

  if (env.framed_bytes_len !== rr.framedBytes.byteLength) {
    mismatches.push(mismatch("framed_bytes_len", rr.framedBytes.byteLength, env.framed_bytes_len));
  }

  if (expected_digest !== actual_digest) {
    mismatches.push(mismatch("digest", expected_digest, actual_digest));
  }

  if (env.digest_bytes_b64url) {
    const declared = decodeBase64UrlStrict(env.digest_bytes_b64url, { maxBytes: SHA3_512_BYTES });
    if (declared.byteLength !== SHA3_512_BYTES || !eqBytes(declared, rr.digestBytes)) {
      mismatches.push(mismatch("digest_bytes_b64url", "matches computed digest bytes", "mismatch"));
    }
  }

  if (env.framed_b64url) {
    const declared = decodeBase64UrlStrict(env.framed_b64url, { maxBytes: MAX_FRAMED_BYTES, allowEmpty: true });
    if (!eqBytes(declared, rr.framedBytes)) {
      mismatches.push(mismatch("framed_b64url", "matches computed framed bytes", "mismatch"));
    }
  } 

  const ok = mismatches.length === 0;

  return Object.freeze({
    ok,
    expected_digest,
    actual_digest,
    mismatches: Object.freeze(mismatches.slice()),
  });
}