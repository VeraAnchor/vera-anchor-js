import { postJson, type HfLocalClientConfig } from "../client.js";
import { executeAnchor } from "./workflow.js";
import { buildDatasetReceiptV1 } from "./receipt.js";
import {
  parseAnchorPlanRequestV1,
  parseAnchorSubmitRequestV1,
  parseDatasetVerifyRequestV1,
  type AnchorPlanRequestV1,
  type AnchorSubmitRequestV1,
  type DatasetReceiptV1,
} from "./validators.js";
import type {
  AnchorResult,
  DatasetRules,
  DatasetIdentity,
} from "./types.js";

type DatasetAnchorProgressHooks = Readonly<{
  onScanProgress?: Parameters<typeof executeAnchor>[1] extends infer T
    ? T extends { onScanProgress?: infer F }
      ? F
      : never
    : never;
  onHashProgress?: Parameters<typeof executeAnchor>[1] extends infer T
    ? T extends { onHashProgress?: infer F }
      ? F
      : never
    : never;
}>;

export type DatasetAnchorPlanRemoteResponse = Readonly<{
  dataset_key: string;
  plan_id: string;
  steps: ReadonlyArray<string>;
}>;

export type DatasetAnchorSubmitRemoteResponse = Readonly<{
  mode: "register_and_anchor";
  evidence: AnchorResult;
  receipt: DatasetReceiptV1;
  core?: Readonly<{
    dataset?: Record<string, unknown>;
    version?: Record<string, unknown>;
    published?: Record<string, unknown>;
    certificate?: Record<string, unknown>;
    hcs_attach?: Record<string, unknown>;
    replay?: Readonly<{
      reused?: boolean;
      replay?: boolean;
      replay_reason?: string | null;
    }>;
  }>;
}>;

export type DatasetAnchorVerifyRemoteResponse = Readonly<{
  receipt_verify?: Readonly<{
    ok: boolean;
    mismatches: ReadonlyArray<unknown>;
    computed?: Readonly<Record<string, unknown>>;
  }>;
  bundle_verify?: Readonly<{
    ok: boolean;
    mismatches: ReadonlyArray<unknown>;
    computed?: Readonly<Record<string, unknown>>;
  }>;
  local_verify?: Readonly<{
    ok: boolean;
    mismatches: ReadonlyArray<unknown>;
    computed?: Readonly<Record<string, unknown>>;
  }>;
}>;

export type ExecuteDatasetAnchorLocalOnlyInput = Readonly<{
  identity: DatasetIdentity;
  root_dir: string;
  rules?: DatasetRules;
  evidence_pointer?: string;
  hooks?: DatasetAnchorProgressHooks;
}>;

export type ExecuteDatasetAnchorLocalOnlyResult = Readonly<{
  local: Readonly<{
    evidence: AnchorResult;
    receipt: DatasetReceiptV1;
  }>;
}>;

export type ExecuteDatasetAnchorLocalThenSubmitInput = Readonly<{
  identity: DatasetIdentity;
  root_dir: string;
  rules?: DatasetRules;
  display_name?: string;
  metadata?: Readonly<Record<string, unknown>>;
  evidence_pointer: string;
  publish_visibility?: "public" | "unlisted";
  set_active?: boolean;
  issue_certificate?: boolean;
  hooks?: DatasetAnchorProgressHooks;
}>;

function normalizeFilePointer(rootDir: string): string {
  const trimmed = String(rootDir || "").trim();
  if (!trimmed) return "";
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
  return `file://${trimmed}`;
}

export async function planDatasetAnchorRemote(
  config: HfLocalClientConfig,
  req: AnchorPlanRequestV1
): Promise<DatasetAnchorPlanRemoteResponse> {
  const parsed = parseAnchorPlanRequestV1(req);

  return postJson<DatasetAnchorPlanRemoteResponse>(
    config,
    "/datasets/anchor/plan",
    parsed
  );
}

export async function submitDatasetAnchorRemote(
  config: HfLocalClientConfig,
  req: AnchorSubmitRequestV1,
  opts?: { idempotencyKey?: string }
): Promise<DatasetAnchorSubmitRemoteResponse> {
  const parsed = parseAnchorSubmitRequestV1(req);

  return postJson<DatasetAnchorSubmitRemoteResponse>(
    config,
    "/datasets/anchor/submit",
    parsed,
    {
      idempotencyKey: opts?.idempotencyKey ?? parsed.evidence.idempotency_key,
    }
  );
}

export async function verifyDatasetAnchorRemote(
  config: HfLocalClientConfig,
  req: Readonly<{
    receipt?: DatasetReceiptV1;
    bundle?: AnchorResult["bundle"];
    root_dir?: string;
  }>
): Promise<DatasetAnchorVerifyRemoteResponse> {
  const parsed = parseDatasetVerifyRequestV1(req);

  return postJson<DatasetAnchorVerifyRemoteResponse>(
    config,
    "/datasets/anchor/verify",
    parsed
  );
}

export async function executeDatasetAnchorLocalOnly(
  input: ExecuteDatasetAnchorLocalOnlyInput
): Promise<ExecuteDatasetAnchorLocalOnlyResult> {
  const evidence = await executeAnchor(
    {
      mode: "hash_only",
      identity: input.identity,
      root_dir: input.root_dir,
      ...(input.rules ? { rules: input.rules } : {}),
    },
    input.hooks
  );

  const localReceipt = buildDatasetReceiptV1({
    mode: "hash_only",
    evidence,
    evidence_pointer:
      String(input.evidence_pointer || "").trim() ||
      normalizeFilePointer(input.root_dir),
    core: null,
  });

  return Object.freeze({
    local: Object.freeze({
      evidence,
      receipt: localReceipt,
    }),
  });
}

export async function executeDatasetAnchorLocalThenSubmit(
  config: HfLocalClientConfig,
  input: ExecuteDatasetAnchorLocalThenSubmitInput
): Promise<Readonly<{
  local: Readonly<{
    evidence: AnchorResult;
    receipt: DatasetReceiptV1;
  }>;
  remote: DatasetAnchorSubmitRemoteResponse;
}>> {
  const local = await executeDatasetAnchorLocalOnly({
    identity: input.identity,
    root_dir: input.root_dir,
    ...(input.rules ? { rules: input.rules } : {}),
    evidence_pointer: input.evidence_pointer,
    ...(input.hooks ? { hooks: input.hooks } : {}),
  });

  const remote = await submitDatasetAnchorRemote(
    config,
    {
      mode: "register_and_anchor",
      identity: input.identity,
      evidence: local.local.evidence,
      evidence_pointer: input.evidence_pointer,
      ...(input.display_name ? { display_name: input.display_name } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.publish_visibility ? { publish_visibility: input.publish_visibility } : {}),
      ...(input.set_active !== undefined ? { set_active: input.set_active } : {}),
      ...(typeof input.issue_certificate === "boolean"
        ? { issue_certificate: input.issue_certificate }
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