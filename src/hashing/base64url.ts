// src/hashing/base64url.ts
// Version: 1.0-base64url-strict-v1 | 2026-02-17
// Purpose:
//   Strict base64url utilities with canonical-form enforcement and size guards.
// Notes:
//   - Rejects padding ("=") and non-url-safe chars.
//   - Enforces canonical form by round-tripping through Buffer.
//   - Use maxBytes to prevent allocation abuse.
import { MAX_PAYLOAD_BYTES } from "./limits.js";

const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export class Base64UrlError extends Error {
  code: string;
  constructor(message: string, code = "B64URL_INVALID") {
    super(message);
    this.name = "Base64UrlError";
    this.code = code;
  }
}

function maxCharsForBytes(maxBytes: number): number {
  // base64 expands by 4/3; allow a tiny constant slack.
  return Math.ceil(maxBytes / 3) * 4 + 8;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Base64UrlError("encodeBase64Url_invalid_bytes: must be Uint8Array");
  }
  return Buffer.from(bytes).toString("base64url");
}

export function decodeBase64UrlStrict(
  input: unknown,
  opts?: { maxBytes?: number; allowEmpty?: boolean }
): Uint8Array {
  const allowEmpty = Boolean(opts?.allowEmpty);
  const maxBytes = typeof opts?.maxBytes === "number" ? Math.trunc(opts.maxBytes) : MAX_PAYLOAD_BYTES;

  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new Base64UrlError("decodeBase64UrlStrict_invalid_maxBytes");
  }

  if (typeof input !== "string") {
    throw new Base64UrlError("decodeBase64UrlStrict_invalid_input: must be string");
  }

  const s = input.trim();
  if (!s) {
    if (allowEmpty) return new Uint8Array(0);
    throw new Base64UrlError("decodeBase64UrlStrict_empty");
  }

  if (s.includes("=")) {
    throw new Base64UrlError("decodeBase64UrlStrict_padding_not_allowed");
  }

  if (!B64URL_RE.test(s)) {
    throw new Base64UrlError("decodeBase64UrlStrict_invalid_chars");
  }

  const mod = s.length % 4;
  if (mod === 1) {
    throw new Base64UrlError("decodeBase64UrlStrict_invalid_length");
  }

  const maxChars = maxCharsForBytes(maxBytes);
  if (s.length > maxChars) {
    throw new Base64UrlError("decodeBase64UrlStrict_too_large");
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(s, "base64url");
  } catch (err) {
    throw new Base64UrlError("decodeBase64UrlStrict_decode_failed");
  }

  if (buf.byteLength > maxBytes) {
    throw new Base64UrlError("decodeBase64UrlStrict_decoded_too_large");
  }

  // Canonical-form enforcement: round-trip must match exactly.
  const rt = buf.toString("base64url");
  if (rt !== s) {
    throw new Base64UrlError("decodeBase64UrlStrict_non_canonical");
  }

  return new Uint8Array(buf);
}