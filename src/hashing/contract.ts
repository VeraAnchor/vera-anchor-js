// src/hashing/contract.ts
// Version: 1.0-hash-contract-orchestrator-v1 | 2026-02-17
// Purpose:
//   High-level, pure contract helpers that compose:
//     canonicalize (JSON -> bytes) + frame(domain, bytes) + hashBytes + encodeDigest
//   These are the functions API/routes will call.
// Notes:
//   - Pure: no Fastify, no DB, no env reads.
//   - Strict: JSON canonicalization rejects unsupported JS types.
//   - Domain separation is mandatory.
//   - Output encodings are explicit.

import { canonicalize } from "./canonicalJson.js";
import { frame } from "./domain.js";
import { encodeDigest, hashBytes } from "./hash.js";
import type { DigestEncoding, HashAlg } from "./types.js";

export type HashContractId = "hf-contract-v1";

/**
 * Explicit metadata exposed for verifiers
 */
export type HashContractInfo = Readonly<{
  contractId: HashContractId;
  frame: "hf:frame:v1";
  canonicalJson: "hf:canonical-json:v1";
  algorithm: HashAlg;
  encoding: DigestEncoding;
}>;

export type HashJsonOpts = Readonly<{
  domain: string;
  value: unknown;
  alg?: HashAlg;
  encoding?: DigestEncoding;
}>;

export type HashRawOpts = Readonly<{
  domain: string;
  bytes: Uint8Array;
  alg?: HashAlg;
  encoding?: DigestEncoding;
}>;

export type HashResult = Readonly<{
  domain: string;
  digest: string;
  digestBytes: Uint8Array;
  framedBytes: Uint8Array;
  payloadBytes: Uint8Array;
  info: HashContractInfo;
}>;

const DEFAULT_ALG: HashAlg = "sha3-512";
const DEFAULT_ENCODING: DigestEncoding = "hex_lower";

function buildInfo(alg: HashAlg, encoding: DigestEncoding): HashContractInfo {
  return Object.freeze({
    contractId: "hf-contract-v1",
    frame: "hf:frame:v1",
    canonicalJson: "hf:canonical-json:v1",
    algorithm: alg,
    encoding,
  });
}

export const HF_HASH_CONTRACT_INFO = Object.freeze({
  contract_id: "hf-contract-v1",
  frame: "hf:frame:v1",
  canonical_json: "hf:canonical-json:v1",
  algorithm: "sha3-512",
  encoding: "hex_lower",
} as const);

/**
 * Hash raw bytes under a domain:
 *   digest = H( frame(domain, bytes) )
 */
export function hashRaw(opts: HashRawOpts): HashResult {
  const alg = opts.alg ?? DEFAULT_ALG;
  const encoding = opts.encoding ?? DEFAULT_ENCODING;

  const payloadBytes = opts.bytes;
  if (!(payloadBytes instanceof Uint8Array)) {
    throw new Error("hashRaw_invalid_bytes: must be Uint8Array");
  }

  const framedBytes = frame(opts.domain, payloadBytes);
  const digestBytes = hashBytes({ alg, bytes: framedBytes });
  const digest = encodeDigest({ encoding, digestBytes });

  return Object.freeze({
    domain: opts.domain,
    digest,
    digestBytes,
    framedBytes,
    payloadBytes,
    info: buildInfo(alg, encoding),
  });
}

/**
 * Hash JSON under a domain:
 *   payloadBytes = canonicalize(value)
 *   digest = H( frame(domain, payloadBytes) )
 */
export function hashJson(opts: HashJsonOpts): HashResult {
  const alg = opts.alg ?? DEFAULT_ALG;
  const encoding = opts.encoding ?? DEFAULT_ENCODING;

  const payloadBytes = canonicalize(opts.value);
  const framedBytes = frame(opts.domain, payloadBytes);
  const digestBytes = hashBytes({ alg, bytes: framedBytes });
  const digest = encodeDigest({ encoding, digestBytes });

  return Object.freeze({
    domain: opts.domain,
    digest,
    digestBytes,
    framedBytes,
    payloadBytes,
    info: buildInfo(alg, encoding),
  });
}

/**
 * Convenience: return only the encoded digest for JSON hashing.
 */
export function hashJsonDigest(opts: HashJsonOpts): string {
  return hashJson(opts).digest;
}

/**
 * Convenience: return only the encoded digest for raw-bytes hashing.
 */
export function hashRawDigest(opts: HashRawOpts): string {
  return hashRaw(opts).digest;
}

