// ============================================================================
// File: src/ingest/execute.ts
// Version: 1.0-hf-ingest-execute-v1 | 2026-03-06
// Purpose:
//   Orchestrate normalize -> scan -> hash -> merkle -> bundle for generic ingest.
// Notes:
//   - Pure local-first workflow.
//   - No Core/network/auth coupling here.
//   - Routes/services can forward user auth separately at integration boundaries.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { hashJson, hashUtf8 } from "../hashing/hashFactory.js";
import type {
  FileMaterial,
  FileSetMaterial,
  IngestInput,
  IngestItem,
  IngestMaterial,
  IngestPlan,
  IngestResult,
  JsonMaterial,
  ScannedFile,
  TextMaterial,
} from "./types.js";
import { IngestError } from "./errors.js";
import { normalizeJsonValue } from "./jsonNorm.js";
import { normalizeRelPath } from "./pathNorm.js";
import { scanIngestFiles, type ScanProgress } from "./scan.js";
import { normalizeText } from "./textNorm.js";
import { buildPathHash, hashScannedFile } from "./fileHash.js";
import { buildIngestBundleV1, ingestBundleDigest, ingestFingerprint, ingestIdempotencyKey } from "./bundle.js";
import { merkleRootFromItems } from "./merkle.js";
import { parseIngestExecuteRequestV1, type IngestExecuteRequestV1 } from "./validators.js";
import { hashJsonDigest } from "../hashing/contract.js";

export type ExecuteHooks = Readonly<{
  onScanProgress?: (p: ScanProgress) => void;
  onHashProgress?: (p: {
    event: "item";
    index: number;
    total: number;
    item_kind: IngestItem["item_kind"];
    path_rel?: string;
    bytes: number;
  }) => void;
}>;

function fileNameOnly(p: string): string {
  const base = path.basename(String(p ?? "").trim());
  return normalizeRelPath(base);
}

function buildLeafHash(input: {
  item_kind: IngestItem["item_kind"];
  path_rel?: string;
  path_hash?: string;
  media_type?: string | null;
  bytes: number;
  sha3_512: string;
}): string {
  return hashJson({
    domain: "va:ingest:leaf:v1",
    value: {
      item_kind: input.item_kind,
      ...(input.path_rel ? { path_rel: input.path_rel } : {}),
      ...(input.path_hash ? { path_hash: input.path_hash } : {}),
      ...(input.media_type ? { media_type: input.media_type } : {}),
      bytes: input.bytes,
      sha3_512: input.sha3_512,
    },
    alg: "sha3-512",
    encoding: "hex_lower",
  }).digest;
}

function itemPathFields(pathRel: string, redactPaths: boolean): { path_rel?: string; path_hash?: string } {
  const normalized = normalizeRelPath(pathRel);
  if (redactPaths) {
    return { path_hash: buildPathHash(normalized) };
  }
  return { path_rel: normalized };
}

function sortItemsDeterministically(items: ReadonlyArray<IngestItem>): ReadonlyArray<IngestItem> {
  const out = items.slice().sort((a, b) => {
    const ak = a.path_rel ?? a.path_hash ?? "";
    const bk = b.path_rel ?? b.path_hash ?? "";
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    if (a.item_kind < b.item_kind) return -1;
    if (a.item_kind > b.item_kind) return 1;
    if (a.sha3_512 < b.sha3_512) return -1;
    if (a.sha3_512 > b.sha3_512) return 1;
    return 0;
  });
  return Object.freeze(out);
}

async function executeJson(material: JsonMaterial): Promise<ReadonlyArray<IngestItem>> {
  const normalized = normalizeJsonValue(material.value);
  const media_type = "application/json";
  const sha3_512 = hashJson({
    domain: "va:ingest:json:v1",
    value: JSON.parse(normalized.canonical_text),
    alg: "sha3-512",
    encoding: "hex_lower",
  }).digest;

  const itemBase = {
    item_kind: "json" as const,
    media_type,
    bytes: normalized.bytes,
    sha3_512,
  };

  const leaf_hash = buildLeafHash(itemBase);

  return Object.freeze([
    Object.freeze({
      ...itemBase,
      leaf_hash,
    }),
  ]);
}

async function executeText(material: TextMaterial): Promise<ReadonlyArray<IngestItem>> {
  const normalized = normalizeText({
    text: material.text,
    normalize_line_endings: false,
  });

  const media_type = material.media_type ?? null;
  const sha3_512 = hashUtf8({
    domain: "va:ingest:text:v1",
    text: normalized.text,
    alg: "sha3-512",
    encoding: "hex_lower",
  }).digest;

  const itemBase = {
    item_kind: "text" as const,
    ...(media_type ? { media_type } : {}),
    bytes: normalized.bytes,
    sha3_512,
  };

  const leaf_hash = buildLeafHash({
    item_kind: "text",
    media_type,
    bytes: normalized.bytes,
    sha3_512,
  });

  return Object.freeze([
    Object.freeze({
      ...itemBase,
      leaf_hash,
    }),
  ]);
}

async function executeSingleFile(
  material: FileMaterial,
  hooks?: ExecuteHooks
): Promise<ReadonlyArray<IngestItem>> {
  const absPath = path.resolve(String(material.path ?? "").trim());
  if (!absPath) {
    throw new IngestError("material.path_invalid", {
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  }

  const scanned: ScannedFile = Object.freeze({
    path_rel: fileNameOnly(absPath),
    abs_path: absPath,
    bytes: -1,
  });

  let actualBytes = 0;
  try {
    const st = await fs.promises.lstat(absPath);
    if (st.isSymbolicLink()) {
      throw new IngestError("material.path_symlink_forbidden", {
        code: "INPUT_INVALID",
        statusCode: 400,
      });
    }
    if (!st.isFile()) {
      throw new IngestError("material.path_not_file", {
        code: "INPUT_INVALID",
        statusCode: 400,
      });
    }
    actualBytes = Number(st.size);
  } catch (cause) {
    if (cause instanceof IngestError) throw cause;
    throw new IngestError("material.path_stat_failed", {
      code: "FILE_READ_FAILED",
      statusCode: 500,
      cause,
    });
  }

  const file = Object.freeze({
    ...scanned,
    bytes: actualBytes,
  });
  
  const normalizeLineEndings = false;
  const hashed = await hashScannedFile(file, {
    normalize_line_endings: normalizeLineEndings,
  });

  const pathFields = itemPathFields(hashed.path_rel, false);
  const itemBase = {
    item_kind: "file" as const,
    ...pathFields,
    ...(hashed.media_type ? { media_type: hashed.media_type } : {}),
    bytes: hashed.bytes,
    sha3_512: hashed.sha3_512,
  };

  const leaf_hash = buildLeafHash({
    item_kind: "file",
    ...(pathFields.path_rel ? { path_rel: pathFields.path_rel } : {}),
    ...(pathFields.path_hash ? { path_hash: pathFields.path_hash } : {}),
    media_type: hashed.media_type,
    bytes: hashed.bytes,
    sha3_512: hashed.sha3_512,
  });

  hooks?.onHashProgress?.({
    event: "item",
    index: 1,
    total: 1,
    item_kind: "file",
    ...(pathFields.path_rel ? { path_rel: pathFields.path_rel } : {}),
    bytes: hashed.bytes,
  });

  return Object.freeze([
    Object.freeze({
      ...itemBase,
      leaf_hash,
    }),
  ]);
}

async function executeFileSet(
  material: FileSetMaterial,
  hooks?: ExecuteHooks
): Promise<ReadonlyArray<IngestItem>> {
  const scanned = await scanIngestFiles(material.root_dir, material.rules, hooks?.onScanProgress);
  const redactPaths = Boolean(material.rules?.redact_paths);
  const normalizeLineEndings = Boolean(material.rules?.normalize_line_endings);

  const out: IngestItem[] = [];
  for (let i = 0; i < scanned.length; i += 1) {
    const file = scanned[i] as ScannedFile;
    const hashed = await hashScannedFile(file, {
      normalize_line_endings: normalizeLineEndings,
    });

    const pathFields = itemPathFields(hashed.path_rel, redactPaths);

    const leaf_hash = buildLeafHash({
      item_kind: "file",
      ...(pathFields.path_rel ? { path_rel: pathFields.path_rel } : {}),
      ...(pathFields.path_hash ? { path_hash: pathFields.path_hash } : {}),
      media_type: hashed.media_type,
      bytes: hashed.bytes,
      sha3_512: hashed.sha3_512,
    });

    out.push(
      Object.freeze({
        item_kind: "file",
        ...pathFields,
        ...(hashed.media_type ? { media_type: hashed.media_type } : {}),
        bytes: hashed.bytes,
        sha3_512: hashed.sha3_512,
        leaf_hash,
      })
    );

    hooks?.onHashProgress?.({
      event: "item",
      index: i + 1,
      total: scanned.length,
      item_kind: "file",
      ...(pathFields.path_rel ? { path_rel: pathFields.path_rel } : {}),
      bytes: hashed.bytes,
    });
  }

  return sortItemsDeterministically(out);
}

async function executeMaterial(
  material: IngestMaterial,
  hooks?: ExecuteHooks
): Promise<ReadonlyArray<IngestItem>> {
  switch (material.kind) {
    case "json":
      return executeJson(material);
    case "text":
      return executeText(material);
    case "file":
      return executeSingleFile(material, hooks);
    case "file_set":
      return executeFileSet(material, hooks);
    default: {
      const _exhaustive: never = material;
      throw new IngestError(`material_kind_unsupported: ${String(_exhaustive)}`, {
        code: "INPUT_INVALID",
        statusCode: 400,
      });
    }
  }
}

export function planIngest(input: IngestExecuteRequestV1): IngestPlan {
  const parsed = parseIngestExecuteRequestV1(input);
  const object_key = String(parsed.identity.object_key).trim();
  if (!object_key) {
    throw new IngestError("object_key_required", {
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  }

  const rules =
    parsed.material.kind === "file_set"
      ? parsed.material.rules ?? null
      : null;

  const plan_id = hashJsonDigest({
    domain: "va:ingest:plan:v1",
    value: {
      object_key,
      object_kind: parsed.identity.object_kind,
      version_label: parsed.identity.version_label ?? null,
      program: parsed.identity.program ?? null,
      mode: parsed.mode,
      material_kind: parsed.material.kind,
      rules,
      domain: parsed.domain ?? null,
      proof_date: parsed.proof_date ?? null,
    },
    alg: "sha3-512",
    encoding: "hex_lower",
  });

  const steps =
    parsed.material.kind === "file_set"
      ? parsed.mode === "register_and_anchor"
        ? (["scan", "hash", "merkle", "bundle", "anchor_payload"] as const)
        : (["scan", "hash", "merkle", "bundle"] as const)
      : parsed.mode === "register_and_anchor"
        ? (["normalize", "hash", "merkle", "bundle", "anchor_payload"] as const)
        : (["normalize", "hash", "merkle", "bundle"] as const);

  return Object.freeze({
    object_key,
    plan_id,
    steps: Object.freeze(steps.slice()),
  });
}

export async function executeIngest(
  input: IngestInput,
  hooks?: ExecuteHooks
): Promise<IngestResult> {
  const parsed = parseIngestExecuteRequestV1(input);
  const object_key = String(parsed.identity.object_key).trim();
  if (!object_key) {
    throw new IngestError("object_key_required", {
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  }

  const items = await executeMaterial(parsed.material, hooks);
  if (!items.length) {
    throw new IngestError("items_empty", {
      code: "EXECUTE_EMPTY",
      statusCode: 400,
    });
  }

  const orderedItems = sortItemsDeterministically(items);

  const merkle = merkleRootFromItems(orderedItems);

  const rules = parsed.material.kind === "file_set" ? parsed.material.rules : undefined;

  const bundle = buildIngestBundleV1({
    identity: parsed.identity,
    ...(rules ? { rules } : {}),
    items: orderedItems,
    ...(merkle ? { merkle } : {}),
  });

  const bundle_digest = ingestBundleDigest(bundle);
  const fingerprint = ingestFingerprint(bundle);
  const idempotency_key = ingestIdempotencyKey(object_key, fingerprint);

  return Object.freeze({
    object_key,
    object_kind: parsed.identity.object_kind,
    fingerprint,
    bundle_digest,
    merkle_root: merkle.root,
    bundle,
    idempotency_key,
  });
}