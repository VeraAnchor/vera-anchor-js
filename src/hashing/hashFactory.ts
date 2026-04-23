// src/hashing/hashFactory.ts
// Version: 1.0-hash-factory-public-api-v1 | 2026-02-17
// Purpose:
//   Public “hashing contract” API (pure) used by routes/handlers.
// Contract (code-level):
//   - hashJson({ value, domain, canon, alg, encoding }) -> HashEnvelopeV1
//   - hashUtf8({ text, domain, alg, encoding }) -> HashEnvelopeV1
//   - hashRaw({ bytes, domain, alg, encoding }) -> HashEnvelopeV1
// Notes:
//   - Deterministic: no time, no randomness, no env.
//   - Optional material fields are deterministic and explicitly controlled by caller.

import { hashJson as contractHashJson, hashRaw as contractHashRaw, type HashResult } from "./contract.js";
import { MAX_PAYLOAD_BYTES } from "./limits.js";
import {
  CANONICAL_JSON_ID,
  type CanonId,
  type DigestEncoding,
  type HashAlg,
  type HashFactoryContractId,
  type FrameId,
  type HashKind,
  type HashEnvelopeJsonV1,
  type HashEnvelopeBytesV1,
  type HashEnvelopeV1,
  type HashMaterialInclude,
} from "./types.js";

function bytesToB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function normalizeInclude(include?: HashMaterialInclude): Required<HashMaterialInclude> {
  return {
    includeDigestBytes: Boolean(include?.includeDigestBytes),
    includePayloadBytes: Boolean(include?.includePayloadBytes),
    includeFramedBytes: Boolean(include?.includeFramedBytes),
  };
}

function buildEnvelopeV1(kind: "json", r: HashResult, include?: HashMaterialInclude): HashEnvelopeJsonV1;
function buildEnvelopeV1(kind: "utf8" | "raw", r: HashResult, include?: HashMaterialInclude): HashEnvelopeBytesV1;
function buildEnvelopeV1(kind: HashKind, r: HashResult, include?: HashMaterialInclude): HashEnvelopeV1 {
  const inc = normalizeInclude(include);

  if (kind === "json") {
    const env: HashEnvelopeJsonV1 = Object.freeze({
      v: "v1",
      kind: "json",
      contract_id: r.info.contractId as HashFactoryContractId,
      frame: r.info.frame as FrameId,
      canonical_json: r.info.canonicalJson as CanonId,
      alg: r.info.algorithm as HashAlg,
      encoding: r.info.encoding as DigestEncoding,
      domain: String(r.domain),
      digest: r.digest,
      payload_bytes_len: r.payloadBytes.byteLength,
      framed_bytes_len: r.framedBytes.byteLength,
      ...(inc.includeDigestBytes ? { digest_bytes_b64url: bytesToB64url(r.digestBytes) } : {}),
      ...(inc.includePayloadBytes ? { payload_b64url: bytesToB64url(r.payloadBytes) } : {}),
      ...(inc.includeFramedBytes ? { framed_b64url: bytesToB64url(r.framedBytes) } : {}),
    });
    return env;
  }

  const env: HashEnvelopeBytesV1 = Object.freeze({
    v: "v1",
    kind,
    contract_id: r.info.contractId as HashFactoryContractId,
    frame: r.info.frame as FrameId,
    alg: r.info.algorithm as HashAlg,
    encoding: r.info.encoding as DigestEncoding,
    domain: String(r.domain),
    digest: r.digest,
    payload_bytes_len: r.payloadBytes.byteLength,
    framed_bytes_len: r.framedBytes.byteLength,
    ...(inc.includeDigestBytes ? { digest_bytes_b64url: bytesToB64url(r.digestBytes) } : {}),
    ...(inc.includePayloadBytes ? { payload_b64url: bytesToB64url(r.payloadBytes) } : {}),
    ...(inc.includeFramedBytes ? { framed_b64url: bytesToB64url(r.framedBytes) } : {}),
  });
  return env;
}

export type HashJsonInput = Readonly<{
  domain: string;
  value: unknown;
  canon?: CanonId; // currently only hf:canonical-json:v1
  alg?: HashAlg;
  encoding?: DigestEncoding;
  include?: HashMaterialInclude;
}>;

export type HashUtf8Input = Readonly<{
  domain: string;
  text: string;
  alg?: HashAlg;
  encoding?: DigestEncoding;
  include?: HashMaterialInclude;
}>;

export type HashRawInput = Readonly<{
  domain: string;
  bytes: Uint8Array;
  alg?: HashAlg;
  encoding?: DigestEncoding;
  include?: HashMaterialInclude;
}>;

/**
 * Hash JSON using the v1 contract.
 * canon is currently fixed to hf:canonical-json:v1; passing anything else is rejected.
 */
export function hashJson(input: HashJsonInput): HashEnvelopeV1 {
  const canon = input.canon ?? CANONICAL_JSON_ID;
  if (canon !== CANONICAL_JSON_ID) {
    throw new Error(`hashJson_unsupported_canon: ${String(canon)}`);
  }

  const r = contractHashJson({
    domain: input.domain,
    value: input.value,
    ...(input.alg !== undefined ? { alg: input.alg } : {}),
    ...(input.encoding !== undefined ? { encoding: input.encoding } : {}),
  });

  return buildEnvelopeV1("json", r, input.include);
}

/**
 * Hash UTF-8 text by hashing its raw UTF-8 bytes under the domain (v1).
 */
export function hashUtf8(input: HashUtf8Input): HashEnvelopeV1 {
  const s = String(input.text ?? "");
  const byteLen = Buffer.byteLength(s, "utf8");
  if (byteLen > MAX_PAYLOAD_BYTES) {
    throw new Error(`hashUtf8_payload_too_large: ${byteLen} > ${MAX_PAYLOAD_BYTES}`);
  }
  const bytes = Buffer.from(s, "utf8");

  const r = contractHashRaw({
    domain: input.domain,
    bytes,
    ...(input.alg !== undefined ? { alg: input.alg } : {}),
    ...(input.encoding !== undefined ? { encoding: input.encoding } : {}),
  });

  return buildEnvelopeV1("utf8", r, input.include);
}

/**
 * Hash raw bytes under the domain (v1).
 */
export function hashRaw(input: HashRawInput): HashEnvelopeV1 {
  const r = contractHashRaw({
    domain: input.domain,
    bytes: input.bytes,
    ...(input.alg !== undefined ? { alg: input.alg } : {}),
    ...(input.encoding !== undefined ? { encoding: input.encoding } : {}),
  });

  return buildEnvelopeV1("raw", r, input.include);
}