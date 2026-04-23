// src/hashing/domain.ts
// Version: 1.0-hash-contract-frame-v1 | 2026-02-17
// Purpose:
//   Domain separation + unambiguous framing of “what bytes are actually hashed”.
// Contract:
//   frame(domain, payloadBytes) => framedBytes
//   framedBytes = MAGIC || 0x00 || u16be(domainLen) || domainUtf8 || u32be(payloadLen) || payload
// Notes:
//   - Length-prefixing prevents boundary ambiguity.
//   - Domain charset/bounds prevent sneaky whitespace / Unicode lookalikes.

import { DOMAIN_MIN, DOMAIN_MAX, DOMAIN_RE, MAX_PAYLOAD_BYTES } from "./limits.js";

const MAGIC = Buffer.from("hf:frame:v1", "utf8");

function assertDomain(domain: string): string {
  const d = String(domain ?? "").trim();
  if (d.length < DOMAIN_MIN || d.length > DOMAIN_MAX) {
    throw new Error(`domain_invalid: length ${d.length} not in [${DOMAIN_MIN}, ${DOMAIN_MAX}]`);
  }
  if (!DOMAIN_RE.test(d)) {
    throw new Error("domain_invalid: must match /^[a-z0-9][a-z0-9._:/-]{0,63}$/");
  }
  return d;
}

function assertPayload(payload: Uint8Array): Uint8Array {
  if (!(payload instanceof Uint8Array)) {
    throw new Error("payload_invalid: must be Uint8Array");
  }
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload_invalid: too large (${payload.byteLength} > ${MAX_PAYLOAD_BYTES})`);
  }
  return payload;
}

function u16be(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error("u16be_out_of_range");
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function u32be(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error("u32be_out_of_range");
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/**
 * frame(domain, payloadBytes) -> framedBytes
 * This is the byte-level contract safety belt.
 */
export function frame(domain: string, payload: Uint8Array): Uint8Array {
  const d = assertDomain(domain);
  const p = assertPayload(payload);

  const domainBytes = Buffer.from(d, "utf8");
  if (domainBytes.length !== d.length) {
    throw new Error("domain_invalid: must be ASCII");
  }

  const out = Buffer.concat([
    MAGIC,
    Buffer.from([0x00]),
    u16be(domainBytes.length),
    domainBytes,
    u32be(p.byteLength),
    Buffer.from(p),
  ]);

  return out;
}