import fs from "node:fs/promises";
import { ingest } from "../dist/index.js";

const HF_BASE_URL = process.env.HF_BASE_URL || "https://hfapi.veraanchor.com";
const HF_API_KEY = process.env.HF_API_KEY || "";

const TEST_RECEIPT_PATH = process.env.TEST_RECEIPT_PATH || "";
const TEST_BUNDLE_PATH = process.env.TEST_BUNDLE_PATH || "";
const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";
const TEST_EXPECTED_HEDERA_NETWORK = process.env.TEST_EXPECTED_HEDERA_NETWORK || "";

if (!HF_API_KEY) {
  throw new Error("Missing HF_API_KEY");
}

if (!TEST_RECEIPT_PATH && !TEST_BUNDLE_PATH) {
  throw new Error("Missing TEST_RECEIPT_PATH or TEST_BUNDLE_PATH");
}

function parseOptionalHederaNetwork(value) {
  const network = String(value || "").trim().toLowerCase();
  if (!network) return undefined;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("TEST_EXPECTED_HEDERA_NETWORK must be testnet, mainnet, or empty");
  }
  return network;
}

async function readJsonMaybe(p) {
  const trimmed = String(p || "").trim();
  if (!trimmed) return undefined;
  const raw = await fs.readFile(trimmed, "utf8");
  return JSON.parse(raw);
}

async function main() {
  console.log("\n[1] Running ingest verify...\n");

  const expectedNetwork = parseOptionalHederaNetwork(TEST_EXPECTED_HEDERA_NETWORK);
  const receipt = await readJsonMaybe(TEST_RECEIPT_PATH);
  const bundle = await readJsonMaybe(TEST_BUNDLE_PATH);
  const receiptNetwork = receipt?.hedera_network
    ? String(receipt.hedera_network).trim().toLowerCase()
    : null;

  if (expectedNetwork && !receipt) {
    throw new Error(
      "TEST_EXPECTED_HEDERA_NETWORK requires TEST_RECEIPT_PATH because bundle evidence is network-independent"
    );
  }

  if (expectedNetwork && receiptNetwork !== expectedNetwork) {
    throw new Error(
      `Receipt Hedera network mismatch: expected ${expectedNetwork}, got ${String(receiptNetwork)}`
    );
  }

  const result = await ingest.verifyIngestRemote(
    {
      baseUrl: HF_BASE_URL,
      auth: {
        apiKey: HF_API_KEY,
      },
    },
    {
      ...(receipt ? { receipt } : {}),
      ...(bundle ? { bundle } : {}),
      ...(TEST_ROOT_DIR ? { root_dir: TEST_ROOT_DIR } : {}),
    },
    expectedNetwork ? { hederaNetwork: expectedNetwork } : undefined
  );

  if (expectedNetwork) {
    if (!result.network_binding) {
      throw new Error("HF verify response missing network_binding for explicit expected network");
    }
    if (!result.network_binding.ok) {
      throw new Error(
        `HF network binding failed: ${String(result.network_binding.status || "unknown")}`
      );
    }
    if (result.network_binding.actual !== expectedNetwork) {
      throw new Error(
        `HF network binding actual mismatch: expected ${expectedNetwork}, got ${String(
          result.network_binding.actual
        )}`
      );
    }
  }

  console.log("[verify summary]");
  console.log(
    JSON.stringify(
      {
        expected_hedera_network: expectedNetwork ?? null,
        receipt_hedera_network: receiptNetwork,
        receipt_ok: result.receipt_verify?.ok ?? null,
        bundle_ok: result.bundle_verify?.ok ?? null,
        artifact_binding_ok: result.artifact_binding?.ok ?? null,
        network_binding_ok: result.network_binding?.ok ?? null,
        network_binding_status: result.network_binding?.status ?? null,
        local_ok: result.local_verify?.ok ?? null,
      },
      null,
      2
    )
  );

  console.log("\n[2] Full verify payload\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("\n[verify failed]");
  console.error(err);
  process.exit(1);
});