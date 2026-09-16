// ============================================================================
// File: src/datasets/validators.ts
// Version: 1.2-receipt-runtime-hardening | 2026-09-08
// Purpose:
//   Runtime validation for untrusted dataset-anchor JSON at HF boundaries.
//   - parseAnchorPlanRequestV1(body)
//   - parseAnchorExecuteRequestV1(body)
//   - parseDatasetBundleV1(body)
//   - parseDatasetReceiptV1(body)
//   - parseDatasetVerifyRequestV1(body)
// Notes:
//   - Strict: rejects unknown keys.
//   - Keeps route/orchestrator code lean and fail-closed.
//   - Sanitizes metadata to plain JSON-safe structures.
// ============================================================================

import type {
  DatasetBundleV1,
  DatasetIdentity,
  DatasetRules,
  HashedFile,
  HederaNetwork,
} from "./types.js";
import { HF_HASH_CONTRACT_INFO } from "../hashing/contract.js";

const RE_DATASET_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const RE_DATASET_KEY_CANONICAL = /^[a-z0-9][a-z0-9_.:-]{0,255}$/;
const RE_PROGRAM = /^[a-z][a-z0-9_:-]{1,63}$/;
const RE_HEX512 = /^[0-9a-f]{128}$/;
const VALID_MODES = new Set(["hash_only", "register_and_anchor"]);
const VALID_HEDERA_NETWORKS = new Set(["testnet", "mainnet"]);

const MAX_DATASET_KEY_LEN = 256;
const MAX_VERSION_LABEL_LEN = 64;
const MAX_ROOT_DIR_LEN = 4096;
const MAX_POINTER_LEN = 2048;
const MAX_DISPLAY_NAME_LEN = 256;
const MAX_GLOB_LEN = 256;
const MAX_SUFFIX_LEN = 64;
const MAX_ARRAY_ITEMS = 256;
const MAX_META_DEPTH = 8;
const MAX_RECEIPT_ID_LEN = 128;

export class DatasetValidationError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, opts?: { code?: string; statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = "DatasetValidationError";
    this.code = opts?.code ?? "DATASET_VALIDATION_FAILED";
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
      throw new DatasetValidationError(`${where}_unknown_key: ${k}`, { code: "SCHEMA_UNKNOWN_KEY" });
    }
  }
}

function asString(x: unknown, where: string): string {
  if (typeof x !== "string") {
    throw new DatasetValidationError(`${where}_invalid_string`, { code: "SCHEMA_INVALID" });
  }
  return x;
}

function asBooleanLike(x: unknown, where: string): boolean {
  if (typeof x === "boolean") return x;
  if (typeof x === "string") {
    const s = x.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  throw new DatasetValidationError(`${where}_invalid_boolean`, { code: "SCHEMA_INVALID" });
}

function expectLiteral<T extends string>(x: unknown, where: string, expected: T): T {
  const s = asString(x, where).trim();
  if (s !== expected) {
    throw new DatasetValidationError(`${where}_invalid`, { code: "SCHEMA_INVALID" });
  }
  return expected;
}

function asOptionalString(x: unknown, where: string, maxLen: number): string | undefined {
  if (x === undefined) return undefined;
  const s = asString(x, where).trim();
  if (!s) return undefined;
  if (s.length > maxLen) throw new DatasetValidationError(`${where}_too_long`, { code: "SCHEMA_INVALID" });
  return s;
}

function asOptionalHex512(x: unknown, where: string): string | undefined {
  if (x === undefined) return undefined;
  const s = asString(x, where).trim().toLowerCase();
  if (!RE_HEX512.test(s)) {
    throw new DatasetValidationError(`${where}_invalid_hex512`, { code: "SCHEMA_INVALID" });
  }
  return s;
}

function asOptionalNonNegativeInt(x: unknown, where: string): number | undefined {
  if (x === undefined || x === null) return undefined;
  const n = Number(x);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DatasetValidationError(`${where}_invalid_int`, { code: "SCHEMA_INVALID" });
  }
  return n;
}

function parseAnchorMode(
  x: unknown,
  where = "mode",
  def: "hash_only" | "register_and_anchor" = "hash_only"
): "hash_only" | "register_and_anchor" {
  if (x === undefined) return def;
  const s = asString(x, where).trim();
  if (!VALID_MODES.has(s)) {
    throw new DatasetValidationError(`${where}_invalid`, { code: "SCHEMA_INVALID" });
  }
  return s as "hash_only" | "register_and_anchor";
}

function parseHederaNetwork(
  x: unknown,
  where = "hedera_network"
): HederaNetwork | undefined {
  if (x === undefined || x === null || x === "") return undefined;
  const network = asString(x, where).trim().toLowerCase();
  if (!VALID_HEDERA_NETWORKS.has(network)) {
    throw new DatasetValidationError(`${where}_invalid`, {
      code: "UNSUPPORTED_HEDERA_NETWORK",
    });
  }
  return network as HederaNetwork;
}

function parsePublishVisibility(
  x: unknown,
  where = "publish_visibility"
): "public" | "unlisted" | undefined {
  if (x === undefined || x === null || x === "") return undefined;
  const s = asString(x, where).trim().toLowerCase();
  if (s !== "public" && s !== "unlisted") {
    throw new DatasetValidationError(`${where}_invalid`, { code: "SCHEMA_INVALID" });
  }
  return s as "public" | "unlisted";
}

function parseDatasetKey(x: unknown): string {
  const s = asString(x, "dataset_key").trim();
  if (!s || s.length > MAX_DATASET_KEY_LEN || !RE_DATASET_KEY.test(s)) {
    throw new DatasetValidationError("dataset_key_invalid", { code: "SCHEMA_INVALID" });
  }
  return s;
}

function normalizeRequestDatasetKey(x: unknown): string {
  return asString(x, "dataset_key")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.:-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/g, "")
    .replace(/[^a-z0-9]+$/g, "")
    .slice(0, MAX_DATASET_KEY_LEN);
}

function parseRequestDatasetKey(x: unknown): string {
  const s = normalizeRequestDatasetKey(x);
  if (!s || s.length > MAX_DATASET_KEY_LEN || !RE_DATASET_KEY_CANONICAL.test(s)) {
    throw new DatasetValidationError("dataset_key_invalid", { code: "SCHEMA_INVALID" });
  }
  return s;
}

function parseProgram(x: unknown): string | undefined {
  if (x === undefined || x === null) return undefined;
  const s = asString(x, "program").trim();
  if (!s) return undefined;
  if (!RE_PROGRAM.test(s)) {
    throw new DatasetValidationError("program_invalid", { code: "SCHEMA_INVALID" });
  }
  return s;
}

function parseStringArray(
  x: unknown,
  where: string,
  maxLen: number,
  normalize?: (v: string) => string
): readonly string[] | undefined {
  if (x === undefined) return undefined;
  if (!Array.isArray(x)) {
    throw new DatasetValidationError(`${where}_invalid_array`, { code: "SCHEMA_INVALID" });
  }
  if (x.length > MAX_ARRAY_ITEMS) {
    throw new DatasetValidationError(`${where}_too_many_items`, { code: "SCHEMA_INVALID" });
  }
  const out: string[] = [];
  for (const item of x) {
    const raw = asString(item, where).trim();
    if (!raw) continue;
    const v = normalize ? normalize(raw) : raw;
    if (!v || v.length > maxLen) {
      throw new DatasetValidationError(`${where}_item_invalid`, { code: "SCHEMA_INVALID" });
    }
    out.push(v);
  }
  return Object.freeze(out.slice());
}

function sanitizeJsonValue(x: unknown, depth = 0): unknown {
  if (depth > MAX_META_DEPTH) {
    throw new DatasetValidationError("metadata_too_deep", { code: "SCHEMA_INVALID" });
  }
  if (
    x === null ||
    typeof x === "string" ||
    typeof x === "number" ||
    typeof x === "boolean"
  ) {
    return x;
  }
  if (Array.isArray(x)) {
    if (x.length > MAX_ARRAY_ITEMS) {
      throw new DatasetValidationError("metadata_array_too_large", { code: "SCHEMA_INVALID" });
    }
    return Object.freeze(x.map((v) => sanitizeJsonValue(v, depth + 1)));
  }
  if (!isRecord(x)) {
    throw new DatasetValidationError("metadata_invalid", { code: "SCHEMA_INVALID" });
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new DatasetValidationError("metadata_invalid_key", { code: "SCHEMA_INVALID" });
    }
    out[k] = sanitizeJsonValue(v, depth + 1);
  }
  return Object.freeze(out);
}

function parseIdentity(
  x: unknown,
  opts: Readonly<{ normalizeDatasetKey?: boolean }> = {}
): DatasetIdentity {
  if (!isRecord(x)) throw new DatasetValidationError("identity_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(x, ["dataset_key", "version_label", "program"], "identity");

  const dataset_key = opts.normalizeDatasetKey
    ? parseRequestDatasetKey(x.dataset_key)
    : parseDatasetKey(x.dataset_key);
  const version_label = asOptionalString(x.version_label, "version_label", MAX_VERSION_LABEL_LEN);
  const program = parseProgram(x.program);

  const out: DatasetIdentity = Object.freeze({
    dataset_key,
    ...(version_label !== undefined ? { version_label } : {}),
    ...(program !== undefined ? { program } : {}),
  });

  return out;
}

function parseRules(x: unknown): DatasetRules | undefined {
  if (x === undefined || x === null) return undefined;
  if (!isRecord(x)) throw new DatasetValidationError("rules_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(
    x,
    ["redact_paths", "follow_symlinks", "include_globs", "exclude_globs", "allowed_suffixes", "max_files", "max_total_bytes", "max_single_file_bytes"],
    "rules"
  );

  const redact_paths =
    x.redact_paths === undefined ? undefined : asBooleanLike(x.redact_paths, "rules.redact_paths");
  const follow_symlinks =
    x.follow_symlinks === undefined ? undefined : asBooleanLike(x.follow_symlinks, "rules.follow_symlinks");

  const max_files = asOptionalNonNegativeInt(x.max_files, "rules.max_files");
  const max_total_bytes = asOptionalNonNegativeInt(x.max_total_bytes, "rules.max_total_bytes");
  const max_single_file_bytes = asOptionalNonNegativeInt(x.max_single_file_bytes, "rules.max_single_file_bytes");

  const include_globs = parseStringArray(x.include_globs, "rules.include_globs", MAX_GLOB_LEN);
  const exclude_globs = parseStringArray(x.exclude_globs, "rules.exclude_globs", MAX_GLOB_LEN);
  const allowed_suffixes = parseStringArray(
    x.allowed_suffixes,
    "rules.allowed_suffixes",
    MAX_SUFFIX_LEN,
    (v) => v.toLowerCase()
  );

  const out: DatasetRules = Object.freeze({
    ...(redact_paths !== undefined ? { redact_paths } : {}),
    ...(follow_symlinks !== undefined ? { follow_symlinks } : {}),
    ...(include_globs !== undefined ? { include_globs } : {}),
    ...(exclude_globs !== undefined ? { exclude_globs } : {}),
    ...(allowed_suffixes !== undefined ? { allowed_suffixes } : {}),
    ...(max_files !== undefined ? { max_files } : {}),
    ...(max_total_bytes !== undefined ? { max_total_bytes } : {}),
    ...(max_single_file_bytes !== undefined ? { max_single_file_bytes } : {}),
  });

  return out;
}

function parseAnchorResultV1(body: unknown) {
  if (!isRecord(body)) throw new DatasetValidationError("evidence_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(
    body,
    ["dataset_key", "dataset_fingerprint", "bundle_digest", "merkle_root", "bundle", "idempotency_key"],
    "AnchorResultV1"
  );

  const dataset_key = parseDatasetKey(body.dataset_key);
  const dataset_fingerprint = asOptionalHex512(body.dataset_fingerprint, "dataset_fingerprint");
  const bundle_digest = asOptionalHex512(body.bundle_digest, "bundle_digest");
  const merkle_root = asOptionalHex512(body.merkle_root, "merkle_root");
  const idempotency_key = asOptionalHex512(body.idempotency_key, "idempotency_key");
  const bundle = parseDatasetBundleV1(body.bundle);

  if (!dataset_fingerprint || !bundle_digest || !merkle_root || !idempotency_key) {
    throw new DatasetValidationError("evidence_invalid", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    dataset_key,
    dataset_fingerprint,
    bundle_digest,
    merkle_root,
    bundle,
    idempotency_key,
  });
}

export type AnchorPlanRequestV1 = Readonly<{
  mode: "hash_only" | "register_and_anchor";
  identity: DatasetIdentity;
  hedera_network?: HederaNetwork;
  rules?: DatasetRules;
  issue_certificate?: boolean;
}>;

export type AnchorExecuteRequestV1 = Readonly<{
  mode: "hash_only" | "register_and_anchor";
  identity: DatasetIdentity;
  hedera_network?: HederaNetwork;
  root_dir: string;
  rules?: DatasetRules;
  display_name?: string;
  metadata?: Readonly<Record<string, unknown>>;
  evidence_pointer?: string;
  publish_visibility?: "public" | "unlisted";
  set_active?: boolean;
  issue_certificate?: boolean;
}>;

export type AnchorSubmitRequestV1 = Readonly<{
  mode: "register_and_anchor";
  identity: DatasetIdentity;
  hedera_network?: HederaNetwork;
  evidence: Readonly<{
    dataset_key: string;
    dataset_fingerprint: string;
    bundle_digest: string;
    merkle_root: string;
    bundle: DatasetBundleV1;
    idempotency_key: string;
  }>;
  display_name?: string;
  metadata?: Readonly<Record<string, unknown>>;
  evidence_pointer: string;
  publish_visibility?: "public" | "unlisted";
  set_active?: boolean;
  issue_certificate?: boolean;
}>;

export function parseAnchorPlanRequestV1(body: unknown): AnchorPlanRequestV1 {
  if (!isRecord(body)) throw new DatasetValidationError("request_invalid_body", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(
    body,
    ["mode", "identity", "hedera_network", "rules", "issue_certificate"],
    "AnchorPlanRequestV1"
  );

  const mode = parseAnchorMode(body.mode);
  const identity = parseIdentity(body.identity, { normalizeDatasetKey: true });
  const hedera_network = parseHederaNetwork(body.hedera_network);
  const rules = parseRules(body.rules);
  const issue_certificate =
    body.issue_certificate === undefined
      ? undefined
      : asBooleanLike(body.issue_certificate, "issue_certificate");

  return Object.freeze({
    mode,
    identity,
    ...(hedera_network ? { hedera_network } : {}),
    ...(rules ? { rules } : {}),
    ...(issue_certificate !== undefined ? { issue_certificate } : {}),
  });
}

export function parseAnchorExecuteRequestV1(body: unknown): AnchorExecuteRequestV1 {
  if (!isRecord(body)) throw new DatasetValidationError("request_invalid_body", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(
    body,
    ["mode", "identity", "hedera_network", "root_dir", "rules", "display_name", "metadata", "evidence_pointer", "publish_visibility", "set_active", "issue_certificate"],
    "AnchorExecuteRequestV1"
  );

  const mode = parseAnchorMode(body.mode);
  const identity = parseIdentity(body.identity, { normalizeDatasetKey: true });
  const hedera_network = parseHederaNetwork(body.hedera_network);

  const root_dir = asString(body.root_dir, "root_dir").trim();
  if (!root_dir || root_dir.length > MAX_ROOT_DIR_LEN) {
    throw new DatasetValidationError("root_dir_invalid", { code: "SCHEMA_INVALID" });
  }

  const rules = parseRules(body.rules);
  const display_name = asOptionalString(body.display_name, "display_name", MAX_DISPLAY_NAME_LEN);
  const evidence_pointer = asOptionalString(body.evidence_pointer, "evidence_pointer", MAX_POINTER_LEN);
  const publish_visibility_raw = asOptionalString(body.publish_visibility, "publish_visibility", 32);
  const set_active =
    body.set_active === undefined ? undefined : asBooleanLike(body.set_active, "set_active");
  const issue_certificate =
    body.issue_certificate === undefined
      ? undefined
      : asBooleanLike(body.issue_certificate, "issue_certificate");
  const metadata =
    body.metadata === undefined ? undefined : (sanitizeJsonValue(body.metadata) as Record<string, unknown>);

  let publish_visibility: "public" | "unlisted" | undefined;
  if (publish_visibility_raw !== undefined) {
    const v = publish_visibility_raw.trim().toLowerCase();
    if (v !== "public" && v !== "unlisted") {
      throw new DatasetValidationError("publish_visibility_invalid", { code: "SCHEMA_INVALID" });
    }
    publish_visibility = v;
  }

  if (mode === "register_and_anchor" && !evidence_pointer) {
    throw new DatasetValidationError("evidence_pointer_required", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    mode,
    identity,
    ...(hedera_network ? { hedera_network } : {}),
    root_dir,
    ...(rules ? { rules } : {}),
    ...(display_name !== undefined ? { display_name } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(evidence_pointer !== undefined ? { evidence_pointer } : {}),
    ...(publish_visibility !== undefined ? { publish_visibility } : {}),
    ...(set_active !== undefined ? { set_active } : {}),
    ...(issue_certificate !== undefined ? { issue_certificate } : {}),
  });
}

export function parseAnchorSubmitRequestV1(body: unknown): AnchorSubmitRequestV1 {
  if (!isRecord(body)) throw new DatasetValidationError("request_invalid_body", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(
    body,
    ["mode", "identity", "hedera_network", "evidence", "display_name", "metadata", "evidence_pointer", "publish_visibility", "set_active", "issue_certificate"],
    "AnchorSubmitRequestV1"
  );

  const mode = parseAnchorMode(body.mode);
  if (mode !== "register_and_anchor") {
    throw new DatasetValidationError("submit_mode_invalid", { code: "SCHEMA_INVALID" });
  }

  const identity = parseIdentity(body.identity, { normalizeDatasetKey: true });
  const hedera_network = parseHederaNetwork(body.hedera_network);
  const evidence = parseAnchorResultV1(body.evidence);
  const display_name = asOptionalString(body.display_name, "display_name", MAX_DISPLAY_NAME_LEN);
  const evidence_pointer = asOptionalString(body.evidence_pointer, "evidence_pointer", MAX_POINTER_LEN);
  const set_active =
    body.set_active === undefined ? undefined : asBooleanLike(body.set_active, "set_active");
  const issue_certificate =
    body.issue_certificate === undefined
      ? undefined
      : asBooleanLike(body.issue_certificate, "issue_certificate");
  const metadata =
    body.metadata === undefined ? undefined : (sanitizeJsonValue(body.metadata) as Record<string, unknown>);

  let publish_visibility: "public" | "unlisted" | undefined;
  const publish_visibility_raw = asOptionalString(body.publish_visibility, "publish_visibility", 32);
  if (publish_visibility_raw !== undefined) {
    const v = publish_visibility_raw.trim().toLowerCase();
    if (v !== "public" && v !== "unlisted") {
      throw new DatasetValidationError("publish_visibility_invalid", { code: "SCHEMA_INVALID" });
    }
    publish_visibility = v;
  }

  if (!evidence_pointer) {
    throw new DatasetValidationError("evidence_pointer_required", { code: "SCHEMA_INVALID" });
  }

  if (identity.dataset_key !== evidence.dataset_key) {
    throw new DatasetValidationError("identity_evidence_dataset_key_mismatch", {
      code: "SCHEMA_INVALID",
    });
  }

  return Object.freeze({
    mode,
    identity,
    ...(hedera_network ? { hedera_network } : {}),
    evidence,
    evidence_pointer,
    ...(display_name !== undefined ? { display_name } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(publish_visibility !== undefined ? { publish_visibility } : {}),
    ...(set_active !== undefined ? { set_active } : {}),
    ...(issue_certificate !== undefined ? { issue_certificate } : {}),
  });
}

function parseHashedFile(x: unknown): HashedFile {
  if (!isRecord(x)) throw new DatasetValidationError("file_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(x, ["path_rel", "path_hash", "bytes", "sha3_512", "leaf_hash"], "DatasetBundleV1.file");

  const path_rel = asOptionalString(x.path_rel, "path_rel", MAX_ROOT_DIR_LEN);
  const path_hash = asOptionalHex512(x.path_hash, "path_hash");
  const sha3_512 = asOptionalHex512(x.sha3_512, "sha3_512");
  const leaf_hash = asOptionalHex512(x.leaf_hash, "leaf_hash");
  const bytes = asOptionalNonNegativeInt(x.bytes, "bytes");

  const hasPathRel = Boolean(path_rel);
  const hasPathHash = Boolean(path_hash);
  if (hasPathRel === hasPathHash) {
    throw new DatasetValidationError("file_path_variant_invalid", { code: "SCHEMA_INVALID" });
  }
  if (!sha3_512 || !leaf_hash || bytes === undefined) {
    throw new DatasetValidationError("file_invalid", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    ...(path_rel ? { path_rel } : {}),
    ...(path_hash ? { path_hash } : {}),
    bytes,
    sha3_512,
    leaf_hash,
  }) as HashedFile;
}

export function parseDatasetBundleV1(body: unknown): DatasetBundleV1 {
  if (!isRecord(body)) throw new DatasetValidationError("bundle_invalid_body", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(body, ["bundle_version", "hash_contract", "dataset_identity", "rules", "files", "merkle", "summary"], "DatasetBundleV1");

  const bundle_version = asString(body.bundle_version, "bundle_version");
  if (bundle_version !== "v1") {
    throw new DatasetValidationError("bundle_version_invalid", { code: "SCHEMA_INVALID" });
  }

  if (!isRecord(body.hash_contract)) {
    throw new DatasetValidationError("hash_contract_invalid", { code: "SCHEMA_INVALID" });
  }
  const hc = body.hash_contract as Record<string, unknown>;
  assertNoUnknownKeys(hc, ["contract_id", "frame", "canonical_json", "algorithm", "encoding"], "DatasetBundleV1.hash_contract");
  for (const [k, v] of Object.entries(HF_HASH_CONTRACT_INFO)) {
    if (String(hc[k] ?? "") !== String(v)) {
      throw new DatasetValidationError(`hash_contract_${k}_mismatch`, { code: "SCHEMA_INVALID" });
    }
  }

  const dataset_identity = parseIdentity(body.dataset_identity);
  if (!isRecord(body.rules)) {
    throw new DatasetValidationError("bundle_rules_invalid", { code: "SCHEMA_INVALID" });
  }
  assertNoUnknownKeys(
    body.rules,
    [
      "path_normalization",
      "follow_symlinks",
      "redact_paths",
      "ordering",
      "merkle_rule",
      "include_globs",
      "exclude_globs",
      "allowed_suffixes",
    ],
    "DatasetBundleV1.rules"
  );

  const include_globs = parseStringArray((body.rules as any).include_globs, "rules.include_globs", MAX_GLOB_LEN);
  const exclude_globs = parseStringArray((body.rules as any).exclude_globs, "rules.exclude_globs", MAX_GLOB_LEN);
  const allowed_suffixes = parseStringArray(
    (body.rules as any).allowed_suffixes,
    "rules.allowed_suffixes",
    MAX_SUFFIX_LEN,
    (v) => v.toLowerCase()
  );

  const rules: DatasetBundleV1["rules"] = Object.freeze({
    path_normalization: expectLiteral((body.rules as any).path_normalization, "path_normalization", "posix_rel_no_dotdot"),
    follow_symlinks: asBooleanLike((body.rules as any).follow_symlinks, "follow_symlinks"),
    redact_paths: asBooleanLike((body.rules as any).redact_paths, "redact_paths"),
    ordering: expectLiteral((body.rules as any).ordering, "ordering", "path_rel_ascii_asc"),
    merkle_rule: expectLiteral((body.rules as any).merkle_rule, "merkle_rule", "dup_last_on_odd"),
    ...(include_globs ? { include_globs } : {}),
    ...(exclude_globs ? { exclude_globs } : {}),
    ...(allowed_suffixes ? { allowed_suffixes } : {}),
  });


  if (!Array.isArray(body.files)) {
    throw new DatasetValidationError("bundle_files_invalid", { code: "SCHEMA_INVALID" });
  }
  const files = Object.freeze(body.files.map((f) => parseHashedFile(f)));

  if (!isRecord(body.merkle)) throw new DatasetValidationError("bundle_merkle_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(body.merkle, ["leaf_count", "root"], "DatasetBundleV1.merkle");
  const leaf_count = asOptionalNonNegativeInt((body.merkle as any).leaf_count, "leaf_count");
  const root = asOptionalHex512((body.merkle as any).root, "root");
  if (leaf_count === undefined || !root) {
    throw new DatasetValidationError("bundle_merkle_invalid", { code: "SCHEMA_INVALID" });
  }

  if (!isRecord(body.summary)) throw new DatasetValidationError("bundle_summary_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(body.summary, ["file_count", "total_bytes"], "DatasetBundleV1.summary");
  const file_count = asOptionalNonNegativeInt((body.summary as any).file_count, "file_count");
  const total_bytes = asOptionalNonNegativeInt((body.summary as any).total_bytes, "total_bytes");
  if (file_count === undefined || total_bytes === undefined) {
    throw new DatasetValidationError("bundle_summary_invalid", { code: "SCHEMA_INVALID" });
  }

  const out: DatasetBundleV1 = Object.freeze({
    bundle_version: "v1",
    hash_contract: HF_HASH_CONTRACT_INFO,
    dataset_identity,
    rules,
    files,
    merkle: Object.freeze({ leaf_count, root }),
    summary: Object.freeze({ file_count, total_bytes }),
  });

  return out;
}

export type DatasetReceiptV1 = Readonly<{
  v: "v1";
  kind: "dataset_anchor_receipt";
  receipt_id: string;
  mode: "hash_only" | "register_and_anchor";
  hedera_network?: HederaNetwork;
  dataset_identity: DatasetIdentity;
  rules: Readonly<Record<string, unknown>>;
  evidence: Readonly<{
    dataset_fingerprint: string;
    bundle_digest: string;
    merkle_root: string;
    idempotency_key: string;
    file_count: number;
    total_bytes: number;
  }>;
  pointers?: Readonly<{
    evidence_pointer?: string;
  }>;
  core?: Readonly<Record<string, unknown>>;
}>;

export function parseDatasetReceiptV1(body: unknown): DatasetReceiptV1 {
  if (!isRecord(body)) throw new DatasetValidationError("receipt_invalid_body", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(
    body,
    ["v", "kind", "receipt_id", "mode", "hedera_network", "dataset_identity", "rules", "evidence", "pointers", "core"],
    "DatasetReceiptV1"
  );

  const v = asString(body.v, "v");
  if (v !== "v1") throw new DatasetValidationError("receipt_version_invalid", { code: "SCHEMA_INVALID" });

  const kind = asString(body.kind, "kind");
  if (kind !== "dataset_anchor_receipt") {
    throw new DatasetValidationError("receipt_kind_invalid", { code: "SCHEMA_INVALID" });
  }

  const receipt_id = asString(body.receipt_id, "receipt_id").trim().toLowerCase();
  if (!receipt_id || receipt_id.length > MAX_RECEIPT_ID_LEN || !RE_HEX512.test(receipt_id)) {
    throw new DatasetValidationError("receipt_id_invalid", { code: "SCHEMA_INVALID" });
  }

  const modeRaw = asString(body.mode, "mode").trim();
  const mode = parseAnchorMode(modeRaw, "mode");
  const hedera_network = parseHederaNetwork(body.hedera_network);
  if (mode === "hash_only" && hedera_network) {
    throw new DatasetValidationError("hash_only_hedera_network_invalid", {
      code: "SCHEMA_INVALID",
    });
  }

  const dataset_identity = parseIdentity(body.dataset_identity);

  if (!isRecord(body.rules)) throw new DatasetValidationError("receipt_rules_invalid", { code: "SCHEMA_INVALID" });
  const rules = sanitizeJsonValue(body.rules) as Record<string, unknown>;

  if (!isRecord(body.evidence)) throw new DatasetValidationError("receipt_evidence_invalid", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(body.evidence, ["dataset_fingerprint", "bundle_digest", "merkle_root", "idempotency_key", "file_count", "total_bytes"], "DatasetReceiptV1.evidence");
  const dataset_fingerprint = asOptionalHex512((body.evidence as any).dataset_fingerprint, "dataset_fingerprint");
  const bundle_digest = asOptionalHex512((body.evidence as any).bundle_digest, "bundle_digest");
  const merkle_root = asOptionalHex512((body.evidence as any).merkle_root, "merkle_root");
  const idempotency_key = asOptionalHex512((body.evidence as any).idempotency_key, "idempotency_key");
  const file_count = asOptionalNonNegativeInt((body.evidence as any).file_count, "file_count");
  const total_bytes = asOptionalNonNegativeInt((body.evidence as any).total_bytes, "total_bytes");

  if (
    !dataset_fingerprint ||
    !bundle_digest ||
    !merkle_root ||
    !idempotency_key ||
    file_count === undefined ||
    total_bytes === undefined
  ) {
    throw new DatasetValidationError("receipt_evidence_invalid", { code: "SCHEMA_INVALID" });
  }

  const evidence = Object.freeze({
    dataset_fingerprint,
    bundle_digest,
    merkle_root,
    idempotency_key,
    file_count,
    total_bytes,
  });

  let pointers: { evidence_pointer?: string } | undefined;
  if (body.pointers !== undefined) {
    if (!isRecord(body.pointers)) throw new DatasetValidationError("receipt_pointers_invalid", { code: "SCHEMA_INVALID" });
    assertNoUnknownKeys(body.pointers, ["evidence_pointer"], "DatasetReceiptV1.pointers");
    const evidence_pointer = asOptionalString((body.pointers as any).evidence_pointer, "evidence_pointer", MAX_POINTER_LEN);
    pointers = Object.freeze({
      ...(evidence_pointer !== undefined ? { evidence_pointer } : {}),
    });
  }

  const core =
    body.core === undefined ? undefined : (sanitizeJsonValue(body.core) as Record<string, unknown>);

  if (hedera_network && core) {
    const candidates = [
      (core as any)?.dataset?.hedera_network,
      (core as any)?.version?.hedera_network,
      (core as any)?.published?.hedera_network,
    ].filter((value) => value != null && String(value).trim() !== "");

    for (const candidate of candidates) {
      const coreNetwork = parseHederaNetwork(candidate, "core.hedera_network");
      if (coreNetwork && coreNetwork !== hedera_network) {
        throw new DatasetValidationError("receipt_hedera_network_mismatch", {
          code: "DATASET_NETWORK_IDENTITY_MISMATCH",
        });
      }
    }
  }

  return Object.freeze({
    v: "v1",
    kind: "dataset_anchor_receipt",
    receipt_id,
    mode,
    ...(hedera_network ? { hedera_network } : {}),
    dataset_identity,
    rules,
    evidence,
    ...(pointers ? { pointers } : {}),
    ...(core ? { core: Object.freeze(core) } : {}),
  });
}

export function parseDatasetVerifyRequestV1(body: unknown): Readonly<{
  receipt?: DatasetReceiptV1;
  bundle?: DatasetBundleV1;
  root_dir?: string;
}> {
  if (!isRecord(body)) throw new DatasetValidationError("verify_invalid_body", { code: "SCHEMA_INVALID" });
  assertNoUnknownKeys(body, ["receipt", "bundle", "root_dir"], "DatasetVerifyRequestV1");

  const receipt = body.receipt === undefined ? undefined : parseDatasetReceiptV1(body.receipt);
  const bundle = body.bundle === undefined ? undefined : parseDatasetBundleV1(body.bundle);
  const root_dir = body.root_dir === undefined ? undefined : asString(body.root_dir, "root_dir").trim();

  if (!receipt && !bundle) {
    throw new DatasetValidationError("verify_requires_receipt_or_bundle", { code: "SCHEMA_INVALID" });
  }
  if (root_dir !== undefined && (!root_dir || root_dir.length > MAX_ROOT_DIR_LEN)) {
    throw new DatasetValidationError("root_dir_invalid", { code: "SCHEMA_INVALID" });
  }

  return Object.freeze({
    ...(receipt ? { receipt } : {}),
    ...(bundle ? { bundle } : {}),
    ...(root_dir ? { root_dir } : {}),
  });
}
