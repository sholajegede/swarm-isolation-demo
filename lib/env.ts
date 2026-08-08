/**
 * Server-side environment resolution.
 *
 * Two rules hold everywhere in this codebase:
 *   1. The isolation mode is decided by the deployment, never by a caller.
 *   2. Anything unset or malformed resolves to the enforcing option, so a
 *      misconfigured deployment fails closed instead of open.
 */

export type IsolationMode = "shared" | "per-org";

export const ISOLATION_MODES: readonly IsolationMode[] = ["shared", "per-org"];

/**
 * "shared" has to be asked for explicitly. Every other value - unset, typo'd,
 * empty - lands on "per-org", the mode that enforces org scoping.
 */
export function resolveIsolationMode(
  raw: string | undefined = process.env.ISOLATION_MODE,
): IsolationMode {
  return raw?.trim().toLowerCase() === "shared" ? "shared" : "per-org";
}

/** Trims a value and treats the empty string as absent. */
function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Kinde issuer, normalised without a trailing slash so that JWKS and token
 * URLs can be built by simple concatenation.
 */
export function kindeIssuer(): string | undefined {
  return read("KINDE_ISSUER_URL")?.replace(/\/+$/, "");
}

export type ServerEnv = {
  isolationMode: IsolationMode;
  kindeIssuerUrl?: string;
  kindeAudience?: string;
  kindeMgmtClientId?: string;
  kindeMgmtClientSecret?: string;
  convexUrl?: string;
  kimiModel?: string;
  kimiBaseUrl?: string;
};

export function serverEnv(): ServerEnv {
  return {
    isolationMode: resolveIsolationMode(),
    kindeIssuerUrl: kindeIssuer(),
    kindeAudience: read("KINDE_AUDIENCE"),
    kindeMgmtClientId: read("KINDE_MGMT_CLIENT_ID"),
    kindeMgmtClientSecret: read("KINDE_MGMT_CLIENT_SECRET"),
    convexUrl: read("NEXT_PUBLIC_CONVEX_URL"),
    kimiModel: read("KIMI_MODEL"),
    kimiBaseUrl: read("KIMI_BASE_URL"),
  };
}

/**
 * Which subsystems have enough configuration to run. Booleans only - this is
 * safe to expose on a health endpoint, the underlying values are not.
 */
export function configStatus(env: ServerEnv = serverEnv()) {
  return {
    convex: Boolean(env.convexUrl),
    kindeAuth: Boolean(env.kindeIssuerUrl && env.kindeAudience),
    kindeManagement: Boolean(
      env.kindeIssuerUrl && env.kindeMgmtClientId && env.kindeMgmtClientSecret,
    ),
    kimi: Boolean(env.kimiModel && env.kimiBaseUrl),
  };
}
