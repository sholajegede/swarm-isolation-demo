import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

export type Tenant = "A" | "B" | "C";
export type Role = "READER" | "WRITER";

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set in .env.local`);
  }
  return value;
}

export const orgCodeFor = (tenant: Tenant) => required(`KINDE_ORG_TENANT_${tenant}`);

/** Where the Convex HTTP actions are served. */
export const toolsBaseUrl = () =>
  (process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim() ?? "http://127.0.0.1:3211").replace(
    /\/+$/,
    "",
  );

/**
 * Exchange one worker's M2M credentials for an access token.
 *
 * This is the same client-credentials call a worker makes before it touches a
 * tool endpoint. Tokens are cached for the life of the process so a run does
 * not mint one per call.
 */
const tokenCache = new Map<string, string>();

export async function workerToken(tenant: Tenant, role: Role): Promise<string> {
  const cacheKey = `${tenant}:${role}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: required(`KINDE_M2M_TENANT_${tenant}_${role}_CLIENT_ID`),
    client_secret: required(`KINDE_M2M_TENANT_${tenant}_${role}_CLIENT_SECRET`),
    audience: required("KINDE_AUDIENCE"),
  });

  const response = await fetch(required("KINDE_M2M_TOKEN_URL"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `token request failed for tenant ${tenant} ${role}: HTTP ${response.status}`,
    );
  }

  const { access_token: accessToken } = (await response.json()) as {
    access_token?: string;
  };
  if (!accessToken) {
    throw new Error(`no access_token returned for tenant ${tenant} ${role}`);
  }

  tokenCache.set(cacheKey, accessToken);
  return accessToken;
}

export type ToolResponse = {
  status: number;
  body: Record<string, unknown>;
};

/** Call a tool endpoint the way a worker does: bearer token, JSON body. */
export async function callTool(
  path: string,
  token: string | null,
  body: Record<string, unknown> = {},
  trace: { correlationId?: string; workerLabel?: string } = {},
): Promise<ToolResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  // Tracing labels only. The seam never lets these influence a decision.
  if (trace.correlationId) headers["x-correlation-id"] = trace.correlationId;
  if (trace.workerLabel) headers["x-worker-label"] = trace.workerLabel;

  const response = await fetch(`${toolsBaseUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  return { status: response.status, body: parsed };
}
