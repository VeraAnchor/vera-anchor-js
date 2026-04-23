export type HfLocalAuth = Readonly<{
  apiKey: string;
}>;

export function buildBearerAuthHeader(auth: HfLocalAuth): string {
  const apiKey = String(auth?.apiKey ?? "").trim().replace(/^bearer\s+/i, "");
  if (!apiKey) {
    throw new Error("buildBearerAuthHeader_missing_api_key");
  }
  if (apiKey.length > 1024) {
    throw new Error("buildBearerAuthHeader_api_key_too_long");
  }
  return `Bearer ${apiKey}`;
}