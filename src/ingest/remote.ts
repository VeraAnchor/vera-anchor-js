// ============================================================================
// File: src/ingest/remote.ts
// Version: 1.3-hf-ingest-remote-hedera-network-v1 | 2026-09-09
// Purpose:
//   Local-lib remote helpers for ingest flows.
//   - Local-only execute + receipt
//   - Remote HF execute / submit / verify
//   - Local deterministic evidence generation followed by remote submit
// Notes:
//   - Keeps deterministic local evidence generation in the local package.
//   - Uses HF only at explicit network boundaries.
// ============================================================================

import { pathToFileURL } from "node:url";
import { postJson, type HfLocalClientConfig } from "../client.js";
import { executeIngest, type ExecuteHooks } from "./execute.js";
import { buildIngestReceiptV1, type IngestReceiptV1 } from "./receipt.js";
import {
  parseIngestExecuteRequestV1,
  parseIngestPlanRequestV1,
  parseIngestSubmitRequestV1,
  parseIngestVerifyRequestV1,
  type IngestExecuteRequestV1,
  type IngestPlanRequestV1,
  type IngestSubmitRequestV1,
  type IngestVerifyRequestV1,
} from "./validators.js";
import { verifySubmittedIngestEvidence } from "./verifier.js";
import type {
  HederaNetwork,
  IngestInput,
  IngestPlan,
  IngestResult,
} from "./types.js";

export type IngestProgressHooks = Readonly<{
  onScanProgress?: ExecuteHooks["onScanProgress"];
  onHashProgress?: ExecuteHooks["onHashProgress"];
}>;

export type IngestExecuteRemoteResponse = Readonly<{
  mode: "hash_only" | "merkle_only" | "register_and_anchor";
  hedera_network?: HederaNetwork;
  evidence: IngestResult;
  receipt: IngestReceiptV1;
  core?: Readonly<{
    receipt_anchor?: Record<string, unknown>;
    root_build?: Record<string, unknown>;
    root_publish?: Record<string, unknown>;
    root_anchor?: Record<string, unknown>;
  }>;
}>;

export type IngestSubmitRemoteResponse = Readonly<{
  mode: "register_and_anchor";
  hedera_network?: HederaNetwork;
  evidence: IngestResult;
  receipt: IngestReceiptV1;
  core?: Readonly<{
    receipt_anchor?: Record<string, unknown>;
    root_build?: Record<string, unknown>;
    root_publish?: Record<string, unknown>;
    root_anchor?: Record<string, unknown>;
  }>;
}>;

type IngestVerifyLayer = Readonly<{
  ok: boolean;
  mismatches: ReadonlyArray<unknown>;
  computed?: Readonly<Record<string, unknown>>;
}>;

export type IngestVerifyRemoteResponse = Readonly<{
  receipt_verify?: IngestVerifyLayer;
  bundle_verify?: IngestVerifyLayer;
  artifact_binding?: IngestVerifyLayer;
  network_binding?: Readonly<{
    ok: boolean;
    requested: HederaNetwork;
    actual: HederaNetwork | null;
    status: "matched" | "mismatch" | "missing_receipt_network";
  }>;
  local_verify?: IngestVerifyLayer;
}>;

export type ExecuteIngestLocalOnlyInput = Readonly<{
  request: IngestInput;
  hooks?: IngestProgressHooks;
}>;

export type ExecuteIngestLocalOnlyResult = Readonly<{
  local: Readonly<{
    evidence: IngestResult;
    receipt: IngestReceiptV1;
  }>;
}>;

export type ExecuteIngestLocalThenSubmitInput = Readonly<{
  request: IngestInput & { mode: "register_and_anchor" };
  hooks?: IngestProgressHooks;
}>;

function normalizeHederaNetwork(value: unknown): HederaNetwork | null {
  if (value == null || String(value).trim() === "") return null;

  const network = String(value).trim().toLowerCase();
  if (network !== "testnet" && network !== "mainnet") {
    const err = new Error("unsupported_hedera_network");
    (err as any).code = "UNSUPPORTED_HEDERA_NETWORK";
    throw err;
  }

  return network;
}

function normalizeFilePointer(input: IngestInput): string {
  const explicit = String(input.evidence_pointer ?? "").trim();
  if (explicit) return explicit;

  if (input.material.kind === "file_set") {
    const rootDir = String(input.material.root_dir || "").trim();
    if (!rootDir) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rootDir)) return rootDir;
    return pathToFileURL(rootDir).href;
  }

  if (input.material.kind === "file") {
    const filePath = String(input.material.path || "").trim();
    if (!filePath) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath)) return filePath;
    return pathToFileURL(filePath).href;
  }

  return "";
}

export async function planIngestRemote(
  config: HfLocalClientConfig,
  req: IngestPlanRequestV1
): Promise<IngestPlan> {
  const parsed = parseIngestPlanRequestV1(req);

  return postJson<IngestPlan>(
    config,
    "/v1/ingest/plan",
    parsed
  );
}

export async function executeIngestRemote(
  config: HfLocalClientConfig,
  req: IngestExecuteRequestV1,
  opts?: { idempotencyKey?: string }
): Promise<IngestExecuteRemoteResponse> {
  const parsed = parseIngestExecuteRequestV1(req);

  return postJson<IngestExecuteRemoteResponse>(
    config,
    "/v1/ingest/execute",
    parsed,
    {
      idempotencyKey: opts?.idempotencyKey,
    }
  );
}

export async function submitIngestRemote(
  config: HfLocalClientConfig,
  req: IngestSubmitRequestV1,
  opts?: { idempotencyKey?: string }
): Promise<IngestSubmitRemoteResponse> {
  const parsed = parseIngestSubmitRequestV1(req);

  return postJson<IngestSubmitRemoteResponse>(
    config,
    "/v1/ingest/submit",
    parsed,
    {
      idempotencyKey: opts?.idempotencyKey,
    }
  );
}

export async function verifyIngestRemote(
  config: HfLocalClientConfig,
  req: IngestVerifyRequestV1,
  opts?: Readonly<{ hederaNetwork?: HederaNetwork | null }>
): Promise<IngestVerifyRemoteResponse> {
  const parsed = parseIngestVerifyRequestV1(req);
  const network = normalizeHederaNetwork(opts?.hederaNetwork);

  const route = network
    ? `/v1/ingest/verify?hedera_network=${encodeURIComponent(network)}`
    : "/v1/ingest/verify";

  return postJson<IngestVerifyRemoteResponse>(config, route, parsed);
}

export async function executeIngestLocalOnly(
  input: ExecuteIngestLocalOnlyInput
): Promise<ExecuteIngestLocalOnlyResult> {
  const parsed = parseIngestExecuteRequestV1(input.request);
  const evidence = await executeIngest(parsed, input.hooks);

  const receipt = buildIngestReceiptV1({
    mode: parsed.mode,
    evidence,
    domain: parsed.domain ?? null,
    proof_date: parsed.proof_date ?? null,
    evidence_pointer: normalizeFilePointer(parsed) || null,
    metadata: parsed.metadata ?? null,
    core: null,
  });

  return Object.freeze({
    local: Object.freeze({
      evidence,
      receipt,
    }),
  });
}

export async function executeIngestLocalThenSubmit(
  config: HfLocalClientConfig,
  input: ExecuteIngestLocalThenSubmitInput
): Promise<Readonly<{
  local: Readonly<{
    evidence: IngestResult;
    receipt: IngestReceiptV1;
  }>;
  remote: IngestSubmitRemoteResponse;
}>> {
  const parsed = parseIngestExecuteRequestV1(input.request);

  if (parsed.mode !== "register_and_anchor") {
    const err = new Error(
      "executeIngestLocalThenSubmit requires mode=register_and_anchor"
    );
    (err as any).code = "INVALID_MODE";
    throw err;
  }

  const local = await executeIngestLocalOnly({
    request: parsed,
    ...(input.hooks ? { hooks: input.hooks } : {}),
  });

  const verify = verifySubmittedIngestEvidence({
    identity: parsed.identity,
    evidence: local.local.evidence,
  });

  if (!verify.ok) {
    const err = new Error("local_submitted_evidence_invalid");
    (err as any).code = "LOCAL_SUBMITTED_EVIDENCE_INVALID";
    (err as any).detail = {
      mismatches: verify.mismatches,
      computed: verify.computed,
    };
    throw err;
  }

  const evidencePointer = normalizeFilePointer(parsed);
  if (!evidencePointer) {
    const err = new Error("evidence_pointer_required_for_submit");
    (err as any).code = "EVIDENCE_POINTER_REQUIRED";
    throw err;
  }

  const remote = await submitIngestRemote(
    config,
    {
      mode: "register_and_anchor",
      identity: parsed.identity,
      evidence: local.local.evidence,
      evidence_pointer: evidencePointer,
      domain: String(parsed.domain),
      proof_date: String(parsed.proof_date),
      ...(parsed.hedera_network
        ? { hedera_network: parsed.hedera_network }
        : {}),
      ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
      ...(typeof parsed.issue_certificate === "boolean"
        ? { issue_certificate: parsed.issue_certificate }
        : {}),
    },
    {
      idempotencyKey: local.local.evidence.idempotency_key,
    }
  );

  return Object.freeze({
    local: local.local,
    remote,
  });
}