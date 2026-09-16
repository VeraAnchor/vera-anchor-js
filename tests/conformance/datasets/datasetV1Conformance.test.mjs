// ============================================================================
// File: tests/conformance/datasets/datasetV1Conformance.test.mjs
// Version: 1.0.1-portable-vector-integrity | 2026-09-08
// Purpose:
//   Golden-vector conformance for the Dataset v1 deterministic contract.
// Notes:
//   - Runs against the built SDK distribution using Node's native test runner.
//   - No hashing/canonicalization logic is duplicated in this test.
//   - Vector SHA-256 is distribution integrity only, not Dataset evidence.
//   - Distribution hashing canonicalizes text line endings to LF so the same
//     vector set has one digest across Windows, macOS, and Linux checkouts.
// ============================================================================

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { buildDatasetReceiptV1 } from "../../../dist/datasets/receipt.js";
import { planAnchor, executeAnchor } from "../../../dist/datasets/workflow.js";

const VECTOR_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "v1",
);

function readUtf8(fileName) {
  return fs.readFileSync(path.join(VECTOR_DIR, fileName), "utf8");
}

function normalizeVectorText(raw) {
  return raw.replace(/\r\n?/g, "\n");
}

function vectorSha256(raw) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(normalizeVectorText(raw), "utf8"))
    .digest("hex");
}

const vectorRaw = readUtf8("dataset-v1-vectors.json");
const manifest = JSON.parse(readUtf8("manifest.json"));
const vectors = JSON.parse(vectorRaw);

async function materializeVector(vector) {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `vera-dataset-${vector.case_id}-`),
  );

  for (const file of vector.input.files) {
    const target = path.join(root, ...file.path_rel.split("/"));
    await fs.promises.mkdir(path.dirname(target), {
      recursive: true,
    });

    await fs.promises.writeFile(
      target,
      Buffer.from(file.content_base64, "base64"),
    );
  }

  return root;
}

describe("Dataset v1 golden-vector conformance", () => {
  test("locks the vector distribution manifest", () => {
    assert.equal(
      manifest.manifest_schema,
      "vera.dataset.conformance.manifest.v1",
    );
    assert.equal(manifest.vector_schema, "vera.dataset.conformance.v1");
    assert.equal(vectors.vector_schema, manifest.vector_schema);
    assert.equal(manifest.vector_file, "dataset-v1-vectors.json");
    assert.equal(vectorSha256(vectorRaw), manifest.vector_sha256);
    assert.deepEqual(
      vectors.cases.map((vector) => vector.case_id),
      manifest.cases,
    );
  });

  test("keeps the vector distribution digest stable across LF and CRLF checkouts", () => {
    const lf = normalizeVectorText(vectorRaw);
    const crlf = lf.replace(/\n/g, "\r\n");

    assert.equal(vectorSha256(lf), manifest.vector_sha256);
    assert.equal(vectorSha256(crlf), manifest.vector_sha256);
  });

  for (const vector of vectors.cases) {
    test(`${vector.case_id}: matches frozen Dataset v1 content evidence`, async () => {
      const root = await materializeVector(vector);

      try {
        const actual = await executeAnchor({
          mode: "hash_only",
          identity: vector.input.identity,
          root_dir: root,
          ...(vector.input.rules ? { rules: vector.input.rules } : {}),
        });

        assert.deepEqual(actual, vector.expected.evidence);

        const receipt = buildDatasetReceiptV1({
          mode: "hash_only",
          evidence: actual,
          evidence_pointer: vector.input.evidence_pointer,
          core: null,
        });

        assert.deepEqual(receipt, vector.expected.hash_only_receipt);
      } finally {
        await fs.promises.rm(root, {
          recursive: true,
          force: true,
        });
      }
    });
  }

  test("binds explicit ledger plans and receipts to Hedera network without changing content evidence", async () => {
    const vector = vectors.cases.find(
      (item) => item.case_id === "basic-v1",
    );

    assert.ok(vector, "basic-v1 vector missing");
    assert.ok(
      vector.expected.network,
      "basic-v1 network vector missing",
    );

    const root = await materializeVector(vector);

    try {
      const evidence = await executeAnchor({
        mode: "hash_only",
        identity: vector.input.identity,
        root_dir: root,
      });

      assert.deepEqual(evidence, vector.expected.evidence);

      const implicitPlan = planAnchor({
        mode: "register_and_anchor",
        identity: vector.input.identity,
      });

      const testnetPlan = planAnchor({
        mode: "register_and_anchor",
        identity: vector.input.identity,
        hedera_network: "testnet",
      });

      const mainnetPlan = planAnchor({
        mode: "register_and_anchor",
        identity: vector.input.identity,
        hedera_network: "mainnet",
      });

      assert.equal(
        implicitPlan.plan_id,
        vector.expected.network.implicit_plan_id,
      );
      assert.equal("hedera_network" in implicitPlan, false);

      assert.equal(
        testnetPlan.plan_id,
        vector.expected.network.testnet_plan_id,
      );
      assert.equal(testnetPlan.hedera_network, "testnet");

      assert.equal(
        mainnetPlan.plan_id,
        vector.expected.network.mainnet_plan_id,
      );
      assert.equal(mainnetPlan.hedera_network, "mainnet");

      assert.notEqual(
        testnetPlan.plan_id,
        mainnetPlan.plan_id,
      );

      const testnetReceipt = buildDatasetReceiptV1({
        mode: "register_and_anchor",
        evidence,
        hedera_network: "testnet",
        evidence_pointer: vector.input.evidence_pointer,
        core: null,
      });

      const mainnetReceipt = buildDatasetReceiptV1({
        mode: "register_and_anchor",
        evidence,
        hedera_network: "mainnet",
        evidence_pointer: vector.input.evidence_pointer,
        core: null,
      });

      assert.deepEqual(
        testnetReceipt,
        vector.expected.network.testnet_receipt,
      );
      assert.deepEqual(
        mainnetReceipt,
        vector.expected.network.mainnet_receipt,
      );
      assert.notEqual(
        testnetReceipt.receipt_id,
        mainnetReceipt.receipt_id,
      );
    } finally {
      await fs.promises.rm(root, {
        recursive: true,
        force: true,
      });
    }
  });
});