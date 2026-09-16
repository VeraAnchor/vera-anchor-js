import fs from "node:fs/promises";
import path from "node:path";
import { ingest } from "../dist/index.js";

const HF_BASE_URL = process.env.HF_BASE_URL || "https://hfapi.veraanchor.com";
const HF_API_KEY = process.env.HF_API_KEY || "";

const TEST_OBJECT_KIND = process.env.TEST_OBJECT_KIND || "file_set";
const TEST_OBJECT_KEY = process.env.TEST_OBJECT_KEY || "hf_local_test_ingest_001";
const TEST_PROGRAM = process.env.TEST_PROGRAM || "program";
const TEST_VERSION_LABEL = process.env.TEST_VERSION_LABEL || "v1";

const TEST_DOMAIN = process.env.TEST_DOMAIN || "";
const TEST_PROOF_DATE = process.env.TEST_PROOF_DATE || new Date().toISOString().slice(0, 10);

const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";
const TEST_FILE_PATH = process.env.TEST_FILE_PATH || "";
const TEST_TEXT = process.env.TEST_TEXT || "hello world";
const TEST_JSON = process.env.TEST_JSON || "";

const TEST_EVIDENCE_POINTER = process.env.TEST_EVIDENCE_POINTER || "";
const TEST_HEDERA_NETWORK = process.env.TEST_HEDERA_NETWORK || "";
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

function parseRequiredHederaNetwork(value) {
  const network = String(value || "").trim().toLowerCase();
  if (!network) {
    throw new Error("Missing TEST_HEDERA_NETWORK (expected testnet or mainnet)");
  }
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("TEST_HEDERA_NETWORK must be testnet or mainnet");
  }
  return network;
}

function assertEqual(label, expected, actual) {
  if (expected !== actual) {
    throw new Error(`${label} mismatch: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertRemoteNetworkIdentity(expectedNetwork, remote) {
  const required = [
    ["remote.hedera_network", remote?.hedera_network],
    ["remote.receipt.hedera_network", remote?.receipt?.hedera_network],
  ];

  for (const [label, value] of required) {
    if (value == null || String(value).trim() === "") {
      throw new Error(`${label} missing for explicit ${expectedNetwork} submit`);
    }
    assertEqual(label, expectedNetwork, String(value).trim().toLowerCase());
  }

  const optional = [
    ["remote.core.receipt_anchor", remote?.core?.receipt_anchor?.hedera_network ?? remote?.core?.receipt_anchor?.anchor?.hedera_network],
    ["remote.core.root_build", remote?.core?.root_build?.hedera_network],
    ["remote.core.root_publish", remote?.core?.root_publish?.hedera_network ?? remote?.core?.root_publish?.network],
    ["remote.core.root_anchor", remote?.core?.root_anchor?.hedera_network ?? remote?.core?.root_anchor?.anchor?.hedera_network],
  ];

  for (const [label, value] of optional) {
    if (value != null && String(value).trim() !== "") {
      assertEqual(`${label}.hedera_network`, expectedNetwork, String(value).trim().toLowerCase());
    }
  }
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

if (!TEST_DOMAIN) {
  throw new Error("Missing TEST_DOMAIN");
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
        value: TEST_JSON ? JSON.parse(TEST_JSON) : { hello: "world", proof_date: TEST_PROOF_DATE },
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

  if ((material.kind === "text" || material.kind === "json") && !evidencePointer) {
    throw new Error(
      `Missing TEST_EVIDENCE_POINTER for ${material.kind}. ` +
      "For text/json material, set an explicit evidence pointer such as inline://hello-world."
    );
  }

  const hederaNetwork = parseRequiredHederaNetwork(TEST_HEDERA_NETWORK);
  const issueCertificate = parseOptionalBooleanEnv(TEST_ISSUE_CERTIFICATE);
  const outputBaseDir = "./vera_anchor_ingest_receipts";
  const outputLabel = safeSegment(`${TEST_OBJECT_KEY}-${hederaNetwork}`, "ingest");
  const { runDir, latestDir } = await prepareRunOutput(outputBaseDir, outputLabel);
  const runMeta = {
    output_dir: runDir,
    latest_dir: latestDir,
    hedera_network: hederaNetwork,
  };

  const config = {
    baseUrl: HF_BASE_URL,
    auth: {
      apiKey: HF_API_KEY,
    },
  };

  const identity = {
    object_key: TEST_OBJECT_KEY,
    object_kind: TEST_OBJECT_KIND,
    program: TEST_PROGRAM,
    version_label: TEST_VERSION_LABEL,
  };

  console.log("\n[1] Planning network-bound ingest anchor...\n");

  const plan = await ingest.planIngestRemote(config, {
    mode: "register_and_anchor",
    identity,
    material,
    domain: TEST_DOMAIN,
    proof_date: TEST_PROOF_DATE,
    hedera_network: hederaNetwork,
    ...(typeof issueCertificate === "boolean"
      ? { issue_certificate: issueCertificate }
      : {}),
  });

  assertEqual("plan.hedera_network", hederaNetwork, plan.hedera_network ?? null);

  console.log("[plan summary]");
  console.log(
    JSON.stringify(
      {
        object_key: plan.object_key,
        hedera_network: plan.hedera_network ?? null,
        plan_id: plan.plan_id,
        steps: plan.steps,
      },
      null,
      2
    )
  );

  console.log("\n[2] Running local -> HF ingest register_and_anchor flow...\n");

  const result = await ingest.executeIngestLocalThenSubmit(
    config,
    {
      request: {
        mode: "register_and_anchor",
        identity,
        material,
        ...(evidencePointer ? { evidence_pointer: evidencePointer } : {}),
        domain: TEST_DOMAIN,
        proof_date: TEST_PROOF_DATE,
        hedera_network: hederaNetwork,
        ...(typeof issueCertificate === "boolean"
          ? { issue_certificate: issueCertificate }
          : {}),
        metadata: {
          source: "hf-local-package",
          object_key: TEST_OBJECT_KEY,
          object_kind: TEST_OBJECT_KIND,
          program: TEST_PROGRAM,
          version_label: TEST_VERSION_LABEL,
          test_source: "ingest-local-register-and-anchor-example",
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
    }
  );

  const localEvidence = result.local.evidence;
  const localReceipt = result.local.receipt;
  const remote = result.remote;

  assertEqual("fingerprint", localEvidence.fingerprint, remote.evidence?.fingerprint ?? null);
  assertEqual("bundle_digest", localEvidence.bundle_digest, remote.evidence?.bundle_digest ?? null);
  assertEqual("merkle_root", localEvidence.merkle_root, remote.evidence?.merkle_root ?? null);
  assertRemoteNetworkIdentity(hederaNetwork, remote);

  if (localReceipt.hedera_network != null) {
    throw new Error("Local pre-submit ingest receipt unexpectedly contains hedera_network");
  }

  await writeJson(path.join(runDir, "remote-plan.json"), plan);
  await writeJson(path.join(runDir, "local-receipt.json"), localReceipt);
  await writeJson(path.join(runDir, "local-evidence.json"), localEvidence);
  await writeJson(path.join(runDir, "remote-receipt.json"), remote.receipt);
  await writeJson(path.join(runDir, "remote-bundle.json"), remote.evidence?.bundle ?? null);
  await writeJson(path.join(runDir, "remote-payload.json"), remote);
  await writeJson(path.join(runDir, "run-meta.json"), runMeta);

  await writeJson(path.join(latestDir, "remote-plan.json"), plan);
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
        requested_hedera_network: hederaNetwork,
        plan_hedera_network: plan.hedera_network ?? null,
        remote_hedera_network: remote.hedera_network ?? null,
        receipt_hedera_network: remote.receipt?.hedera_network ?? null,
        receipt_anchor_hedera_network:
          remote.core?.receipt_anchor?.hedera_network ??
          remote.core?.receipt_anchor?.anchor?.hedera_network ??
          null,
        root_anchor_hedera_network:
          remote.core?.root_anchor?.hedera_network ??
          remote.core?.root_anchor?.anchor?.hedera_network ??
          null,
        local_object_key: localEvidence.object_key,
        remote_object_key: remote.evidence?.object_key ?? null,
        local_fingerprint: localEvidence.fingerprint,
        remote_fingerprint: remote.evidence?.fingerprint ?? null,
        local_bundle_digest: localEvidence.bundle_digest,
        remote_bundle_digest: remote.evidence?.bundle_digest ?? null,
        local_merkle_root: localEvidence.merkle_root,
        remote_merkle_root: remote.evidence?.merkle_root ?? null,
        local_receipt_id: localReceipt.receipt_id,
        remote_receipt_id: remote.receipt?.receipt_id ?? null,
        receipt_anchor_id: remote.core?.receipt_anchor?.anchor?.id ?? remote.core?.receipt_anchor?.id ?? null,
        root_build_id: remote.core?.root_build?.id ?? remote.core?.root_build?.root_id ?? null,
        root_publish_id: remote.core?.root_publish?.id ?? remote.core?.root_publish?.root_id ?? null,
        root_anchor_id: remote.core?.root_anchor?.anchor?.id ?? remote.core?.root_anchor?.id ?? null,
        root_anchor_txn: remote.core?.root_anchor?.anchor?.hcs_transaction_id ?? null,
        root_anchor_msg: remote.core?.root_anchor?.anchor?.hcs_message_id ?? null,
        certificate_requested: remote.core?.root_anchor?.certificate?.requested ?? null,
        certificate_attempted: remote.core?.root_anchor?.certificate?.attempted ?? null,
        certificate_skipped: remote.core?.root_anchor?.certificate?.skipped ?? null,
        certificate_issued: remote.core?.root_anchor?.certificate?.issued ?? null,
        certificate_reason: remote.core?.root_anchor?.certificate?.reason ?? null,
      },
      null,
      2
    )
  );

  console.log("\n[3] Full local receipt\n");
  console.log(JSON.stringify(localReceipt, null, 2));

  console.log("\n[4] Full remote payload\n");
  console.log(JSON.stringify(remote, null, 2));

  console.log("\n[5] Wrote verify inputs\n");
  console.log("run dir:");
  console.log(runDir);
  console.log("\nlatest dir:");
  console.log(latestDir);
  console.log("\nrun remote plan:");
  console.log(path.join(runDir, "remote-plan.json"));
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
  console.error("\n[local-register-and-anchor failed]");
  console.error(err);
  process.exit(1);
});