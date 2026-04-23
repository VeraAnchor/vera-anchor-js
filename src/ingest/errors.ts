// ============================================================================
// File: src/ingest/errors.ts
// Version: 1.0-hf-ingest-errors-v1 | 2026-03-06
// Purpose:
//   Structured errors for local-first ingest workflows.
// Notes:
//   - Suitable for UI, route, and orchestrator boundaries.
//   - Keep codes stable for downstream handling.
// ============================================================================

type ErrorOpts = Readonly<{
  code?: string;
  statusCode?: number;
  cause?: unknown;
}>;

export class IngestError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, opts?: ErrorOpts) {
    super(message);
    this.name = "IngestError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = opts?.code ?? "INGEST_ERROR";
    this.statusCode = opts?.statusCode ?? 400;
    if (opts?.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, IngestError);
    }
  }
}

export class IngestValidationError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, opts?: ErrorOpts) {
    super(message);
    this.name = "IngestValidationError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = opts?.code ?? "INGEST_VALIDATION_FAILED";
    this.statusCode = opts?.statusCode ?? 400;
    if (opts?.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, IngestValidationError);
    }
  }
}