// ============================================================================
// File: src/datasets/receipt.ts
// Version: 1.0-hf-datasets-receipt-v1 | 2026-03-06
// Purpose:
//   Deterministic receipt builder for dataset anchor flows.
// Notes:
//   - Pure, side-effect free.
//   - Receipt ID is a deterministic hash over the receipt body excluding receipt_id.
// ============================================================================

import { hashJsonDigest } from "../hashing/contract.js";
import type { AnchorResult } from "./types.js";
import type { DatasetReceiptV1 } from "./validators.js";

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function pickDatasetCore(core: any): Record<string, unknown> | undefined {
  const ds = core?.dataset?.dataset ?? core?.dataset ?? null;
  if (!ds || typeof ds !== "object") return undefined;
  return stripUndefined({
    id: ds.id ?? undefined,
    dataset_key: ds.dataset_key ?? undefined,
    org_id: ds.org_id ?? undefined,
    program: ds.program ?? undefined,
    display_name: ds.display_name ?? undefined,
    visibility: ds.visibility ?? undefined,
    active_version: ds.active_version ?? undefined,
    active_manifest_hash: ds.active_manifest_hash ?? undefined,
    hcs_topic_id: ds.hcs_topic_id ?? undefined,
    hcs_transaction_id: ds.hcs_transaction_id ?? undefined,
    hcs_message_id: ds.hcs_message_id ?? undefined,
  });
}

function pickVersionCore(core: any): Record<string, unknown> | undefined {
  const raw = core?.version ?? null;
  const ver =
    raw &&
    typeof raw === "object" &&
    raw.version &&
    typeof raw.version === "object"
      ? raw.version
      : raw;
  if (!ver || typeof ver !== "object") return undefined;
  return stripUndefined({
    id: ver.id ?? undefined,
    dataset_key: ver.dataset_key ?? undefined,
    version: ver.version ?? undefined,
    dataset_fingerprint: ver.dataset_fingerprint ?? undefined,
    matrix_path: ver.matrix_path ?? undefined,
    artifact_bytes: ver.artifact_bytes ?? undefined,
    bytes_estimate: ver.bytes_estimate ?? undefined,
    schema_hash: ver.schema_hash ?? undefined,
    manifest_hash: ver.manifest_hash ?? undefined,
    sealed_at: ver.sealed_at ?? undefined,
    hcs_topic_id: ver.hcs_topic_id ?? undefined,
    hcs_transaction_id: ver.hcs_transaction_id ?? undefined,
    hcs_message_id: ver.hcs_message_id ?? undefined,
  });
}

function pickPublishedCore(core: any): Record<string, unknown> | undefined {
  const pub = core?.published ?? null;
  if (!pub || typeof pub !== "object") return undefined;
  return stripUndefined({
    published: pub.published ?? undefined,
    target: pub.target ?? undefined,
  });
}

function pickCertificateCore(core: any): Record<string, unknown> | undefined {
  const cert = core?.certificate ?? null;
  if (!cert || typeof cert !== "object") return undefined;

  const nft = cert?.nft ?? null;

  return stripUndefined({
    attempted: cert.attempted === undefined ? undefined : Boolean(cert.attempted),
    skipped: cert.skipped === undefined ? undefined : Boolean(cert.skipped),
    issued: cert.issued === undefined ? undefined : Boolean(cert.issued),
    deduped: cert.deduped === undefined ? undefined : Boolean(cert.deduped),
    requested: cert.requested === undefined ? undefined : Boolean(cert.requested),
    reason: cert.reason ?? undefined,
    ...(nft && typeof nft === "object"
      ? {
          nft: stripUndefined({
            id: nft.id ?? undefined,
            nft_id: nft.nft_id ?? undefined,
            token_id: nft.token_id ?? undefined,
            serial_number: nft.serial_number ?? undefined,
            wallet_address: nft.wallet_address ?? undefined,
            status: nft.status ?? undefined,
            proof_date: nft.proof_date ?? undefined,
            minted_at: nft.minted_at ?? undefined,
          }),
        }
      : {}),
  });
}

export function buildDatasetReceiptV1(opts: {
  mode: "hash_only" | "register_and_anchor";
  evidence: AnchorResult;
  evidence_pointer?: string | null;
  core?: Record<string, unknown> | null;
}): DatasetReceiptV1 {
  const bundle = (opts.evidence as any)?.bundle;
  const dataset_identity = bundle?.dataset_identity ?? {
    dataset_key: opts.evidence.dataset_key,
  };
  const rules = bundle?.rules ?? {};
  const file_count = Number(bundle?.summary?.file_count ?? 0);
  const total_bytes = Number(bundle?.summary?.total_bytes ?? 0);

  const core = opts.core
    ? stripUndefined({
        ...(pickDatasetCore(opts.core) ? { dataset: pickDatasetCore(opts.core) } : {}),
        ...(pickVersionCore(opts.core) ? { version: pickVersionCore(opts.core) } : {}),
        ...(pickPublishedCore(opts.core) ? { published: pickPublishedCore(opts.core) } : {}),
        ...(pickCertificateCore(opts.core) ? { certificate: pickCertificateCore(opts.core) } : {}),
      })
    : undefined;

  const body = stripUndefined({
    v: "v1" as const,
    kind: "dataset_anchor_receipt" as const,
    mode: opts.mode,
    dataset_identity,
    rules,
    evidence: {
      dataset_fingerprint: opts.evidence.dataset_fingerprint,
      bundle_digest: opts.evidence.bundle_digest,
      merkle_root: opts.evidence.merkle_root,
      idempotency_key: opts.evidence.idempotency_key,
      file_count,
      total_bytes,
    },
    ...(opts.evidence_pointer ? { pointers: { evidence_pointer: opts.evidence_pointer } } : {}),
    ...(core && Object.keys(core).length > 0 ? { core } : {}),
  });

  const receipt_id = hashJsonDigest({
    domain: "va:dataset:receipt:v1",
    value: body,
    alg: "sha3-512",
    encoding: "hex_lower",
  });

  return Object.freeze({
    ...body,
    receipt_id,
  }) as DatasetReceiptV1;
}