import fs from "node:fs/promises";
import { ingest } from "../dist/index.js";

const HF_BASE_URL = process.env.HF_BASE_URL || "https://hfapi.veraanchor.com";
const HF_API_KEY = process.env.HF_API_KEY || "";

const TEST_RECEIPT_PATH = process.env.TEST_RECEIPT_PATH || "";
const TEST_BUNDLE_PATH = process.env.TEST_BUNDLE_PATH || "";
const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";

if (!HF_API_KEY) {
  throw new Error("Missing HF_API_KEY");
}

if (!TEST_RECEIPT_PATH && !TEST_BUNDLE_PATH) {
  throw new Error("Missing TEST_RECEIPT_PATH or TEST_BUNDLE_PATH");
}

async function readJsonMaybe(p) {
  const trimmed = String(p || "").trim();
  if (!trimmed) return undefined;
  const raw = await fs.readFile(trimmed, "utf8");
  return JSON.parse(raw);
}

async function main() {
  console.log("\n[1] Running ingest verify...\n");

  const receipt = await readJsonMaybe(TEST_RECEIPT_PATH);
  const bundle = await readJsonMaybe(TEST_BUNDLE_PATH);

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
    }
  );

  console.log("[verify summary]");
  console.log(
    JSON.stringify(
      {
        receipt_ok: result.receipt_verify?.ok ?? null,
        bundle_ok: result.bundle_verify?.ok ?? null,
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