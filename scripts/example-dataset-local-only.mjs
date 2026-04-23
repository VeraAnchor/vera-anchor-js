import {
  executeDatasetAnchorLocalOnly,
} from "../dist/index.js";

const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";
const TEST_DATASET_KEY = process.env.TEST_DATASET_KEY || "hf_local_test_dataset_001";
const TEST_PROGRAM = process.env.TEST_PROGRAM || "program";
const TEST_VERSION_LABEL = process.env.TEST_VERSION_LABEL || "v1";
const TEST_EVIDENCE_POINTER =
  process.env.TEST_EVIDENCE_POINTER || `file://${TEST_ROOT_DIR}`;

if (!TEST_ROOT_DIR) {
  throw new Error("Missing TEST_ROOT_DIR");
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  console.log("\n[1] Running local-only dataset execution...\n");

  const result = await executeDatasetAnchorLocalOnly({
    identity: {
      dataset_key: TEST_DATASET_KEY,
      program: TEST_PROGRAM,
      version_label: TEST_VERSION_LABEL,
    },
    root_dir: TEST_ROOT_DIR,
    evidence_pointer: TEST_EVIDENCE_POINTER,
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
  });

  const evidence = result.local.evidence;
  const receipt = result.local.receipt;

  const metadataForPage = {
    source: "hf-local-package",
    proof_date: todayUtcDate(),
  };

  const pageReady = {
    datasetKey: TEST_DATASET_KEY,
    program: TEST_PROGRAM,
    versionLabel: TEST_VERSION_LABEL,
    evidencePointer: TEST_EVIDENCE_POINTER,
    metadataText: JSON.stringify(metadataForPage, null, 2),
    evidenceText: JSON.stringify(evidence, null, 2),
  };

  console.log("[local summary]");
  console.log(
    JSON.stringify(
      {
        dataset_key: evidence.dataset_key,
        dataset_fingerprint: evidence.dataset_fingerprint,
        bundle_digest: evidence.bundle_digest,
        merkle_root: evidence.merkle_root,
        idempotency_key: evidence.idempotency_key,
        file_count: evidence.bundle.summary.file_count,
        total_bytes: evidence.bundle.summary.total_bytes,
        receipt_id: receipt.receipt_id,
        evidence_pointer: TEST_EVIDENCE_POINTER,
      },
      null,
      2
    )
  );

  console.log("\n[2] Full local receipt\n");
  console.log(JSON.stringify(receipt, null, 2));

  console.log("\n[3] Full local evidence\n");
  console.log(JSON.stringify(evidence, null, 2));

  console.log("\n[4] HF dataset submit page ready values\n");
  console.log(JSON.stringify(pageReady, null, 2));

  console.log("\n[5] Copy/paste guide for /app/datasets/submit\n");
  console.log("datasetKey:");
  console.log(pageReady.datasetKey);
  console.log("\nprogram:");
  console.log(pageReady.program);
  console.log("\nversionLabel:");
  console.log(pageReady.versionLabel);
  console.log("\nevidencePointer:");
  console.log(pageReady.evidencePointer);
  console.log("\nmetadataText:");
  console.log(pageReady.metadataText);
  console.log("\nevidenceText:");
  console.log(pageReady.evidenceText);
}

main().catch((err) => {
  console.error("\n[local-only failed]");
  console.error(err);
  process.exit(1);
});