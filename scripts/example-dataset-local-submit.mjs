import fs from "node:fs/promises";
import path from "node:path";
import {
  executeDatasetAnchorLocalThenSubmit,
} from "../dist/index.js";

const HF_BASE_URL = process.env.HF_BASE_URL || "https://hfapi.veraanchor.com";
const HF_API_KEY = process.env.HF_API_KEY || "";

const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";
const TEST_DATASET_KEY = process.env.TEST_DATASET_KEY || "hf_local_test_dataset_001";
const TEST_PROGRAM = process.env.TEST_PROGRAM || "program";
const TEST_VERSION_LABEL = process.env.TEST_VERSION_LABEL || "v1";
const TEST_DISPLAY_NAME =
  process.env.TEST_DISPLAY_NAME || "HF local submit dataset test";
const TEST_EVIDENCE_POINTER =
  process.env.TEST_EVIDENCE_POINTER || `file://${TEST_ROOT_DIR}`;
const TEST_ISSUE_CERTIFICATE = process.env.TEST_ISSUE_CERTIFICATE || "";

function timestampForDir() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeSegment(value, fallback) {
  const s = String(value || "").trim();
  if (!s) return fallback;
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || fallback;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function parseOptionalBooleanEnv(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return undefined;
  if (s === "true") return true;
  if (s === "false") return false;
  throw new Error("TEST_ISSUE_CERTIFICATE must be true, false, or empty");
}

async function prepareRunOutput(baseDir, label) {
  const runDir = path.join(baseDir, `${timestampForDir()}-${label}`);
  const latestDir = path.join(baseDir, "latest");
  await fs.mkdir(runDir, { recursive: true });
  await fs.rm(latestDir, { recursive: true, force: true });
  await fs.mkdir(latestDir, { recursive: true });
  return { runDir, latestDir };
}

if (!HF_API_KEY) {
  throw new Error("Missing HF_API_KEY");
}

if (!TEST_ROOT_DIR) {
  throw new Error("Missing TEST_ROOT_DIR");
}

if (!TEST_EVIDENCE_POINTER) {
  throw new Error("Missing TEST_EVIDENCE_POINTER");
}

async function main() {
  const issueCertificate = parseOptionalBooleanEnv(TEST_ISSUE_CERTIFICATE);
  const outputBaseDir = "./vera_anchor_dataset_receipts";
  const outputLabel = safeSegment(TEST_DATASET_KEY, "dataset");
  const { runDir, latestDir } = await prepareRunOutput(outputBaseDir, outputLabel);
  const runMeta = { output_dir: runDir, latest_dir: latestDir };

  console.log("\n[1] Running local -> HF dataset submit flow...\n");

  const result = await executeDatasetAnchorLocalThenSubmit(
    {
      baseUrl: HF_BASE_URL,
      auth: {
        apiKey: HF_API_KEY,
      },
    },
    {
      identity: {
        dataset_key: TEST_DATASET_KEY,
        program: TEST_PROGRAM,
        version_label: TEST_VERSION_LABEL,
      },
      root_dir: TEST_ROOT_DIR,
      display_name: TEST_DISPLAY_NAME,
      metadata: {
        source: "hf-local-package",
        dataset_key: TEST_DATASET_KEY,
        program: TEST_PROGRAM,
        version_label: TEST_VERSION_LABEL,
        test_source: "dataset-local-submit-example",
      },
      evidence_pointer: TEST_EVIDENCE_POINTER,
      publish_visibility: "unlisted",
      set_active: true,
      ...(typeof issueCertificate === "boolean"
        ? { issue_certificate: issueCertificate }
        : {}),
      hooks: {
        onScanProgress: (p) => {
          if (p?.event === "dir") {
            console.log("[scan:dir]", p.rel ?? ".", p.files_seen ?? 0, p.total_bytes_seen ?? 0);
          }
        },
        onHashProgress: (p) => {
          if (p?.event === "file_done") {
            console.log("[hash:file_done]", p.path_rel, p.bytes, p.sha3_512_prefix);
          }
        },
      },
    }
  );

  const localEvidence = result.local.evidence;
  const localReceipt = result.local.receipt;
  const remote = result.remote;

  await writeJson(path.join(runDir, "local-receipt.json"), localReceipt);
  await writeJson(path.join(runDir, "local-evidence.json"), localEvidence);
  await writeJson(path.join(runDir, "remote-receipt.json"), remote.receipt);
  await writeJson(path.join(runDir, "remote-bundle.json"), remote.evidence?.bundle ?? null);
  await writeJson(path.join(runDir, "remote-payload.json"), remote);
  await writeJson(path.join(runDir, "run-meta.json"), runMeta);

  await writeJson(path.join(latestDir, "local-receipt.json"), localReceipt);
  await writeJson(path.join(latestDir, "local-evidence.json"), localEvidence);
  await writeJson(path.join(latestDir, "remote-receipt.json"), remote.receipt);
  await writeJson(path.join(latestDir, "remote-bundle.json"), remote.evidence?.bundle ?? null);
  await writeJson(path.join(latestDir, "remote-payload.json"), remote);
  await writeJson(path.join(latestDir, "run-meta.json"), runMeta);

  console.log("[result summary]");
  console.log(
    JSON.stringify(
      {
        local_dataset_fingerprint: localEvidence.dataset_fingerprint,
        remote_dataset_fingerprint: remote.evidence?.dataset_fingerprint ?? null,
        local_bundle_digest: localEvidence.bundle_digest,
        remote_bundle_digest: remote.evidence?.bundle_digest ?? null,
        local_merkle_root: localEvidence.merkle_root,
        remote_merkle_root: remote.evidence?.merkle_root ?? null,
        local_receipt_id: localReceipt.receipt_id,
        remote_receipt_id: remote.receipt?.receipt_id ?? null,
        core_dataset_key: remote.core?.dataset?.dataset_key ?? null,
        core_version: remote.core?.version?.version ?? null,
        core_manifest_hash: remote.core?.version?.manifest_hash ?? null,
        certificate_requested: remote.core?.certificate?.requested ?? null,
        certificate_attempted: remote.core?.certificate?.attempted ?? null,
        certificate_skipped: remote.core?.certificate?.skipped ?? null,
        certificate_issued: remote.core?.certificate?.issued ?? null,
        certificate_reason: remote.core?.certificate?.reason ?? null,
        replay_reused: remote.core?.replay?.reused ?? null,
        replay_detected: remote.core?.replay?.replay ?? null,
        replay_reason: remote.core?.replay?.replay_reason ?? null,
      },
      null,
      2
    )
  );

  console.log("\n[2] Full local receipt\n");
  console.log(JSON.stringify(localReceipt, null, 2));

  console.log("\n[3] Full remote payload\n");
  console.log(JSON.stringify(remote, null, 2));

  console.log("\n[4] Wrote verify inputs\n");
  console.log("run dir:");
  console.log(runDir);
  console.log("\nlatest dir:");
  console.log(latestDir);
  console.log("\nrun local receipt:");
  console.log(path.join(runDir, "local-receipt.json"));
  console.log("\nrun local evidence:");
  console.log(path.join(runDir, "local-evidence.json"));
  console.log("\nrun remote receipt:");
  console.log(path.join(runDir, "remote-receipt.json"));
  console.log("\nrun remote bundle:");
  console.log(path.join(runDir, "remote-bundle.json"));
  console.log("\nrun remote payload:");
  console.log(path.join(runDir, "remote-payload.json"));
}

main().catch((err) => {
  console.error("\n[local-submit failed]");
  console.error(err);
  process.exit(1);
});