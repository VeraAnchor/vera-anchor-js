// ============================================================================
// File: src/ingest/validators.ts
// Version: 1.0-hf-ingest-validators-v1 | 2026-03-06
// Purpose:
//   Runtime validation for untrusted generic ingest JSON at HF boundaries.
// Notes:
//   - Strict: rejects unknown keys.
//   - Keeps routes/workflow/orchestrator fail-closed.
// ============================================================================

import type {
  FileMaterial,
  FileSetMaterial,
  IngestBundleV1,
  IngestIdentity,
  IngestResult,
  IngestInput,
  IngestItem,
  IngestMaterial,
  IngestMaterialKind,
  IngestMode,
  IngestRules,
  JsonMaterial,
  TextMaterial,
} from "./types.js";
import type { IngestReceiptV1 } from "./receipt.js";
import { HF_HASH_CONTRACT_INFO } from "../hashing/contract.js";
import {
  MAX_ARRAY_ITEMS,
  MAX_DOMAIN_LEN,
  MAX_GLOB_LEN,
  MAX_MEDIA_TYPE_LEN,
  MAX_META_DEPTH,
  MAX_OBJECT_KEY_LEN,
  MAX_POINTER_LEN,
  MAX_PROGRAM_LEN,
  MAX_SUFFIX_LEN,
  MAX_VERSION_LABEL_LEN,
} from "./limits.js";
import { normalizeRelPath } from "./pathNorm.js";
import { IngestValidationError } from "./errors.js";

const RE_OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const RE_PROGRAM = /^[a-z][a-z0-9_:-]{1,63}$/;
const RE_HEX512 = /^[0-9a-f]{128}$/;
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

const VALID_MODES = new Set<IngestMode>(["hash_only", "merkle_only", "register_and_anchor"]);
const VALID_KINDS = new Set<IngestMaterialKind>(["json", "text", "file", "file_set"]);

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function assertNoUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const allow = new Set(allowed);
  for (const k of Object.keys(obj)) {
    if (!allow.has(k)) {
      throw new IngestValidationError(`${where}_unknown_key: ${k}`, { code: "SCHEMA_UNKNOWN_KEY" });
    }
  }
}

function asString(x: unknown, where: string): string {
  if (typeof x !== "string") {
    throw new IngestValidationError(`${where}_invalid_string`, { code: "SCHEMA_INVALID" });
  }
  return x;
}

function asOptionalString(x: unknown, where: string, maxLen: number): string | undefined {
  if (x === undefined || x === null) return undefined;
  const s = asString(x, where).trim();
  if (!s) return undefined;
  if (s.length > maxLen) {
    throw new IngestValidationError(`${where}_too_long`, { code: "SCHEMA_INVALID" });
  }
  return s;
}

function asBooleanLike(x: unknown, where: string): boolean {
  if (typeof x === "boolean") return x;
  if (typeof x === "string") {
    const s = x.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  throw new IngestValidationError(`${where}_invalid_boolean`, { code: "SCHEMA_INVALID" });
}

function asOptionalNonNegativeInt(x: unknown, where: string): number | undefined {
  if (x === undefined || x === null) return undefined;
  const n = Number(x);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new IngestValidationError(`${where}_invalid_int`, { code: "SCHEMA_INVALID" });
  }
  return n;
}

function asOptionalHex512(x: unknown, where: string): string | undefined {
  if (x === undefined || x === null) return undefined;
  const s = asString(x, where).trim().toLowerCase();
  if (!RE_HEX512.test(s)) {
    throw new IngestValidationError(`${where}_invalid_hex512`, { code: "SCHEMA_INVALID" });
  }
  return s;
}

function parseStringArray(
  x: unknown,
  where: string,
  maxLen: number,
  normalize?: (v: string) => string
): readonly string[] | undefined {
  if (x === undefined || x === null) return undefined;
  if (!Array.isArray(x)) {
    throw new IngestValidationError(`${where}_invalid_array`, { code: "SCHEMA_INVALID" });
  }
  if (x.length > MAX_ARRAY_ITEMS) {
    throw new IngestValidationError(`${where}_too_many_items`, { code: "SCHEMA_INVALID" });
  }

  const out: string[] = [];
  for (const item of x) {
    const raw = asString(item, where).trim();
    if (!raw) continue;
    const v = normalize ? normalize(raw) : raw;
    if (!v || v.length > maxLen) {
      throw new IngestValidationError(`${where}_item_invalid`, { code: "SCHEMA_INVALID" });
    }
    out.push(v);
  }

  return Object.freeze(out.slice());
}

function sanitizeJsonValue(x: unknown, depth = 0): unknown {
  if (depth > MAX_META_DEPTH) {
    throw new IngestValidationError("metadata_too_deep", { code: "SCHEMA_INVALID" });
  }

  if (x === null || typeof x === "string" || typeof x === "boolean") {
    return x;
  }

  if (typeof x === "number") {
    if (!Number.isFinite(x)) {
      throw new IngestValidationError("metadata_invalid_number", { code: "SCHEMA_INVALID" });
    }
    return x;
  }

  if (Array.isArray(x)) {
    if (x.length > MAX_ARRAY_ITEMS) {
      throw new IngestValidationError("metadata_array_too_large", { code: "SCHEMA_INVALID" });
    }
    return Object.freeze(x.map((v) => sanitizeJsonValue(v, depth + 1)));
  }

  if (!isRecord(x)) {
    throw new IngestValidationError("metadata_invalid", { code: "SCHEMA_INVALID" });
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new IngestValidationError("metadata_invalid_key", { code: "SCHEMA_INVALID" });
    }
    if (!k || k.length > MAX_OBJECT_KEY_LEN) {
      throw new IngestValidationError("metadata_invalid_key", { code: "SCHEMA_INVALID" });
    }
    out[k] = sanitizeJsonValue(v, depth + 1);
  }

  return Object.freeze(out);
}

function parseMode(x: unknown): IngestMode {
  const s = x === undefined ? "hash_only" : asString(x, "mode").trim();
  if (!VALID_MODES.has(s as IngestMode)) {
    throw new IngestValidationError("mode_invalid", { code: "SCHEMA_INVALID" });
  }
  return s as IngestMode;
}

function parseObjectKey(x: unknown): string {
  const s = asString(x, "object_key").trim();
  if (!s || s.length > MAX_OBJECT_KEY_LEN || !RE_OBJECT_KEY.test(s)) {
    throw new IngestValidationError("object_key_invalid", { code: "SCHEMA_INVALID" });
  }
  return s;
}

function parseProgram(x: unknown): string | undefined {
  if (x === undefined || x === null) return undefined;
  const s = asString(x, "program").trim();
  if (!s) return undefined;
  if (s.length > MAX_PROGRAM_LEN || !RE_PROGRAM.test(s)) {
    throw new IngestValidationError("program_invalid", { code: "SCHEMA_INVALID" });
  }
  return s;
}

function parseKind(x: unknown, where = "object_kind"): IngestMaterialKind {
  const s = asString(x, where).trim();
  if (!VALID_KINDS.has(s as IngestMaterialKind)) {
    throw new IngestValidationError(`${where}_invalid`, { code: "SCHEMA_INVALID" });
  }
  return s as IngestMaterialKind;
}

function parseIdentity(x: unknown): IngestIdentity {
  if (!isRecord(x)) {
    throw new IngestValidationError("identity_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["object_key", "object_kind", "version_label", "program"], "identity");

  const object_key = parseObjectKey(x.object_key);
  const object_kind = parseKind(x.object_kind, "object_kind");
  const version_label = asOptionalString(x.version_label, "version_label", MAX_VERSION_LABEL_LEN);
  const program = parseProgram(x.program);

  return Object.freeze({
    object_key,
    object_kind,
    ...(version_label !== undefined ? { version_label } : {}),
    ...(program !== undefined ? { program } : {}),
  });
}

function parseRules(x: unknown): IngestRules | undefined {
  if (x === undefined || x === null) return undefined;
  if (!isRecord(x)) {
    throw new IngestValidationError("rules_invalid", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    x,
    [
      "include_globs",
      "exclude_globs",
      "allowed_suffixes",
      "max_files",
      "max_total_bytes",
      "max_single_file_bytes",
      "follow_symlinks",
      "redact_paths",
      "normalize_line_endings",
    ],
    "rules"
  );

  const include_globs = parseStringArray(x.include_globs, "rules.include_globs", MAX_GLOB_LEN);
  const exclude_globs = parseStringArray(x.exclude_globs, "rules.exclude_globs", MAX_GLOB_LEN);
  const allowed_suffixes = parseStringArray(
    x.allowed_suffixes,
    "rules.allowed_suffixes",
    MAX_SUFFIX_LEN,
    (v) => v.toLowerCase()
  );
  if (allowed_suffixes) {
    for (const suf of allowed_suffixes) {
      if (!suf.startsWith(".")) {
        throw new IngestValidationError("rules.allowed_suffixes_item_invalid", { code: "SCHEMA_INVALID" });
      }
    }
  }

  const max_files = asOptionalNonNegativeInt(x.max_files, "rules.max_files");
  const max_total_bytes = asOptionalNonNegativeInt(x.max_total_bytes, "rules.max_total_bytes");
  const max_single_file_bytes = asOptionalNonNegativeInt(x.max_single_file_bytes, "rules.max_single_file_bytes");

  const follow_symlinks =
    x.follow_symlinks === undefined ? undefined : asBooleanLike(x.follow_symlinks, "rules.follow_symlinks");
  const redact_paths =
    x.redact_paths === undefined ? undefined : asBooleanLike(x.redact_paths, "rules.redact_paths");
  const normalize_line_endings =
    x.normalize_line_endings === undefined
      ? undefined
      : asBooleanLike(x.normalize_line_endings, "rules.normalize_line_endings");

  return Object.freeze({
    ...(include_globs !== undefined ? { include_globs } : {}),
    ...(exclude_globs !== undefined ? { exclude_globs } : {}),
    ...(allowed_suffixes !== undefined ? { allowed_suffixes } : {}),
    ...(max_files !== undefined ? { max_files } : {}),
    ...(max_total_bytes !== undefined ? { max_total_bytes } : {}),
    ...(max_single_file_bytes !== undefined ? { max_single_file_bytes } : {}),
    ...(follow_symlinks !== undefined ? { follow_symlinks } : {}),
    ...(redact_paths !== undefined ? { redact_paths } : {}),
    ...(normalize_line_endings !== undefined ? { normalize_line_endings } : {}),
  });
}

function parseJsonMaterial(x: unknown): JsonMaterial {
  if (!isRecord(x)) {
    throw new IngestValidationError("material_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["kind", "value"], "material");
  const kind = parseKind(x.kind, "material.kind");
  if (kind !== "json") {
    throw new IngestValidationError("material_kind_invalid", { code: "SCHEMA_INVALID" });
  }
  return Object.freeze({
    kind: "json",
    value: sanitizeJsonValue(x.value),
  });
}

function parseTextMaterial(x: unknown): TextMaterial {
  if (!isRecord(x)) {
    throw new IngestValidationError("material_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["kind", "text", "media_type"], "material");
  const kind = parseKind(x.kind, "material.kind");
  if (kind !== "text") {
    throw new IngestValidationError("material_kind_invalid", { code: "SCHEMA_INVALID" });
  }
  const text = asString(x.text, "material.text");
  const media_type = asOptionalString(x.media_type, "material.media_type", MAX_MEDIA_TYPE_LEN);

  return Object.freeze({
    kind: "text",
    text,
    ...(media_type !== undefined ? { media_type } : {}),
  });
}

function parseFileMaterial(x: unknown): FileMaterial {
  if (!isRecord(x)) {
    throw new IngestValidationError("material_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["kind", "path"], "material");
  const kind = parseKind(x.kind, "material.kind");
  if (kind !== "file") {
    throw new IngestValidationError("material_kind_invalid", { code: "SCHEMA_INVALID" });
  }
  const path = asString(x.path, "material.path").trim();
  if (!path) {
    throw new IngestValidationError("material.path_invalid", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    kind: "file",
    path,
  });
}

function parseFileSetMaterial(x: unknown): FileSetMaterial {
  if (!isRecord(x)) {
    throw new IngestValidationError("material_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["kind", "root_dir", "rules"], "material");
  const kind = parseKind(x.kind, "material.kind");
  if (kind !== "file_set") {
    throw new IngestValidationError("material_kind_invalid", { code: "SCHEMA_INVALID" });
  }
  const root_dir = asString(x.root_dir, "material.root_dir").trim();
  if (!root_dir) {
    throw new IngestValidationError("material.root_dir_invalid", { code: "SCHEMA_INVALID" });
  }
  const rules = parseRules(x.rules);

  return Object.freeze({
    kind: "file_set",
    root_dir,
    ...(rules ? { rules } : {}),
  });
}

function parseMaterial(x: unknown): IngestMaterial {
  if (!isRecord(x)) {
    throw new IngestValidationError("material_invalid", { code: "SCHEMA_INVALID" });
  }

  const kind = parseKind(x.kind, "material.kind");
  switch (kind) {
    case "json":
      return parseJsonMaterial(x);
    case "text":
      return parseTextMaterial(x);
    case "file":
      return parseFileMaterial(x);
    case "file_set":
      return parseFileSetMaterial(x);
    default:
      throw new IngestValidationError("material_kind_invalid", { code: "SCHEMA_INVALID" });
  }
}

export type IngestExecuteRequestV1 = IngestInput;

export function parseIngestExecuteRequestV1(body: unknown): IngestExecuteRequestV1 {
  if (!isRecord(body)) {
    throw new IngestValidationError("request_invalid_body", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    body,
    ["mode", "identity", "material", "metadata", "evidence_pointer", "domain", "proof_date", "issue_certificate"],
    "IngestExecuteRequestV1"
  );

  const mode = parseMode(body.mode);
  const identity = parseIdentity(body.identity);
  const material = parseMaterial(body.material);
  const metadata =
    body.metadata === undefined ? undefined : (sanitizeJsonValue(body.metadata) as Record<string, unknown>);
  const evidence_pointer = asOptionalString(body.evidence_pointer, "evidence_pointer", MAX_POINTER_LEN);
  const domain = asOptionalString(body.domain, "domain", MAX_DOMAIN_LEN);
  const proof_date = asOptionalString(body.proof_date, "proof_date", 10);
  const issue_certificate =
    body.issue_certificate === undefined
      ? undefined
      : asBooleanLike(body.issue_certificate, "issue_certificate");

  if (proof_date !== undefined && !RE_YMD.test(proof_date)) {
    throw new IngestValidationError("proof_date_invalid", { code: "SCHEMA_INVALID" });
  }

  if (identity.object_kind !== material.kind) {
    throw new IngestValidationError("identity_material_kind_mismatch", { code: "SCHEMA_INVALID" });
  }

  if (mode === "register_and_anchor" && !domain) {
    throw new IngestValidationError("domain_required", { code: "SCHEMA_INVALID" });
  }

  
  if (mode === "register_and_anchor" && !proof_date) {
    throw new IngestValidationError("proof_date_required", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    mode,
    identity,
    material,
    ...(metadata !== undefined ? { metadata } : {}),
    ...(evidence_pointer !== undefined ? { evidence_pointer } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(proof_date !== undefined ? { proof_date } : {}),
    ...(issue_certificate !== undefined ? { issue_certificate } : {}),
  });
}

function parseIngestResultV1(body: unknown): IngestResult {
  if (!isRecord(body)) {
    throw new IngestValidationError("evidence_invalid", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    body,
    ["object_key", "object_kind", "fingerprint", "bundle_digest", "merkle_root", "bundle", "idempotency_key"],
    "IngestResultV1"
  );

  const object_key = parseObjectKey(body.object_key);
  const object_kind = parseKind(body.object_kind, "object_kind");
  const fingerprint = asOptionalHex512(body.fingerprint, "fingerprint");
  const bundle_digest = asOptionalHex512(body.bundle_digest, "bundle_digest");
  const merkle_root = asOptionalHex512(body.merkle_root, "merkle_root");
  const idempotency_key = asOptionalHex512(body.idempotency_key, "idempotency_key");
  const bundle = parseIngestBundleV1(body.bundle);

  if (!fingerprint || !bundle_digest || !merkle_root || !idempotency_key) {
    throw new IngestValidationError("evidence_invalid", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    object_key,
    object_kind,
    fingerprint,
    bundle_digest,
    merkle_root,
    bundle,
    idempotency_key,
  }) as IngestResult;
}

export type IngestSubmitRequestV1 = Readonly<{
  mode: "register_and_anchor";
  identity: IngestIdentity;
  evidence: IngestResult;
  metadata?: Readonly<Record<string, unknown>>;
  evidence_pointer: string;
  domain: string;
  proof_date: string;
}>;

export function parseIngestSubmitRequestV1(body: unknown): IngestSubmitRequestV1 {
  if (!isRecord(body)) {
    throw new IngestValidationError("request_invalid_body", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    body,
    ["mode", "identity", "evidence", "metadata", "evidence_pointer", "domain", "proof_date", "issue_certificate"],
    "IngestSubmitRequestV1"
  );

  const mode = parseMode(body.mode);
  if (mode !== "register_and_anchor") {
    throw new IngestValidationError("submit_mode_invalid", { code: "SCHEMA_INVALID" });
  }

  const identity = parseIdentity(body.identity);
  const evidence = parseIngestResultV1(body.evidence);
  const metadata =
    body.metadata === undefined ? undefined : (sanitizeJsonValue(body.metadata) as Record<string, unknown>);
  const evidence_pointer = asOptionalString(body.evidence_pointer, "evidence_pointer", MAX_POINTER_LEN);
  const domain = asOptionalString(body.domain, "domain", MAX_DOMAIN_LEN);
  const proof_date = asOptionalString(body.proof_date, "proof_date", 10);
  const issue_certificate =
    body.issue_certificate === undefined
      ? undefined
      : asBooleanLike(body.issue_certificate, "issue_certificate");

  if (!evidence_pointer) {
    throw new IngestValidationError("evidence_pointer_required", { code: "SCHEMA_INVALID" });
  }
  if (!domain) {
    throw new IngestValidationError("domain_required", { code: "SCHEMA_INVALID" });
  }
  if (!proof_date || !RE_YMD.test(proof_date)) {
    throw new IngestValidationError("proof_date_required", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    mode,
    identity,
    evidence,
    evidence_pointer,
    domain,
    proof_date,
    ...(metadata !== undefined ? { metadata } : {}),
    ...(issue_certificate !== undefined ? { issue_certificate } : {}),
  });
}

function parseIngestItem(x: unknown): IngestItem {
  if (!isRecord(x)) {
    throw new IngestValidationError("item_invalid", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    x,
    ["item_kind", "path_rel", "path_hash", "media_type", "bytes", "sha3_512", "leaf_hash"],
    "IngestBundleV1.item"
  );

  const item_kind = parseKind(x.item_kind, "item_kind");
  const path_rel_raw = asOptionalString(x.path_rel, "path_rel", 1024);
  const path_hash = asOptionalHex512(x.path_hash, "path_hash");
  const media_type = asOptionalString(x.media_type, "media_type", MAX_MEDIA_TYPE_LEN);
  const bytes = asOptionalNonNegativeInt(x.bytes, "bytes");
  const sha3_512 = asOptionalHex512(x.sha3_512, "sha3_512");
  const leaf_hash = asOptionalHex512(x.leaf_hash, "leaf_hash");

  if (item_kind === "file_set") {
    throw new IngestValidationError("item_kind_invalid", { code: "SCHEMA_INVALID" });
  }

  const path_rel = path_rel_raw !== undefined ? normalizeRelPath(path_rel_raw) : undefined;

  if (bytes === undefined || !sha3_512 || !leaf_hash) {
    throw new IngestValidationError("item_invalid", { code: "SCHEMA_INVALID" });
  }

  const hasPathRel = Boolean(path_rel);
  const hasPathHash = Boolean(path_hash);
  const normalized_item_kind = item_kind as IngestItem["item_kind"];

  if (item_kind === "file") {
    if (hasPathRel === hasPathHash) {
      throw new IngestValidationError("item_path_variant_invalid", { code: "SCHEMA_INVALID" });
    }
  } else {
    if (hasPathRel || hasPathHash) {
      throw new IngestValidationError("item_path_variant_invalid", { code: "SCHEMA_INVALID" });
    }
  }

  return Object.freeze({
    item_kind: normalized_item_kind,
    ...(path_rel ? { path_rel } : {}),
    ...(path_hash ? { path_hash } : {}),
    ...(media_type ? { media_type } : {}),
    bytes,
    sha3_512,
    leaf_hash,
  }) as IngestItem;
}

function parseBundleRules(x: unknown): IngestBundleV1["rules"] {
  if (!isRecord(x)) {
    throw new IngestValidationError("bundle_rules_invalid", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    x,
    [
      "path_normalization",
      "follow_symlinks",
      "redact_paths",
      "normalize_line_endings",
      "ordering",
      "merkle_rule",
      "include_globs",
      "exclude_globs",
      "allowed_suffixes",
    ],
    "IngestBundleV1.rules"
  );

  if (x.path_normalization !== "posix_rel_no_dotdot") {
    throw new IngestValidationError("bundle_rules_path_normalization_invalid", { code: "SCHEMA_INVALID" });
  }
  if (x.ordering !== "deterministic_sort_v1") {
    throw new IngestValidationError("bundle_rules_ordering_invalid", { code: "SCHEMA_INVALID" });
  }
  if (x.merkle_rule !== "dup_last_on_odd") {
    throw new IngestValidationError("bundle_rules_merkle_rule_invalid", { code: "SCHEMA_INVALID" });
  }

  const include_globs = parseStringArray(x.include_globs, "rules.include_globs", MAX_GLOB_LEN);
  const exclude_globs = parseStringArray(x.exclude_globs, "rules.exclude_globs", MAX_GLOB_LEN);
  const allowed_suffixes = parseStringArray(
    x.allowed_suffixes,
    "rules.allowed_suffixes",
    MAX_SUFFIX_LEN,
    (v) => v.toLowerCase()
  );

  return Object.freeze({
    path_normalization: "posix_rel_no_dotdot",
    follow_symlinks: asBooleanLike(x.follow_symlinks, "rules.follow_symlinks"),
    redact_paths: asBooleanLike(x.redact_paths, "rules.redact_paths"),
    normalize_line_endings: asBooleanLike(x.normalize_line_endings, "rules.normalize_line_endings"),
    ordering: "deterministic_sort_v1",
    merkle_rule: "dup_last_on_odd",
    ...(include_globs !== undefined ? { include_globs } : {}),
    ...(exclude_globs !== undefined ? { exclude_globs } : {}),
    ...(allowed_suffixes !== undefined ? { allowed_suffixes } : {}),
  });
}

export function parseIngestBundleV1(body: unknown): IngestBundleV1 {
  if (!isRecord(body)) {
    throw new IngestValidationError("bundle_invalid_body", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    body,
    ["bundle_version", "hash_contract", "identity", "rules", "items", "merkle", "summary"],
    "IngestBundleV1"
  );

  const bundle_version = asString(body.bundle_version, "bundle_version");
  if (bundle_version !== "v1") {
    throw new IngestValidationError("bundle_version_invalid", { code: "SCHEMA_INVALID" });
  }

  if (!isRecord(body.hash_contract)) {
    throw new IngestValidationError("hash_contract_invalid", { code: "SCHEMA_INVALID" });
  }
  const hc = body.hash_contract as Record<string, unknown>;
  assertNoUnknownKeys(hc, ["contract_id", "frame", "canonical_json", "algorithm", "encoding"], "IngestBundleV1.hash_contract");

  for (const [k, v] of Object.entries(HF_HASH_CONTRACT_INFO)) {
    if (String(hc[k] ?? "") !== String(v)) {
      throw new IngestValidationError(`hash_contract_${k}_mismatch`, { code: "SCHEMA_INVALID" });
    }
  }

  const identity = parseIdentity(body.identity);

  if (!isRecord(body.rules)) {
    throw new IngestValidationError("bundle_rules_invalid", { code: "SCHEMA_INVALID" });
  }

  if (!Array.isArray(body.items)) {
    throw new IngestValidationError("bundle_items_invalid", { code: "SCHEMA_INVALID" });
  }

  if (body.items.length === 0) {
    throw new IngestValidationError("bundle_items_empty", { code: "SCHEMA_INVALID" });
  }

  const items = Object.freeze(body.items.map((it) => parseIngestItem(it)));

  const rules = parseBundleRules(body.rules);

  const merkle =
    body.merkle === undefined
      ? undefined
      : (() => {
          if (!isRecord(body.merkle)) {
            throw new IngestValidationError("bundle_merkle_invalid", { code: "SCHEMA_INVALID" });
          }
          assertNoUnknownKeys(body.merkle, ["leaf_count", "root"], "IngestBundleV1.merkle");
          const leaf_count = asOptionalNonNegativeInt((body.merkle as any).leaf_count, "leaf_count");
          const root = asOptionalHex512((body.merkle as any).root, "root");
          if (leaf_count === undefined || !root) {
            throw new IngestValidationError("bundle_merkle_invalid", { code: "SCHEMA_INVALID" });
          }
          return Object.freeze({ leaf_count, root });
        })();

  if (!isRecord(body.summary)) {
    throw new IngestValidationError("bundle_summary_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(body.summary, ["item_count", "total_bytes"], "IngestBundleV1.summary");
  const item_count = asOptionalNonNegativeInt((body.summary as any).item_count, "item_count");
  const total_bytes = asOptionalNonNegativeInt((body.summary as any).total_bytes, "total_bytes");
  if (item_count === undefined || total_bytes === undefined) {
    throw new IngestValidationError("bundle_summary_invalid", { code: "SCHEMA_INVALID" });
  }

  let computedTotalBytes = 0;
  for (const item of items) {
    computedTotalBytes += item.bytes;
  }

  if (item_count !== items.length) {
    throw new IngestValidationError("bundle_summary_item_count_mismatch", { code: "SCHEMA_INVALID" });
  }

  if (total_bytes !== computedTotalBytes) {
    throw new IngestValidationError("bundle_summary_total_bytes_mismatch", { code: "SCHEMA_INVALID" });
  }

  if (merkle && merkle.leaf_count !== items.length) {
    throw new IngestValidationError("bundle_merkle_leaf_count_mismatch", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    bundle_version: "v1",
    hash_contract: HF_HASH_CONTRACT_INFO,
    identity,
    rules,
    items,
    ...(merkle ? { merkle } : {}),
    summary: Object.freeze({ item_count, total_bytes }),
  }) as IngestBundleV1;
}

function parseReceiptRules(x: unknown): IngestBundleV1["rules"] {
  if (!isRecord(x)) {
    throw new IngestValidationError("receipt_rules_invalid", { code: "SCHEMA_INVALID" });
  }
  return parseBundleRules(x);
}

function parseReceiptMetadata(x: unknown): Readonly<Record<string, unknown>> | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    throw new IngestValidationError("receipt_metadata_invalid", { code: "SCHEMA_INVALID" });
  }
  return sanitizeJsonValue(x) as Readonly<Record<string, unknown>>;
}

function parseReceiptPointers(x: unknown): Readonly<{ evidence_pointer?: string | null }> | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    throw new IngestValidationError("receipt_pointers_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["evidence_pointer"], "IngestReceiptV1.pointers");
  const evidence_pointer = asOptionalString(x.evidence_pointer, "pointers.evidence_pointer", MAX_POINTER_LEN);
  return Object.freeze({
    ...(evidence_pointer !== undefined ? { evidence_pointer } : {}),
  });
}

function parseReceiptAnchor(x: unknown): Readonly<{ domain?: string | null; proof_date?: string | null }> | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    throw new IngestValidationError("receipt_anchor_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(x, ["domain", "proof_date"], "IngestReceiptV1.anchor");
  const domain = asOptionalString(x.domain, "anchor.domain", MAX_DOMAIN_LEN);
  const proof_date = asOptionalString(x.proof_date, "anchor.proof_date", 10);
  if (proof_date !== undefined && !RE_YMD.test(proof_date)) {
    throw new IngestValidationError("receipt_anchor_proof_date_invalid", { code: "SCHEMA_INVALID" });
  }
  return Object.freeze({
    ...(domain !== undefined ? { domain } : {}),
    ...(proof_date !== undefined ? { proof_date } : {}),
  });
}

function parseReceiptCore(
  x: unknown
): Readonly<{
  receipt_anchor?: Readonly<Record<string, unknown>>;
  root_anchor?: Readonly<Record<string, unknown>>;
}> | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    throw new IngestValidationError("receipt_core_invalid", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(x, ["receipt_anchor", "root_anchor"], "IngestReceiptV1.core");

  const receipt_anchor =
    x.receipt_anchor === undefined
      ? undefined
      : (() => {
          if (!isRecord(x.receipt_anchor)) {
            throw new IngestValidationError("receipt_core_receipt_anchor_invalid", { code: "SCHEMA_INVALID" });
          }
          return sanitizeJsonValue(x.receipt_anchor) as Readonly<Record<string, unknown>>;
        })();

  const root_anchor =
    x.root_anchor === undefined
      ? undefined
      : (() => {
          if (!isRecord(x.root_anchor)) {
            throw new IngestValidationError("receipt_core_root_anchor_invalid", { code: "SCHEMA_INVALID" });
          }
          return sanitizeJsonValue(x.root_anchor) as Readonly<Record<string, unknown>>;
        })();

  return Object.freeze({
    ...(receipt_anchor !== undefined ? { receipt_anchor } : {}),
    ...(root_anchor !== undefined ? { root_anchor } : {}),
  });
}

export function parseIngestReceiptV1(body: unknown): IngestReceiptV1 {
  if (!isRecord(body)) {
    throw new IngestValidationError("receipt_invalid_body", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(
    body,
   ["v", "kind", "receipt_id", "mode", "identity", "rules", "evidence", "anchor", "pointers", "metadata", "core"],
    "IngestReceiptV1"
  );

  const v = asString(body.v, "v");
  if (v !== "v1") {
    throw new IngestValidationError("receipt_version_invalid", { code: "SCHEMA_INVALID" });  }

  const kind = asString(body.kind, "kind");
  if (kind !== "ingest_receipt") {
    throw new IngestValidationError("receipt_kind_invalid", { code: "SCHEMA_INVALID" });
  }

  const receipt_id = asString(body.receipt_id, "receipt_id").trim().toLowerCase();
  if (!RE_HEX512.test(receipt_id)) {
    throw new IngestValidationError("receipt_id_invalid", { code: "SCHEMA_INVALID" });
  }

  const mode = parseMode(body.mode);
  const identity = parseIdentity(body.identity);
  const rules = parseReceiptRules(body.rules);

  if (!isRecord(body.evidence)) {
    throw new IngestValidationError("receipt_evidence_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(
    body.evidence,
    ["fingerprint", "bundle_digest", "merkle_root", "idempotency_key", "item_count", "total_bytes"],
    "IngestReceiptV1.evidence"
  );

  const fingerprint = asOptionalHex512((body.evidence as any).fingerprint, "evidence.fingerprint");
  const bundle_digest = asOptionalHex512((body.evidence as any).bundle_digest, "evidence.bundle_digest");
  const merkle_root = asOptionalHex512((body.evidence as any).merkle_root, "evidence.merkle_root");
  const idempotency_key = asOptionalHex512((body.evidence as any).idempotency_key, "evidence.idempotency_key");
  const item_count = asOptionalNonNegativeInt((body.evidence as any).item_count, "evidence.item_count");
  const total_bytes = asOptionalNonNegativeInt((body.evidence as any).total_bytes, "evidence.total_bytes");

  if (!fingerprint || !bundle_digest || !idempotency_key || item_count === undefined || total_bytes === undefined) {
    throw new IngestValidationError("receipt_evidence_invalid", { code: "SCHEMA_INVALID" });
  }

  const anchor = parseReceiptAnchor(body.anchor);
  const pointers = parseReceiptPointers(body.pointers);
  const metadata = parseReceiptMetadata(body.metadata);
  const core = parseReceiptCore(body.core);

  if (mode === "register_and_anchor") {
    if (!anchor?.domain) {
      throw new IngestValidationError("receipt_anchor_domain_required", { code: "SCHEMA_INVALID" });
    }
    if (!anchor?.proof_date) {
      throw new IngestValidationError("receipt_anchor_proof_date_required", { code: "SCHEMA_INVALID" });
    }
  }

  return Object.freeze({
    v: "v1",
    kind: "ingest_receipt",
    receipt_id,
    mode,
    identity,
    rules,
    evidence: Object.freeze({
      fingerprint,
      bundle_digest,
      ...(merkle_root !== undefined ? { merkle_root } : {}),
      idempotency_key,
      item_count,
      total_bytes,
    }),
    ...(anchor !== undefined ? { anchor } : {}),
    ...(pointers !== undefined && Object.keys(pointers).length > 0 ? { pointers } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(core !== undefined && Object.keys(core).length > 0 ? { core } : {}),
  }) as IngestReceiptV1;
}

export type IngestPlanRequestV1 = Readonly<{
  mode: IngestMode;
  identity: IngestIdentity;
  material: IngestMaterial;
  domain?: string | null;
  proof_date?: string | null;
}>;

export function parseIngestPlanRequestV1(body: unknown): IngestPlanRequestV1 {
  const parsed = parseIngestExecuteRequestV1(body);
  return Object.freeze({
    mode: parsed.mode,
    identity: parsed.identity,
    material: parsed.material,
    ...(parsed.domain !== undefined ? { domain: parsed.domain } : {}),
    ...(parsed.proof_date !== undefined ? { proof_date: parsed.proof_date } : {}),
  });
}

export type IngestVerifyRequestV1 = Readonly<{
  receipt?: IngestReceiptV1;
  bundle?: IngestBundleV1;
  root_dir?: string;
}>;

export function parseIngestVerifyRequestV1(body: unknown): IngestVerifyRequestV1 {
  if (!isRecord(body)) {
    throw new IngestValidationError("verify_request_invalid_body", { code: "SCHEMA_INVALID" });
  }

  assertNoUnknownKeys(body, ["receipt", "bundle", "root_dir"], "IngestVerifyRequestV1");

  const receipt =
    body.receipt === undefined ? undefined : parseIngestReceiptV1(body.receipt);
  const bundle =
    body.bundle === undefined ? undefined : parseIngestBundleV1(body.bundle);

  const root_dir_raw =
    body.root_dir === undefined ? undefined : asString(body.root_dir, "root_dir").trim();
  const root_dir = root_dir_raw && root_dir_raw.length > 0 ? root_dir_raw : undefined;

  if (!receipt && !bundle) {
    throw new IngestValidationError("verify_request_receipt_or_bundle_required", {
      code: "SCHEMA_INVALID",
    });
  }

  if (root_dir !== undefined) {
    const identity = receipt?.identity ?? bundle?.identity;
    if (!identity) {
      throw new IngestValidationError("verify_request_identity_missing", {
        code: "SCHEMA_INVALID",
      });
    }
    if (identity.object_kind !== "file_set") {
      throw new IngestValidationError("verify_request_root_dir_requires_file_set", {
        code: "SCHEMA_INVALID",
      });
    }
  }

  return Object.freeze({
    ...(receipt ? { receipt } : {}),
    ...(bundle ? { bundle } : {}),
    ...(root_dir !== undefined ? { root_dir } : {}),
  });
}