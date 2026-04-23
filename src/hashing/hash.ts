// src/hashing/hash.ts
// Version: 1.0-hash-contract-hash-v1 | 2026-02-17
// Purpose:
//   Algorithm + output encoding glue (pure).
// Contract:
//   hashBytes({ alg, bytes }) -> digestBytes
//   encodeDigest({ encoding, digestBytes }) -> string

import * as crypto from "node:crypto";
import type { HashAlg, DigestEncoding } from "./types.js";

export function hashBytes(opts: { alg: HashAlg; bytes: Uint8Array }): Uint8Array {
  const alg = opts.alg;
  const bytes = opts.bytes;

  if (!(bytes instanceof Uint8Array)) throw new Error("hashBytes_invalid_bytes: must be Uint8Array");

  switch (alg) {
    case "sha3-512": {
      const d = crypto.createHash("sha3-512").update(Buffer.from(bytes)).digest();
      return d; // Buffer is Uint8Array-compatible
    }
    default: {
      const _exhaustive: never = alg;
      throw new Error(`hashBytes_unsupported_alg: ${String(_exhaustive)}`);
    }
  }
}

export function encodeDigest(opts: { encoding: DigestEncoding; digestBytes: Uint8Array }): string {
  const enc = opts.encoding;
  const b = opts.digestBytes;

  if (!(b instanceof Uint8Array)) throw new Error("encodeDigest_invalid_bytes: must be Uint8Array");

  const buf = Buffer.from(b);

  switch (enc) {
    case "hex":
      return buf.toString("hex");
    case "hex_lower":
      return buf.toString("hex").toLowerCase();
    case "base64":
      return buf.toString("base64");
    case "base64url":
      return buf.toString("base64url");
    default: {
      const _exhaustive: never = enc;
      throw new Error(`encodeDigest_unsupported_encoding: ${String(_exhaustive)}`);
    }
  }
}