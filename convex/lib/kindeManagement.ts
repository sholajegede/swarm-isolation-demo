/**
 * The Kinde Management API, used for the kill switch.
 *
 * Kinde is the authority on whether an organization is suspended. This module
 * reads and writes that state. The enforcement copy lives in the `tenants`
 * table so the seam can consult it without a network call on every request.
 *
 * Note what suspension does and does not do. It stops people signing in. It
 * does NOT stop an M2M application from obtaining a token - client credentials
 * keep working, and tokens already issued stay cryptographically valid until
 * they expire. So suspension alone stops nothing here; it is the seam checking
 * this state on every call that actually ends a run.
 */

type ManagementToken = { token: string; expiresAt: number };

let cached: ManagementToken | null = null;

function issuer(): string {
  const value = process.env.KINDE_ISSUER_URL?.trim().replace(/\/+$/, "");
  if (!value) throw new Error("KINDE_ISSUER_URL is not set");
  return value;
}

/**
 * The org codes this deployment is allowed to touch.
 *
 * A Kinde account can hold organizations that have nothing to do with this
 * demo. The kill switch refuses to act on anything outside the three tenants
 * it was configured with, so a wrong code cannot suspend somebody else's
 * organization.
 */
export function configuredOrgCodes(): string[] {
  return ["A", "B", "C"]
    .map((t) => process.env[`KINDE_ORG_TENANT_${t}`]?.trim())
    .filter((code): code is string => Boolean(code));
}

export function assertManageable(orgCode: string): void {
  if (!configuredOrgCodes().includes(orgCode)) {
    throw new Error(
      `refusing to manage ${orgCode}: not one of this deployment's tenants`,
    );
  }
}

async function managementToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.token;
  }

  const clientId = process.env.KINDE_MGMT_CLIENT_ID?.trim();
  const clientSecret = process.env.KINDE_MGMT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Kinde management credentials are not configured");
  }

  const response = await fetch(`${issuer()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: `${issuer()}/api`,
    }),
  });

  if (!response.ok) {
    throw new Error(`management token request failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new Error("management token response carried no access_token");
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

export type OrgStatus = {
  orgCode: string;
  name: string;
  isSuspended: boolean;
  suspendedOn: string | null;
};

export async function readOrg(orgCode: string): Promise<OrgStatus> {
  assertManageable(orgCode);
  const token = await managementToken();

  const response = await fetch(
    `${issuer()}/api/v1/organization?code=${encodeURIComponent(orgCode)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`could not read ${orgCode}: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    code?: string;
    name?: string;
    is_suspended?: boolean;
    suspended_on?: string | null;
  };

  return {
    orgCode: body.code ?? orgCode,
    name: body.name ?? orgCode,
    isSuspended: Boolean(body.is_suspended),
    suspendedOn: body.suspended_on ?? null,
  };
}

export async function setOrgSuspended(
  orgCode: string,
  isSuspended: boolean,
): Promise<void> {
  assertManageable(orgCode);
  const token = await managementToken();

  const response = await fetch(
    `${issuer()}/api/v1/organization/${encodeURIComponent(orgCode)}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ is_suspended: isSuspended }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `could not update ${orgCode}: HTTP ${response.status} ${await response.text()}`,
    );
  }
}
