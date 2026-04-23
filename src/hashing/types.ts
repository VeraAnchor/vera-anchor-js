// src/hashing/types.ts
// Version: 1.0-hash-factory-types-v1 | 2026-02-17
// Purpose:
//   Versioned envelopes + strict request/response typing for Hash Factory.
// Notes:
//   - Keep contract evolution explicit: bump envelope version + ids when semantics change.
//   - No timestamps, no randomness, no environment: fully deterministic outputs.

export const HASH_FACTORY_CONTRACT_ID = "hf-contract-v1" as const;
export type HashFactoryContractId = typeof HASH_FACTORY_CONTRACT_ID;

export const FRAME_ID = "hf:frame:v1" as const;
export type FrameId = typeof FRAME_ID;

export const CANONICAL_JSON_ID = "hf:canonical-json:v1" as const;
export type CanonId = typeof CANONICAL_JSON_ID;

export const HASH_ALGS = ["sha3-512"] as const;
export type HashAlg = (typeof HASH_ALGS)[number];

export const DIGEST_ENCODINGS = ["hex", "hex_lower", "base64", "base64url"] as const;
export type DigestEncoding = (typeof DIGEST_ENCODINGS)[number];

export const ENVELOPE_VERSIONS = ["v1"] as const;
export type HashEnvelopeVersion = (typeof ENVELOPE_VERSIONS)[number];

export const HASH_KINDS = ["json", "utf8", "raw"] as const;
export type HashKind = (typeof HASH_KINDS)[number];

export type HashEnvelopeJsonV1 = Readonly<{
  v: "v1";
  kind: "json";
  contract_id: HashFactoryContractId;
  frame: FrameId;
  canonical_json: CanonId;

  alg: HashAlg;
  encoding: DigestEncoding;

  domain: string;
  digest: string;

  payload_bytes_len: number;
  framed_bytes_len: number;

  digest_bytes_b64url?: string;
  payload_b64url?: string;
  framed_b64url?: string;
}>;

export type HashEnvelopeBytesV1 = Readonly<{
  v: "v1";
  kind: "utf8" | "raw";

  contract_id: HashFactoryContractId;
  frame: FrameId;
  canonical_json?: never;

  alg: HashAlg;
  encoding: DigestEncoding;

  domain: string;
  digest: string;

  payload_bytes_len: number;
  framed_bytes_len: number;

  digest_bytes_b64url?: string;
  payload_b64url?: string;
  framed_b64url?: string;
}>;

export type HashEnvelopeV1 = HashEnvelopeJsonV1 | HashEnvelopeBytesV1;

export type HashEnvelope = HashEnvelopeV1;

export type HashMaterialInclude = Readonly<{
  includeDigestBytes?: boolean;
  includePayloadBytes?: boolean;
  includeFramedBytes?: boolean;
}>;

export type HashRequestV1 =
  | Readonly<{
      v: "v1";
      kind: "json";
      domain: string;
      alg?: HashAlg;
      encoding?: DigestEncoding;
      canon?: CanonId; // defaults to hf:canonical-json:v1
      value: unknown;
      include?: HashMaterialInclude;
    }>
  | Readonly<{
      v: "v1";
      kind: "utf8";
      domain: string;
      alg?: HashAlg;
      encoding?: DigestEncoding;
      text: string;
      include?: HashMaterialInclude;
    }>
  | Readonly<{
      v: "v1";
      kind: "raw";
      domain: string;
      alg?: HashAlg;
      encoding?: DigestEncoding;
      bytes_b64url: string;
      include?: HashMaterialInclude;
    }>;