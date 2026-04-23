// src/datasets/workflow.ts
// Version: 1.0-hf-datasets-workflow-v1 | 2026-03-05
// Purpose:
//   Orchestrate scan -> hash -> merkle -> bundle -> fingerprints.
// Notes:
//   - Default mode is hash_only.
//   - No Core/network calls here yet (keeps it testable).
//   - UI can call planAnchor() then executeAnchor().

import type { AnchorInput, AnchorPlan, AnchorResult } from "./types.js";
import { DatasetError } from "./errors.js";
import { scanDataset } from "./scan.js";
import { hashFiles } from "./fileHash.js";
import { merkleRoot } from "./merkle.js";
import { buildBundleV1, bundleDigest, datasetFingerprint, idempotencyKey } from "./bundle.js";
import { hashJsonDigest } from "../hashing/contract.js";
import type { AnchorExecuteRequestV1, AnchorPlanRequestV1 } from "./validators.js";
import { parseAnchorExecuteRequestV1, parseAnchorPlanRequestV1 } from "./validators.js";

export function planAnchor(input: AnchorPlanRequestV1): AnchorPlan {
  const parsed = parseAnchorPlanRequestV1(input);
  const datasetKey = String(parsed?.identity?.dataset_key ?? "").trim();
  if (!datasetKey) throw new DatasetError("dataset_key_required", { code: "INPUT_INVALID" });

  // plan_id should not depend on machine-specific absolute paths
  const plan_id = hashJsonDigest({
    domain: "va:dataset:plan:v1",
    value: {
      dataset_key: datasetKey,
      version_label: parsed.identity.version_label ?? null,
      program: parsed.identity.program ?? null,
      rules: parsed.rules ?? null,
      mode: parsed.mode,
      issue_certificate:
        typeof parsed.issue_certificate === "boolean"
          ? parsed.issue_certificate
          : null,
    },
    alg: "sha3-512",
    encoding: "hex_lower",
  });

  const steps =
    parsed.mode === "register_and_anchor"
      ? (["scan", "hash", "bundle", "core_upsert", "core_version", "core_publish"] as const)
      : (["scan", "hash", "bundle"] as const);

  return Object.freeze({
    dataset_key: datasetKey,
    plan_id,
    steps: Object.freeze(steps.slice()),
  });
}

export async function executeAnchor(
  input: AnchorInput,
  hooks?: {
    onScanProgress?: Parameters<typeof scanDataset>[2];
    onHashProgress?: Parameters<typeof hashFiles>[2];
  }
): Promise<AnchorResult> {
  const parsed = parseAnchorExecuteRequestV1(input as AnchorExecuteRequestV1);

  const datasetKey = String(parsed?.identity?.dataset_key ?? "").trim();
  if (!datasetKey) throw new DatasetError("dataset_key_required", { code: "INPUT_INVALID" });

  const rootDir = String(parsed?.root_dir ?? "").trim();
  if (!rootDir) throw new DatasetError("root_dir_required", { code: "INPUT_INVALID" });

  const files = await scanDataset(rootDir, parsed.rules, hooks?.onScanProgress);
  const hashed = await hashFiles(files, parsed.rules, hooks?.onHashProgress);
  const merkle = merkleRoot(hashed);

  const bundle = buildBundleV1({
    identity: parsed.identity,
    ...(parsed.rules ? { rules: parsed.rules } : {}),
    files: hashed,
    merkle,
  });

  const bd = bundleDigest(bundle);
  const fp = datasetFingerprint(bundle);
  const idem = idempotencyKey(datasetKey, fp);

  return Object.freeze({
    dataset_key: datasetKey,
    dataset_fingerprint: fp,
    bundle_digest: bd,
    merkle_root: merkle.root,
    bundle,
    idempotency_key: idem,
  });
}