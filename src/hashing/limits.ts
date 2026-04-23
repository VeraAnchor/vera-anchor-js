// ============================================================================
// File: src/hashing/limits.ts
// Version: 1.0-hash-factory-limits-v1 | 2026-02-17
// Purpose:
//   Single source of truth for hashing contract limits + domain rules.
// Notes:
//   Must be aligned across canonicalization, framing, validators, verifier.
// ============================================================================

// Domain constraints (must match framing + validators)
export const DOMAIN_MIN = 1 as const;
export const DOMAIN_MAX = 64 as const;
export const DOMAIN_RE = /^[a-z0-9][a-z0-9._:/-]{0,63}$/;

// Payload limits
export const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024; // 32MB

// Canonical JSON output cap (should not exceed payload cap)
export const MAX_CANONICAL_JSON_BYTES = MAX_PAYLOAD_BYTES;

// Frame overhead:
// MAGIC("hf:frame:v1") = 11 bytes
// + 0x00 separator = 1
// + u16 domain len = 2
// + domain bytes <= 64
// + u32 payload len = 4
// Total overhead <= 11+1+2+64+4 = 82 bytes
export const MAX_DOMAIN_BYTES = DOMAIN_MAX;
export const FRAME_MAGIC_BYTES = 11 as const;
export const FRAME_OVERHEAD_MAX = (FRAME_MAGIC_BYTES + 1 + 2 + MAX_DOMAIN_BYTES + 4); // 82

// Framed bytes cap used by validators/verifier
export const MAX_FRAMED_BYTES = (MAX_PAYLOAD_BYTES + FRAME_OVERHEAD_MAX);

// Algorithm-specific constants used by validators/verifier
export const SHA3_512_BYTES = 64 as const;