// src/hashing/canonicalJson.ts
// Version: 1.0-hash-contract-canonical-json-v1 | 2026-02-17
// Purpose:
//   Deterministic JSON canonicalization -> UTF-8 bytes.
// Contract:
//   canonicalize(value) -> Uint8Array (UTF-8 bytes of canonical JSON text)
// Notes:
//   - Strict by design: throws on unsupported JS types instead of using sentinels.
//   - Stable key order (JS sort: UTF-16 code units).
//   - Only “plain objects” allowed: Object.prototype or null-prototype.
import { MAX_CANONICAL_JSON_BYTES } from "./limits.js";

const MAX_DEPTH = 64;
const MAX_KEYS_TOTAL = 200_000;
const MAX_ARRAY_LEN = 200_000;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x == null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function quoteString(s: string): string {
  // JSON.stringify is deterministic for strings.
  return JSON.stringify(s);
}

function quoteNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error("canonicalize_invalid_number: must be finite");
  // JSON.stringify has stable minimal formatting; handles -0 -> "0".
  return JSON.stringify(n);
}

function assertOkKey(k: string): string {
  // JSON allows any string keys; we just enforce it’s a string.
  return String(k);
}

export function canonicalize(value: unknown): Uint8Array {
  const seen = new WeakSet<object>();
  let keysSeen = 0;
  let budget = 0;

  function addBudget(n: number): void {
    budget += n;
    if (budget > MAX_CANONICAL_JSON_BYTES) {
      throw new Error(`canonicalize_too_large: > ${MAX_CANONICAL_JSON_BYTES}`);
    }
  } 

  const walk = (x: any, depth: number): string => {
    if (depth > MAX_DEPTH) throw new Error(`canonicalize_depth_exceeded: > ${MAX_DEPTH}`);

    if (x === null) return "null";

    const t = typeof x;

    if (t === "string") {
      const out = quoteString(x);
      addBudget(Buffer.byteLength(out, "utf8"));
      return out;
    }
    if (t === "boolean") return x ? "true" : "false";
    if (t === "number") {
      const out = quoteNumber(x);
      addBudget(out.length);
      return out;
    }
    if (t === "bigint") return quoteString(x.toString(10)); 

    if (t === "undefined" || t === "function" || t === "symbol") {
      throw new Error(`canonicalize_unsupported_type: ${t}`);
    }

    // Uint8Array / Buffer must be passed as raw bytes to hashing, not embedded in canonical JSON.
    if (x instanceof Uint8Array) {
      throw new Error("canonicalize_unsupported_type: Uint8Array (hash bytes directly instead)");
    }

    if (Array.isArray(x)) {
      if (x.length > MAX_ARRAY_LEN) throw new Error(`canonicalize_array_too_large: > ${MAX_ARRAY_LEN}`);
      const parts = new Array<string>(x.length);
      for (let i = 0; i < x.length; i++) {
        // Strict: undefined/function/symbol are not silently coerced to null.
        parts[i] = walk(x[i], depth + 1);
      }
      const out = `[${parts.join(",")}]`;
      addBudget(out.length);
      return out;
    }

    if (typeof x === "object") {
      if (!isPlainObject(x)) {
        const name = x?.constructor?.name ? String(x.constructor.name) : "object";
        throw new Error(`canonicalize_unsupported_object: ${name} (only plain objects allowed)`);
      }

      if (seen.has(x as object)) throw new Error("canonicalize_circular: circular reference detected");
      seen.add(x as object);

      const keys = Object.keys(x).map(assertOkKey).sort();

      const kv: string[] = [];
      for (const k of keys) {
        keysSeen++;
        if (keysSeen > MAX_KEYS_TOTAL) throw new Error(`canonicalize_keys_exceeded: > ${MAX_KEYS_TOTAL}`);

        const v = (x as any)[k];

        // Strict: omit nothing silently
        if (typeof v === "undefined") throw new Error("canonicalize_undefined_value: object property is undefined");

        kv.push(`${quoteString(k)}:${walk(v, depth + 1)}`);
      }

      const out = `{${kv.join(",")}}`;
      addBudget(out.length);
      return out;
    }

    // Should never reach here
    throw new Error("canonicalize_unreachable");
  };

  const json = walk(value as any, 0);
  const byteLen = Buffer.byteLength(json, "utf8");
  if (byteLen > MAX_CANONICAL_JSON_BYTES) throw new Error(`canonicalize_too_large: ${byteLen} > ${MAX_CANONICAL_JSON_BYTES}`);
  return Buffer.from(json, "utf8");
}