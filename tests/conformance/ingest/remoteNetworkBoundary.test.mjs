// ============================================================================
// File: tests/regression/conformance/remoteNetworkBoundary.test.mjs
// Version: 1.0.0-ingest-remote-network-boundary | 2026-09-09
// Purpose:
//   Regression coverage for JS SDK Ingest remote/network boundaries.
// Notes:
//   - Runs against built dist with Node's native test runner.
//   - Uses a local HTTP capture server; no shared client mocks or real HF calls.
//   - Local evidence remains network-independent.
// ============================================================================

import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { after, before, beforeEach, describe, test } from "node:test";

import { executeIngest } from "../../../dist/ingest/execute.js";
import { buildIngestReceiptV1 } from "../../../dist/ingest/receipt.js";
import {
  executeIngestLocalThenSubmit,
  executeIngestRemote,
  planIngestRemote,
  submitIngestRemote,
  verifyIngestRemote,
} from "../../../dist/ingest/remote.js";

const API_KEY = "test-api-key";
const DOMAIN = "hf:ingest|org:11111111-1111-4111-8111-111111111111";
const PROOF_DATE = "2026-09-09";
const EVIDENCE_POINTER = "inline://ingest-remote-network-test";

const IDENTITY = Object.freeze({
  object_key: "conformance.remote-network.json.v1",
  object_kind: "json",
  program: "conformance",
  version_label: "v1",
});

const MATERIAL = Object.freeze({
  kind: "json",
  value: Object.freeze({
    hello: "world",
    purpose: "remote-network-boundary",
  }),
});

const requests = [];
let server;
let baseUrl;

function config() {
  return {
    baseUrl,
    auth: {
      apiKey: API_KEY,
    },
  };
}

function anchoredRequest(hederaNetwork) {
  return {
    mode: "register_and_anchor",
    identity: IDENTITY,
    material: MATERIAL,
    evidence_pointer: EVIDENCE_POINTER,
    domain: DOMAIN,
    proof_date: PROOF_DATE,
    hedera_network: hederaNetwork,
    issue_certificate: false,
  };
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendResult(res, result) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      result,
    }),
  );
}

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const url = new URL(req.url, "http://127.0.0.1");

      requests.push({
        method: req.method,
        url: req.url,
        headers: {
          ...req.headers,
        },
        body,
      });

      if (url.pathname === "/v1/ingest/plan") {
        return sendResult(res, {
          object_key: body.identity?.object_key,
          ...(body.hedera_network
            ? { hedera_network: body.hedera_network }
            : {}),
          plan_id: "remote-plan-id",
          steps: [
            "normalize",
            "hash",
            "bundle",
            "anchor_payload",
          ],
        });
      }

      if (url.pathname === "/v1/ingest/execute") {
        return sendResult(res, {
          mode: body.mode,
          ...(body.hedera_network
            ? { hedera_network: body.hedera_network }
            : {}),
          evidence: null,
          receipt: null,
        });
      }

      if (url.pathname === "/v1/ingest/submit") {
        return sendResult(res, {
          mode: "register_and_anchor",
          ...(body.hedera_network
            ? { hedera_network: body.hedera_network }
            : {}),
          evidence: body.evidence,
          receipt: {
            receipt_id: "remote-receipt-id",
            hedera_network: body.hedera_network,
          },
          core: {},
        });
      }

      if (url.pathname === "/v1/ingest/verify") {
        const network =
          url.searchParams.get("hedera_network");

        return sendResult(res, {
          network_binding: network
            ? {
                ok: true,
                requested: network,
                actual: network,
                status: "matched",
              }
            : undefined,
        });
      }

      res.statusCode = 404;
      res.end();
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: "TEST_SERVER_ERROR",
          message: String(error?.message ?? error),
        }),
      );
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server?.listening) return;

  const closed = once(server, "close");
  server.close();
  await closed;
});

beforeEach(() => {
  requests.length = 0;
});

describe("Ingest remote network boundary", () => {
  test("propagates network through plan/execute/submit and keeps verify selection out-of-band", async () => {
    const evidence = await executeIngest({
      mode: "hash_only",
      identity: IDENTITY,
      material: MATERIAL,
    });

    const mainnetReceipt = buildIngestReceiptV1({
      mode: "register_and_anchor",
      evidence,
      hedera_network: "mainnet",
      domain: DOMAIN,
      proof_date: PROOF_DATE,
      evidence_pointer: EVIDENCE_POINTER,
      core: null,
    });

    await planIngestRemote(config(), {
      mode: "register_and_anchor",
      identity: IDENTITY,
      material: MATERIAL,
      domain: DOMAIN,
      proof_date: PROOF_DATE,
      hedera_network: "testnet",
      issue_certificate: false,
    });

    await executeIngestRemote(
      config(),
      anchoredRequest("testnet"),
      {
        idempotencyKey: "execute-idem",
      },
    );

    await submitIngestRemote(
      config(),
      {
        mode: "register_and_anchor",
        identity: IDENTITY,
        evidence,
        evidence_pointer: EVIDENCE_POINTER,
        domain: DOMAIN,
        proof_date: PROOF_DATE,
        hedera_network: "mainnet",
        issue_certificate: false,
      },
      {
        idempotencyKey: "submit-idem",
      },
    );

    const verify = await verifyIngestRemote(
      config(),
      {
        receipt: mainnetReceipt,
        bundle: evidence.bundle,
      },
      {
        hederaNetwork: "mainnet",
      },
    );

    assert.equal(requests.length, 4);

    const [
      planReq,
      executeReq,
      submitReq,
      verifyReq,
    ] = requests;

    assert.equal(
      planReq.url,
      "/v1/ingest/plan",
    );
    assert.equal(
      planReq.body.hedera_network,
      "testnet",
    );

    assert.equal(
      executeReq.url,
      "/v1/ingest/execute",
    );
    assert.equal(
      executeReq.body.hedera_network,
      "testnet",
    );
    assert.equal(
      executeReq.headers["idempotency-key"],
      "execute-idem",
    );

    assert.equal(
      submitReq.url,
      "/v1/ingest/submit",
    );
    assert.equal(
      submitReq.body.hedera_network,
      "mainnet",
    );
    assert.equal(
      submitReq.headers["idempotency-key"],
      "submit-idem",
    );

    assert.equal(
      verifyReq.url,
      "/v1/ingest/verify?hedera_network=mainnet",
    );
    assert.equal(
      "hedera_network" in verifyReq.body,
      false,
    );
    assert.equal(
      verifyReq.body.receipt.hedera_network,
      "mainnet",
    );

    for (const request of requests) {
      assert.equal(
        request.headers.authorization,
        `Bearer ${API_KEY}`,
      );
    }

    assert.deepEqual(
      verify.network_binding,
      {
        ok: true,
        requested: "mainnet",
        actual: "mainnet",
        status: "matched",
      },
    );
  });

  test("local-then-submit keeps local evidence network-independent and binds only the submit", async () => {
    const result =
      await executeIngestLocalThenSubmit(
        config(),
        {
          request:
            anchoredRequest("testnet"),
        },
      );

    assert.equal(requests.length, 1);

    const [submitReq] = requests;

    assert.equal(
      submitReq.url,
      "/v1/ingest/submit",
    );
    assert.equal(
      submitReq.body.hedera_network,
      "testnet",
    );

    assert.equal(
      "hedera_network" in
        result.local.evidence,
      false,
    );
    assert.equal(
      "hedera_network" in
        result.local.receipt,
      false,
    );

    assert.deepEqual(
      submitReq.body.evidence,
      result.local.evidence,
    );

    assert.equal(
      submitReq.headers["idempotency-key"],
      result.local.evidence
        .idempotency_key,
    );

    assert.equal(
      result.remote.hedera_network,
      "testnet",
    );
    assert.equal(
      result.remote.receipt
        .hedera_network,
      "testnet",
    );
  });
});