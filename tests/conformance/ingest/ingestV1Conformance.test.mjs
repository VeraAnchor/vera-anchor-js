// ============================================================================
// File: tests/conformance/ingest/ingestV1Conformance.test.mjs
// Version: 1.0.0-ingest-v1-golden-conformance | 2026-09-09
// Purpose:
//   Golden-vector conformance for the Vera Anchor JS SDK Ingest v1 contract.
// Notes:
//   - Runs against the built SDK distribution using Node's native test runner.
//   - Uses the exact frozen vectors produced by the canonical HF backend.
//   - No hashing/canonicalization logic is duplicated in this test.
//   - Content evidence is network-independent.
//   - Explicit ledger plans/final receipts are network-bound.
//   - Vector SHA-256 is distribution integrity only, not Ingest evidence.
// ============================================================================

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  executeIngest,
  planIngest,
} from "../../../dist/ingest/execute.js";
import {
  buildIngestReceiptV1,
} from "../../../dist/ingest/receipt.js";
import {
  verifyIngestArtifactBinding,
  verifyIngestBundle,
  verifyIngestReceipt,
} from "../../../dist/ingest/verifier.js";

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

const vectorRaw = readUtf8("ingest-v1-vectors.json");
const manifest = JSON.parse(readUtf8("manifest.json"));
const vectors = JSON.parse(vectorRaw);

async function materializeMaterial(vector) {
  const material = vector.input.material;

  if (material.kind === "json" || material.kind === "text") {
    return {
      material: { ...material },
      cleanup: async () => {},
    };
  }

  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `vera-ingest-${vector.case_id}-`),
  );

  if (material.kind === "file") {
    const target = path.join(
      root,
      ...material.file.path_rel.split("/"),
    );

    await fs.promises.mkdir(path.dirname(target), {
      recursive: true,
    });
    await fs.promises.writeFile(
      target,
      Buffer.from(material.file.content_base64, "base64"),
    );

    return {
      material: {
        kind: "file",
        path: target,
      },
      cleanup: () =>
        fs.promises.rm(root, {
          recursive: true,
          force: true,
        }),
    };
  }

  for (const file of material.files) {
    const target = path.join(
      root,
      ...file.path_rel.split("/"),
    );

    await fs.promises.mkdir(path.dirname(target), {
      recursive: true,
    });
    await fs.promises.writeFile(
      target,
      Buffer.from(file.content_base64, "base64"),
    );
  }

  return {
    material: {
      kind: "file_set",
      root_dir: root,
      ...(material.rules ? { rules: material.rules } : {}),
    },
    cleanup: () =>
      fs.promises.rm(root, {
        recursive: true,
        force: true,
      }),
  };
}

describe("Ingest v1 golden-vector conformance", () => {
  test("locks the vector distribution manifest", () => {
    assert.equal(
      manifest.manifest_schema,
      "vera.ingest.conformance.manifest.v1",
    );
    assert.equal(
      manifest.vector_schema,
      "vera.ingest.conformance.v1",
    );
    assert.equal(vectors.vector_schema, manifest.vector_schema);
    assert.equal(manifest.vector_file, "ingest-v1-vectors.json");
    assert.equal(vectorSha256(vectorRaw), manifest.vector_sha256);

    assert.deepEqual(
      vectors.cases.map((vector) => vector.case_id),
      manifest.cases,
    );

    assert.deepEqual(manifest.cases, [
      "json-v1",
      "text-v1",
      "file-v1",
      "file-set-v1",
    ]);
  });

  test("keeps the vector distribution digest stable across LF and CRLF checkouts", () => {
    const lf = normalizeVectorText(vectorRaw);
    const crlf = lf.replace(/\n/g, "\r\n");

    assert.equal(vectorSha256(lf), manifest.vector_sha256);
    assert.equal(vectorSha256(crlf), manifest.vector_sha256);
  });

  for (const vector of vectors.cases) {
    test(`${vector.case_id}: matches frozen Ingest v1 content evidence`, async () => {
      const materialized = await materializeMaterial(vector);

      try {
        const evidence = await executeIngest({
          mode: "hash_only",
          identity: vector.input.identity,
          material: materialized.material,
        });

        assert.deepEqual(
          evidence,
          vector.expected.evidence,
        );

        const receipt = buildIngestReceiptV1({
          mode: "hash_only",
          evidence,
          evidence_pointer: vector.input.evidence_pointer,
          core: null,
        });

        assert.deepEqual(
          receipt,
          vector.expected.hash_only_receipt,
        );

        assert.deepEqual(
          verifyIngestBundle(evidence.bundle),
          {
            ok: true,
            mismatches: [],
            computed: {
              bundle_digest: evidence.bundle_digest,
              fingerprint: evidence.fingerprint,
              idempotency_key: evidence.idempotency_key,
              merkle_root: evidence.merkle_root,
              item_count: evidence.bundle.summary.item_count,
              total_bytes: evidence.bundle.summary.total_bytes,
            },
          },
        );

        assert.deepEqual(
          verifyIngestReceipt(receipt),
          {
            ok: true,
            mismatches: [],
            computed: {
              receipt_id: receipt.receipt_id,
              idempotency_key: evidence.idempotency_key,
            },
          },
        );

        assert.deepEqual(
          verifyIngestArtifactBinding({
            receipt,
            bundle: evidence.bundle,
          }),
          {
            ok: true,
            mismatches: [],
            computed: {
              object_key: evidence.bundle.identity.object_key,
              object_kind: evidence.bundle.identity.object_kind,
              version_label:
                evidence.bundle.identity.version_label ?? null,
              program:
                evidence.bundle.identity.program ?? null,
              bundle_digest: evidence.bundle_digest,
              fingerprint: evidence.fingerprint,
              merkle_root: evidence.merkle_root ?? null,
              idempotency_key: evidence.idempotency_key,
              item_count: evidence.bundle.summary.item_count,
              total_bytes: evidence.bundle.summary.total_bytes,
            },
          },
        );
      } finally {
        await materialized.cleanup();
      }
    });
  }

  test("keeps local modes evidence-identical", async () => {
    const vector = vectors.cases.find(
      (item) => item.case_id === "json-v1",
    );

    assert.ok(vector, "json-v1 vector missing");

    const materialized = await materializeMaterial(vector);

    try {
      const hashOnly = await executeIngest({
        mode: "hash_only",
        identity: vector.input.identity,
        material: materialized.material,
      });

      const merkleOnly = await executeIngest({
        mode: "merkle_only",
        identity: vector.input.identity,
        material: materialized.material,
      });

      assert.deepEqual(hashOnly, vector.expected.evidence);
      assert.deepEqual(merkleOnly, hashOnly);
    } finally {
      await materialized.cleanup();
    }
  });

  test("locks redacted-path, odd-leaf, and zero-byte file-set semantics", () => {
    const vector = vectors.cases.find(
      (item) => item.case_id === "file-set-v1",
    );

    assert.ok(vector, "file-set-v1 vector missing");

    const items = vector.expected.evidence.bundle.items;

    assert.equal(items.length, 3);
    assert.equal(
      vector.expected.evidence.bundle.merkle.leaf_count,
      3,
    );
    assert.equal(
      items.some((item) => item.bytes === 0),
      true,
    );

    for (const item of items) {
      assert.equal("path_hash" in item, true);
      assert.equal("path_rel" in item, false);
    }
  });

  test("binds explicit ledger plans and final receipts to Hedera network without changing evidence", async () => {
    const vector = vectors.cases.find(
      (item) => item.case_id === "json-v1",
    );

    assert.ok(vector, "json-v1 vector missing");
    assert.ok(
      vector.input.ledger,
      "json-v1 ledger input missing",
    );
    assert.ok(
      vector.expected.network,
      "json-v1 network vector missing",
    );

    const materialized = await materializeMaterial(vector);

    try {
      const evidence = await executeIngest({
        mode: "hash_only",
        identity: vector.input.identity,
        material: materialized.material,
      });

      assert.deepEqual(
        evidence,
        vector.expected.evidence,
      );

      const planBase = {
        mode: "register_and_anchor",
        identity: vector.input.identity,
        material: materialized.material,
        domain: vector.input.ledger.domain,
        proof_date: vector.input.ledger.proof_date,
        ...(typeof vector.input.ledger.issue_certificate === "boolean"
          ? {
              issue_certificate:
                vector.input.ledger.issue_certificate,
            }
          : {}),
      };

      const implicitPlan = planIngest(planBase);
      const testnetPlan = planIngest({
        ...planBase,
        hedera_network: "testnet",
      });
      const mainnetPlan = planIngest({
        ...planBase,
        hedera_network: "mainnet",
      });

      assert.deepEqual(
        implicitPlan,
        vector.expected.network.implicit_plan,
      );
      assert.deepEqual(
        testnetPlan,
        vector.expected.network.testnet_plan,
      );
      assert.deepEqual(
        mainnetPlan,
        vector.expected.network.mainnet_plan,
      );

      assert.equal("hedera_network" in implicitPlan, false);
      assert.equal(testnetPlan.hedera_network, "testnet");
      assert.equal(mainnetPlan.hedera_network, "mainnet");

      assert.notEqual(
        testnetPlan.plan_id,
        mainnetPlan.plan_id,
      );
      assert.notEqual(
        implicitPlan.plan_id,
        testnetPlan.plan_id,
      );
      assert.notEqual(
        implicitPlan.plan_id,
        mainnetPlan.plan_id,
      );

      const testnetReceipt = buildIngestReceiptV1({
        mode: "register_and_anchor",
        evidence,
        hedera_network: "testnet",
        domain: vector.input.ledger.domain,
        proof_date: vector.input.ledger.proof_date,
        evidence_pointer: vector.input.evidence_pointer,
        core: null,
      });

      const mainnetReceipt = buildIngestReceiptV1({
        mode: "register_and_anchor",
        evidence,
        hedera_network: "mainnet",
        domain: vector.input.ledger.domain,
        proof_date: vector.input.ledger.proof_date,
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

      assert.deepEqual(
        testnetReceipt.evidence,
        mainnetReceipt.evidence,
      );
      assert.notEqual(
        testnetReceipt.receipt_id,
        mainnetReceipt.receipt_id,
      );

      assert.deepEqual(
        verifyIngestReceipt(testnetReceipt),
        {
          ok: true,
          mismatches: [],
          computed: {
            receipt_id: testnetReceipt.receipt_id,
            idempotency_key: evidence.idempotency_key,
            hedera_network: "testnet",
          },
        },
      );

      assert.deepEqual(
        verifyIngestReceipt(mainnetReceipt),
        {
          ok: true,
          mismatches: [],
          computed: {
            receipt_id: mainnetReceipt.receipt_id,
            idempotency_key: evidence.idempotency_key,
            hedera_network: "mainnet",
          },
        },
      );

      const tamperedNetwork = {
        ...testnetReceipt,
        hedera_network: "mainnet",
      };

      const tamperedCheck = verifyIngestReceipt(
        tamperedNetwork,
      );

      assert.equal(tamperedCheck.ok, false);
      assert.equal(
        tamperedCheck.mismatches.some(
          (item) => item.field === "receipt_id",
        ),
        true,
      );
    } finally {
      await materialized.cleanup();
    }
  });
});