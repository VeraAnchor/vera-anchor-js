// ============================================================================
// File: src/ingest/receipt.ts
// Version: 1.1-hf-ingest-receipt-v1-root-anchor | 2026-03-14
// Purpose:
//   Deterministic receipt builder for generic ingest flows.
// Notes:
//   - Pure, side-effect free.
//   - Receipt ID is a deterministic hash over the receipt body excluding
//     receipt_id.
//   - Supports local-only evidence and optional Core anchor enrichment.
// ============================================================================

import { hashJsonDigest } from "../hashing/contract.js";
import type { IngestBundleV1, IngestMode, IngestObjectKind, IngestResult } from "./types.js";

export type IngestReceiptV1 = Readonly<{
  v: "v1";
  kind: "ingest_receipt";
  receipt_id: string;
  mode: IngestMode;

  identity: Readonly<{
    object_key: string;
    object_kind: IngestObjectKind;
    version_label?: string | null;
    program?: string | null;
  }>;

  rules: IngestBundleV1["rules"];

  evidence: Readonly<{
    fingerprint: string;
    bundle_digest: string;
    merkle_root?: string;
    idempotency_key: string;
    item_count: number;
    total_bytes: number;
  }>;

  anchor?: Readonly<{
    domain?: string | null;
    proof_date?: string | null;
  }>;

  pointers?: Readonly<{
    evidence_pointer?: string | null;
  }>;

  metadata?: Readonly<Record<string, unknown>>;

  core?: Readonly<{
    receipt_anchor?: Readonly<Record<string, unknown>>;
    root_anchor?: Readonly<Record<string, unknown>>;
  }>;
}>;

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function pick(obj: Record<string, unknown> | null | undefined, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function pickProjectedAnchor(src: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(src)) return undefined;

  const anchor = isPlainObject(src.anchor) ? src.anchor : src;
  const publish = isPlainObject(src.publish) ? src.publish : null;
  const certificate = isPlainObject(src.certificate) ? src.certificate : null;

  const projected = stripUndefined({
    ...(pick(anchor, [
      "id",
      "proof_date",
      "domain",
      "anchor_kind",
      "root_id",
      "root_hash",
      "payload_type",
      "payload_hash",
      "payload_bytes",
      "leaf_id",
      "leaf_hash",
      "anchor_hash",
      "hcs_topic_id",
      "hcs_transaction_id",
      "hcs_message_id",
      "status",
      "published_at",
      "confirmed_at",
      "created_at",
      "updated_at",
    ]) ?? {}),
    ...(publish
      ? {
          publish: stripUndefined({
            topic_key: publish.topic_key ?? undefined,
            topic_name: publish.topic_name ?? undefined,
            topic_id: publish.topic_id ?? publish.hcs_topic_id ?? undefined,
            transaction_id: publish.transaction_id ?? publish.hcs_transaction_id ?? undefined,
            message_id: publish.message_id ?? publish.hcs_message_id ?? undefined,
            sequence_number: publish.sequence_number ?? undefined,
          }),
        }
      : {}),
    ...(certificate
      ? {
          certificate: stripUndefined({
            ...(certificate.attempted !== undefined ? { attempted: Boolean(certificate.attempted) } : {}),
            ...(certificate.skipped !== undefined ? { skipped: Boolean(certificate.skipped) } : {}),
            ...(certificate.issued !== undefined ? { issued: Boolean(certificate.issued) } : {}),
            ...(certificate.deduped !== undefined ? { deduped: Boolean(certificate.deduped) } : {}),
            ...(certificate.requested !== undefined ? { requested: Boolean(certificate.requested) } : {}),
            ...(certificate.reason !== undefined ? { reason: certificate.reason } : {}),
            ...(pick(
              isPlainObject(certificate.nft) ? certificate.nft : null,
              ["id", "nft_id", "token_id", "serial_number", "wallet_address", "status", "proof_date", "minted_at"]
            )
              ? {
                  nft: pick(
                    isPlainObject(certificate.nft) ? certificate.nft : null,
                    ["id", "nft_id", "token_id", "serial_number", "wallet_address", "status", "proof_date", "minted_at"]
                  ),
                }
              : {}),
          }),
        }
      : {}),
  });

  if (isPlainObject(projected.publish) && Object.keys(projected.publish).length === 0) {
    delete (projected as any).publish;
  }
  if (isPlainObject(projected.certificate) && Object.keys(projected.certificate).length === 0) {
    delete (projected as any).certificate;
  }

  return Object.keys(projected).length > 0 ? projected : undefined;
}

export function buildIngestReceiptV1(opts: {
  mode: IngestMode;
  evidence: IngestResult;
  domain?: string | null;
  proof_date?: string | null;
  evidence_pointer?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
  core?: Record<string, unknown> | null;
}): IngestReceiptV1 {
  const bundle = opts.evidence.bundle;

  const identity = bundle?.identity ?? {
    object_key: opts.evidence.object_key,
    object_kind: opts.evidence.object_kind,
  };

  const rules = bundle?.rules ?? Object.freeze({
    path_normalization: "posix_rel_no_dotdot" as const,
    follow_symlinks: false,
    redact_paths: false,
    normalize_line_endings: false,
    ordering: "deterministic_sort_v1" as const,
    merkle_rule: "dup_last_on_odd" as const,
  });

  const item_count = Number(bundle?.summary?.item_count ?? 0);
  const total_bytes = Number(bundle?.summary?.total_bytes ?? 0);

  const receipt_anchor = pickProjectedAnchor((opts.core as any)?.receipt_anchor);
  const root_anchor = pickProjectedAnchor((opts.core as any)?.root_anchor);

  const core =
    opts.core
      ? stripUndefined({
          ...(receipt_anchor ? { receipt_anchor } : {}),
          ...(root_anchor ? { root_anchor } : {}),
        })
      : undefined;

  const metadata =
    isPlainObject(opts.metadata) && Object.keys(opts.metadata).length > 0
      ? opts.metadata
      : undefined;

  const body = stripUndefined({
    v: "v1" as const,
    kind: "ingest_receipt" as const,
    mode: opts.mode,
    identity,
    rules,
    evidence: {
      fingerprint: opts.evidence.fingerprint,
      bundle_digest: opts.evidence.bundle_digest,
      ...(opts.evidence.merkle_root ? { merkle_root: opts.evidence.merkle_root } : {}),
      idempotency_key: opts.evidence.idempotency_key,
      item_count,
      total_bytes,
    },
    ...((opts.domain ?? opts.proof_date)
      ? {
          anchor: stripUndefined({
            domain: opts.domain ?? undefined,
            proof_date: opts.proof_date ?? undefined,
          }),
        }
      : {}),
    ...(opts.evidence_pointer ? { pointers: { evidence_pointer: opts.evidence_pointer } } : {}),
    ...(metadata ? { metadata } : {}),
    ...(core && Object.keys(core).length > 0 ? { core } : {}),
  });

  const receipt_id = hashJsonDigest({
    domain: "va:ingest:receipt:v1",
    value: body,
    alg: "sha3-512",
    encoding: "hex_lower",
  });

  return Object.freeze({
    ...body,
    receipt_id,
  }) as IngestReceiptV1;
}