// src/hashing/validators.ts
// Version: 1.0-hash-factory-runtime-validators-v1 | 2026-02-17
// Purpose:
//   Runtime validation for untrusted JSON at boundaries.
//   - parseHashRequestV1(body) -> HashRequestV1
//   - parseHashEnvelopeV1(body) -> HashEnvelopeV1
// Notes:
//   - Strict: rejects unknown keys.
//   - Enforces canonical base64url for material fields.
//   - Enforces discriminated envelope shape (canonical_json only for kind:"json").
//   - Keeps core hashing pure; validators are boundary hardening.

import {
  CANONICAL_JSON_ID,
  FRAME_ID,
  HASH_FACTORY_CONTRACT_ID,
  HASH_KINDS,
  HASH_ALGS,
  DIGEST_ENCODINGS,
  type HashRequestV1,
  type HashEnvelopeV1,
  type HashEnvelopeJsonV1,
  type HashEnvelopeBytesV1,
  type HashKind,
  type HashAlg,
  type DigestEncoding,
  type HashMaterialInclude,
} from "./types.js";
import { decodeBase64UrlStrict, Base64UrlError } from "./base64url.js";
import { encodeDigest } from "./hash.js";
import {
  DOMAIN_MIN,
  DOMAIN_MAX,
  DOMAIN_RE,
  MAX_PAYLOAD_BYTES,
  MAX_FRAMED_BYTES,
  SHA3_512_BYTES,
} from "./limits.js";

export class HashValidationError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, opts?: { code?: string; statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = "HashValidationError";
    this.code = opts?.code ?? "HASH_VALIDATION_FAILED";
    this.statusCode = opts?.statusCode ?? 400;
    if (opts?.cause) (this as any).cause = opts.cause;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function assertNoUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const allow = new Set(allowed);
  for (const k of Object.keys(obj)) {
    if (!allow.has(k)) {
      throw new HashValidationError(`${where}_unknown_key: ${k}`, { code: "SCHEMA_UNKNOWN_KEY" });
    }
  }
}

function asString(x: unknown): string {
  if (typeof x !== "string") throw new HashValidationError("schema_invalid_string", { code: "SCHEMA_INVALID" });
  return x;
}

function asInt(x: unknown, where: string): number {
  if (typeof x !== "number" || !Number.isFinite(x) || !Number.isInteger(x)) {
    throw new HashValidationError(`${where}_invalid_int`, { code: "SCHEMA_INVALID" });
  }
  return x;
}

function parseDomain(x: unknown): string {
  const d = asString(x).trim();
  if (d.length < DOMAIN_MIN || d.length > DOMAIN_MAX) {
    throw new HashValidationError("domain_invalid_length", { code: "DOMAIN_INVALID" });
  }
  if (!DOMAIN_RE.test(d)) {
    throw new HashValidationError("domain_invalid_format", { code: "DOMAIN_INVALID" });
  }
  const db = Buffer.from(d, "utf8");
  if (db.length !== d.length) {
    throw new HashValidationError("domain_invalid_non_ascii", { code: "DOMAIN_INVALID" });
  }
  return d;
}

function parseKind(x: unknown): HashKind {
  const k = asString(x);
  if (!HASH_KINDS.includes(k as any)) {
    throw new HashValidationError("kind_invalid", { code: "SCHEMA_INVALID" });
  }
  return k as HashKind;
}

function parseAlg(x: unknown): HashAlg | undefined {
  if (x === undefined) return undefined;
  const a = asString(x);
  if (!HASH_ALGS.includes(a as any)) {
    throw new HashValidationError("alg_invalid", { code: "SCHEMA_INVALID" });
  }
  return a as HashAlg;
}

function parseEncoding(x: unknown): DigestEncoding | undefined {
  if (x === undefined) return undefined;
  const e = asString(x);
  if (!DIGEST_ENCODINGS.includes(e as any)) {
    throw new HashValidationError("encoding_invalid", { code: "SCHEMA_INVALID" });
  }
  return e as DigestEncoding;
}

function parseInclude(x: unknown): HashMaterialInclude | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    throw new HashValidationError("include_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["includeDigestBytes", "includePayloadBytes", "includeFramedBytes"], "include");

  const out: HashMaterialInclude = Object.freeze({
    ...(x.includeDigestBytes !== undefined ? { includeDigestBytes: Boolean(x.includeDigestBytes) } : {}),
    ...(x.includePayloadBytes !== undefined ? { includePayloadBytes: Boolean(x.includePayloadBytes) } : {}),
    ...(x.includeFramedBytes !== undefined ? { includeFramedBytes: Boolean(x.includeFramedBytes) } : {}),
  });

  return out;
}

function assertDigestFormat(digest: string, encoding: DigestEncoding): void {
  if (encoding === "hex" || encoding === "hex_lower") {
    if (!/^[0-9a-fA-F]+$/.test(digest) || digest.length !== 128) {
      throw new HashValidationError("digest_invalid_hex", { code: "SCHEMA_INVALID" });
    }
    if (encoding === "hex_lower" && digest !== digest.toLowerCase()) {
      throw new HashValidationError("digest_invalid_hex_lower", { code: "SCHEMA_INVALID" });
    }
    return;
  }

  if (encoding === "base64") {
    let b: Buffer;
    try {
      b = Buffer.from(digest, "base64");
    } catch {
      throw new HashValidationError("digest_invalid_base64", { code: "SCHEMA_INVALID" });
    }
    if (b.byteLength !== SHA3_512_BYTES) {
      throw new HashValidationError("digest_invalid_base64_len", { code: "SCHEMA_INVALID" });
    }
    if (b.toString("base64") !== digest) {
      throw new HashValidationError("digest_non_canonical_base64", { code: "SCHEMA_INVALID" });
    }
    return;
  }

  if (encoding === "base64url") {
    const b = decodeBase64UrlStrict(digest, { maxBytes: SHA3_512_BYTES });
    if (b.byteLength !== SHA3_512_BYTES) {
      throw new HashValidationError("digest_invalid_base64url_len", { code: "SCHEMA_INVALID" });
    }
    return;
  }

  throw new HashValidationError("digest_invalid_encoding", { code: "SCHEMA_INVALID" });
}

export function parseHashRequestV1(body: unknown): HashRequestV1 {
  if (!isRecord(body)) {
    throw new HashValidationError("request_invalid_body", { code: "SCHEMA_INVALID" });
  }

  const v = asString(body.v);
  if (v !== "v1") throw new HashValidationError("request_invalid_version", { code: "SCHEMA_INVALID" });

  const kind = parseKind(body.kind);
  const domain = parseDomain(body.domain);

  if (kind === "json") {
    assertNoUnknownKeys(
      body,
      ["v", "kind", "domain", "alg", "encoding", "canon", "value", "include"],
      "HashRequestV1.json"
    );

    const canon = body.canon === undefined ? undefined : asString(body.canon);
    if (canon !== undefined && canon !== CANONICAL_JSON_ID) {
      throw new HashValidationError("canon_unsupported", { code: "SCHEMA_INVALID" });
    }

    const algOpt = parseAlg(body.alg);
    const encOpt = parseEncoding(body.encoding);
    const incOpt = parseInclude(body.include);

    const req: HashRequestV1 = Object.freeze({
      v: "v1",
      kind: "json",
      domain,
      ...(algOpt !== undefined ? { alg: algOpt } : {}),
      ...(encOpt !== undefined ? { encoding: encOpt } : {}),
      ...(canon !== undefined ? { canon: CANONICAL_JSON_ID } : {}),
      value: (body as any).value,
      ...(incOpt !== undefined ? { include: incOpt } : {}),
    });

    return req;
  }

  if (kind === "utf8") {
    assertNoUnknownKeys(
      body,
      ["v", "kind", "domain", "alg", "encoding", "text", "include"],
      "HashRequestV1.utf8"
    );

    const text = asString((body as any).text);
    const byteLen = Buffer.byteLength(text, "utf8");
    if (byteLen > MAX_PAYLOAD_BYTES) {
      throw new HashValidationError("utf8_payload_too_large", { code: "PAYLOAD_TOO_LARGE" });
    }

    const algOpt = parseAlg(body.alg);
    const encOpt = parseEncoding(body.encoding);
    const incOpt = parseInclude(body.include);

    const req: HashRequestV1 = Object.freeze({
      v: "v1",
      kind: "utf8",
      domain,
      ...(algOpt !== undefined ? { alg: algOpt } : {}),
      ...(encOpt !== undefined ? { encoding: encOpt } : {}),
      text,
      ...(incOpt !== undefined ? { include: incOpt } : {}),
    });

    return req;
  }

  // kind === "raw"
  assertNoUnknownKeys(
    body,
    ["v", "kind", "domain", "alg", "encoding", "bytes_b64url", "include"],
    "HashRequestV1.raw"
  );

  const bytes_b64url = asString((body as any).bytes_b64url);
  try {
    decodeBase64UrlStrict(bytes_b64url, { maxBytes: MAX_PAYLOAD_BYTES, allowEmpty: true });
  } catch (err) {
    const cause = err instanceof Base64UrlError ? err : undefined;
    throw new HashValidationError("raw_bytes_invalid", { code: "SCHEMA_INVALID", cause });
  }

  const algOpt = parseAlg(body.alg);
  const encOpt = parseEncoding(body.encoding);
  const incOpt = parseInclude(body.include);

  const req: HashRequestV1 = Object.freeze({
    v: "v1",
    kind: "raw",
    domain,
    ...(algOpt !== undefined ? { alg: algOpt } : {}),
    ...(encOpt !== undefined ? { encoding: encOpt } : {}),
    bytes_b64url,
    ...(incOpt !== undefined ? { include: incOpt } : {}),
  });

  return req;
}

export function parseHashEnvelopeV1(body: unknown): HashEnvelopeV1 {
  if (!isRecord(body)) {
    throw new HashValidationError("envelope_invalid_body", { code: "SCHEMA_INVALID" });
  }

  const v = asString(body.v);
  if (v !== "v1") throw new HashValidationError("envelope_invalid_version", { code: "SCHEMA_INVALID" });

  const kind = parseKind(body.kind);

  const contract_id = asString(body.contract_id);
  const frame = asString(body.frame);

  if (contract_id !== HASH_FACTORY_CONTRACT_ID) {
    throw new HashValidationError("envelope_contract_id_mismatch", { code: "SCHEMA_INVALID" });
  }
  if (frame !== FRAME_ID) {
    throw new HashValidationError("envelope_frame_mismatch", { code: "SCHEMA_INVALID" });
  }

  const alg = asString(body.alg) as HashAlg;
  if (!HASH_ALGS.includes(alg as any)) throw new HashValidationError("envelope_alg_invalid", { code: "SCHEMA_INVALID" });

  const encoding = asString(body.encoding) as DigestEncoding;
  if (!DIGEST_ENCODINGS.includes(encoding as any)) {
    throw new HashValidationError("envelope_encoding_invalid", { code: "SCHEMA_INVALID" });
  }

  const domain = parseDomain(body.domain);
  const digest = asString(body.digest);
  assertDigestFormat(digest, encoding);

  const payload_bytes_len = asInt(body.payload_bytes_len, "payload_bytes_len");
  const framed_bytes_len = asInt(body.framed_bytes_len, "framed_bytes_len");

  if (payload_bytes_len < 0 || payload_bytes_len > MAX_PAYLOAD_BYTES) {
    throw new HashValidationError("envelope_payload_len_invalid", { code: "SCHEMA_INVALID" });
  }
  if (framed_bytes_len < 0 || framed_bytes_len > MAX_FRAMED_BYTES) {
    throw new HashValidationError("envelope_framed_len_invalid", { code: "SCHEMA_INVALID" });
  }

  const optDigestBytes = body.digest_bytes_b64url;
  const optPayload = body.payload_b64url;
  const optFramed = body.framed_b64url;

  if (optDigestBytes !== undefined) {
    const b = decodeBase64UrlStrict(optDigestBytes, { maxBytes: SHA3_512_BYTES });
    if (b.byteLength !== SHA3_512_BYTES) throw new HashValidationError("digest_bytes_len_invalid", { code: "SCHEMA_INVALID" });
    const derived = encodeDigest({ encoding, digestBytes: b });
    if (derived !== digest) {
      throw new HashValidationError("digest_bytes_mismatch_digest", { code: "SCHEMA_INVALID" });
    }
  }

  if (optPayload !== undefined) {
    const b = decodeBase64UrlStrict(optPayload, { maxBytes: MAX_PAYLOAD_BYTES, allowEmpty: true });
    if (b.byteLength !== payload_bytes_len) {
      throw new HashValidationError("payload_b64url_len_mismatch", { code: "SCHEMA_INVALID" });
    }
  }

  if (optFramed !== undefined) {
    const b = decodeBase64UrlStrict(optFramed, { maxBytes: MAX_FRAMED_BYTES, allowEmpty: true });
    if (b.byteLength !== framed_bytes_len) {
      throw new HashValidationError("framed_b64url_len_mismatch", { code: "SCHEMA_INVALID" });
    }
  }

  if (kind === "json") {
    assertNoUnknownKeys(
      body,
      [
        "v",
        "kind",
        "contract_id",
        "frame",
        "canonical_json",
        "alg",
        "encoding",
        "domain",
        "digest",
        "payload_bytes_len",
        "framed_bytes_len",
        "digest_bytes_b64url",
        "payload_b64url",
        "framed_b64url",
      ],
      "HashEnvelopeV1.json"
    );

    const canonical_json = asString(body.canonical_json);
    if (canonical_json !== CANONICAL_JSON_ID) {
      throw new HashValidationError("envelope_canonical_json_mismatch", { code: "SCHEMA_INVALID" });
    }

    const env: HashEnvelopeJsonV1 = Object.freeze({
      v: "v1",
      kind: "json",
      contract_id: HASH_FACTORY_CONTRACT_ID,
      frame: FRAME_ID,
      canonical_json: CANONICAL_JSON_ID,
      alg,
      encoding,
      domain,
      digest,
      payload_bytes_len,
      framed_bytes_len,
      ...(optDigestBytes !== undefined ? { digest_bytes_b64url: asString(optDigestBytes) } : {}),
      ...(optPayload !== undefined ? { payload_b64url: asString(optPayload) } : {}),
      ...(optFramed !== undefined ? { framed_b64url: asString(optFramed) } : {}),
    });

    return env;
  }

  // utf8 | raw: canonical_json must be absent
  assertNoUnknownKeys(
    body,
    [
      "v",
      "kind",
      "contract_id",
      "frame",
      "alg",
      "encoding",
      "domain",
      "digest",
      "payload_bytes_len",
      "framed_bytes_len",
      "digest_bytes_b64url",
      "payload_b64url",
      "framed_b64url",
    ],
    "HashEnvelopeV1.bytes"
  );

  if ((body as any).canonical_json !== undefined) {
    throw new HashValidationError("envelope_canonical_json_forbidden", { code: "SCHEMA_INVALID" });
  }

  const env: HashEnvelopeBytesV1 = Object.freeze({
    v: "v1",
    kind: kind as "utf8" | "raw",
    contract_id: HASH_FACTORY_CONTRACT_ID,
    frame: FRAME_ID,
    alg,
    encoding,
    domain,
    digest,
    payload_bytes_len,
    framed_bytes_len,
    ...(optDigestBytes !== undefined ? { digest_bytes_b64url: asString(optDigestBytes) } : {}),
    ...(optPayload !== undefined ? { payload_b64url: asString(optPayload) } : {}),
    ...(optFramed !== undefined ? { framed_b64url: asString(optFramed) } : {}),
  });

  return env;
}