import { ingest } from "../dist/index.js";

const TEST_MODE = process.env.TEST_MODE || "merkle_only";
const TEST_OBJECT_KIND = process.env.TEST_OBJECT_KIND || "file_set";
const TEST_OBJECT_KEY = process.env.TEST_OBJECT_KEY || "hf_local_test_ingest_001";
const TEST_PROGRAM = process.env.TEST_PROGRAM || "program";
const TEST_VERSION_LABEL = process.env.TEST_VERSION_LABEL || "v1";

const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";
const TEST_FILE_PATH = process.env.TEST_FILE_PATH || "";
const TEST_TEXT = process.env.TEST_TEXT || "hello world";
const TEST_JSON = process.env.TEST_JSON || "";

const TEST_EVIDENCE_POINTER = process.env.TEST_EVIDENCE_POINTER || "";
const TEST_HEDERA_NETWORK = process.env.TEST_HEDERA_NETWORK || "";

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseOptionalHederaNetwork(value) {
  const network = String(value || "").trim().toLowerCase();
  if (!network) return undefined;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("TEST_HEDERA_NETWORK must be testnet, mainnet, or empty");
  }
  return network;
}

function buildMaterial() {
  switch (TEST_OBJECT_KIND) {
    case "file_set":
      if (!TEST_ROOT_DIR) throw new Error("Missing TEST_ROOT_DIR for file_set");
      return {
        kind: "file_set",
        root_dir: TEST_ROOT_DIR,
        rules: {
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
        },
      };

    case "file":
      if (!TEST_FILE_PATH) throw new Error("Missing TEST_FILE_PATH for file");
      return {
        kind: "file",
        path: TEST_FILE_PATH,
      };

    case "text":
      return {
        kind: "text",
        text: TEST_TEXT,
        media_type: "text/plain",
      };

    case "json":
      return {
        kind: "json",
        value: TEST_JSON ? JSON.parse(TEST_JSON) : { hello: "world", at: todayUtcDate() },
      };

    default:
      throw new Error(`Unsupported TEST_OBJECT_KIND: ${TEST_OBJECT_KIND}`);
  }
}

function defaultEvidencePointer(material) {
  const explicit = String(TEST_EVIDENCE_POINTER || "").trim();
  if (explicit) return explicit;

  if (material.kind === "file_set") return `file://${material.root_dir}`;
  if (material.kind === "file") return `file://${material.path}`;
  return "";
}

async function main() {
  const material = buildMaterial();
  const evidencePointer = defaultEvidencePointer(material);
  const hederaNetwork = parseOptionalHederaNetwork(TEST_HEDERA_NETWORK);
  if ((material.kind === "text" || material.kind === "json") && !evidencePointer) {
    throw new Error(
      `Missing TEST_EVIDENCE_POINTER for ${material.kind}. ` +
      "Set an explicit evidence pointer such as inline://hello-world."
    );
  }

  console.log("\n[1] Running local-only ingest execution...\n");

  const result = await ingest.executeIngestLocalOnly({
    request: {
      mode: TEST_MODE,
      identity: {
        object_key: TEST_OBJECT_KEY,
        object_kind: TEST_OBJECT_KIND,
        program: TEST_PROGRAM,
        version_label: TEST_VERSION_LABEL,
      },
      material,
      ...(evidencePointer ? { evidence_pointer: evidencePointer } : {}),
      metadata: {
        source: "hf-local-package",
        test_source: "ingest-local-only-example",
        proof_date: todayUtcDate(),
      },
    },
    hooks: {
      onScanProgress: (p) => {
        if (p?.event === "dir") {
          console.log("[scan:dir]", p.rel ?? ".", p.files_seen ?? 0, p.total_bytes_seen ?? 0);
        }
        if (p?.event === "skip") {
          console.log("[scan:skip]", p.rel ?? "", p.reason ?? "");
        }
      },
      onHashProgress: (p) => {
        if (p?.event === "item") {
          console.log("[hash:item]", p.index, "/", p.total, p.item_kind, p.path_rel ?? "", p.bytes);
        }
      },
    },
  });

  const evidence = result.local.evidence;
  const receipt = result.local.receipt;

  if (receipt.hedera_network != null) {
    throw new Error("Local ingest receipt unexpectedly contains hedera_network");
  }

  const metadataForPage = {
    source: "hf-local-package",
    proof_date: todayUtcDate(),
    object_kind: TEST_OBJECT_KIND,
  };

  const pageReady = {
    objectKey: TEST_OBJECT_KEY,
    objectKind: TEST_OBJECT_KIND,
    program: TEST_PROGRAM,
    versionLabel: TEST_VERSION_LABEL,
    ...(hederaNetwork ? { hederaNetwork } : {}),
    evidencePointer: evidencePointer || null,
    metadataText: JSON.stringify(metadataForPage, null, 2),
    evidenceText: JSON.stringify(evidence, null, 2),
  };

  console.log("[local summary]");
  console.log(
    JSON.stringify(
      {
        object_key: evidence.object_key,
        object_kind: evidence.object_kind,
        planned_submit_hedera_network: hederaNetwork ?? null,
        local_receipt_hedera_network: receipt.hedera_network ?? null,
        fingerprint: evidence.fingerprint,
        bundle_digest: evidence.bundle_digest,
        merkle_root: evidence.merkle_root,
        idempotency_key: evidence.idempotency_key,
        item_count: evidence.bundle.summary.item_count,
        total_bytes: evidence.bundle.summary.total_bytes,
        receipt_id: receipt.receipt_id,
        evidence_pointer: evidencePointer || null,
      },
      null,
      2
    )
  );

  console.log("\n[2] Full local receipt\n");
  console.log(JSON.stringify(receipt, null, 2));

  console.log("\n[3] Full local evidence\n");
  console.log(JSON.stringify(evidence, null, 2));

  console.log("\n[4] HF ingest submit page ready values\n");
  console.log(JSON.stringify(pageReady, null, 2));

  console.log("\n[5] Copy/paste guide for ingest UI / submit flow\n");
  console.log("objectKey:");
  console.log(pageReady.objectKey);
  console.log("\nobjectKind:");
  console.log(pageReady.objectKind);
  console.log("\nprogram:");
  console.log(pageReady.program);
  console.log("\nversionLabel:");
  console.log(pageReady.versionLabel);
  console.log("\nhederaNetwork (optional future submit target; not part of local evidence):");
  console.log(pageReady.hederaNetwork ?? "");
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