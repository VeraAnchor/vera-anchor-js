// src/datasets/errors.ts
// Version: 1.0-hf-datasets-errors-v1 | 2026-03-05
// Purpose:
//   Structured errors for dataset anchoring suitable for UI + API boundaries.

export class DatasetError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, opts?: { code?: string; statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = "DatasetError";
    this.code = opts?.code ?? "DATASET_ERROR";
    this.statusCode = opts?.statusCode ?? 400;
    if (opts?.cause) (this as any).cause = opts.cause;
  }
}