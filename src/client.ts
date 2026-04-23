import { buildBearerAuthHeader, type HfLocalAuth } from "./auth.js";

export type HfLocalClientConfig = Readonly<{
  baseUrl: string;
  auth: HfLocalAuth;
  defaultHeaders?: Readonly<Record<string, string>>;
}>;

export class HfLocalClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;

  constructor(
    message: string,
    opts?: { statusCode?: number; code?: string; detail?: unknown }
  ) {
    super(message);
    this.name = "HfLocalClientError";
    this.statusCode = opts?.statusCode ?? 500;
    this.code = opts?.code ?? "HF_LOCAL_CLIENT_ERROR";
    this.detail = opts?.detail;
  }
}

function normalizeBaseUrl(baseUrl: unknown): string {
  const s = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!s) throw new Error("normalizeBaseUrl_missing_base_url");
  if (!/^https?:\/\//i.test(s)) {
    throw new Error("normalizeBaseUrl_invalid_base_url");
  }
  return s;
}

export function buildJsonHeaders(config: HfLocalClientConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    "authorization": buildBearerAuthHeader(config.auth),
    ...(config.defaultHeaders ? { ...config.defaultHeaders } : {}),
  };
}

export async function postJson<TResponse>(
  config: HfLocalClientConfig,
  path: string,
  body: unknown,
  opts?: { idempotencyKey?: string }
): Promise<TResponse> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const route = String(path ?? "").trim();
  if (!route.startsWith("/")) {
    throw new Error("postJson_invalid_path");
  }

  const headers: Record<string, string> = {
    ...buildJsonHeaders(config),
  };

  if (opts?.idempotencyKey) {
    headers["idempotency-key"] = String(opts.idempotencyKey).trim();
  }

  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let parsed: any = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HfLocalClientError("hf_response_not_json", {
        statusCode: res.status,
        code: "HF_RESPONSE_NOT_JSON",
        detail: { body: text.slice(0, 1000) },
      });
    }
  }

  if (!res.ok || parsed?.ok === false) {
    throw new HfLocalClientError(
      parsed?.message || `hf_request_failed_${res.status}`,
      {
        statusCode: res.status,
        code: parsed?.error || "HF_REQUEST_FAILED",
        detail: parsed?.detail ?? parsed ?? null,
      }
    );
  }

  return (parsed?.result ?? parsed) as TResponse;
}