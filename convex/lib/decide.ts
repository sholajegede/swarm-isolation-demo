/**
 * The decision itself, as a pure function.
 *
 * Everything the seam does around this - verifying the token, loading the
 * record, writing the audit row - is plumbing. This is the rule, and it is
 * kept separate so it can be tested exhaustively without a network, a
 * database, or a token.
 */

export type IsolationMode = "shared" | "per-org";

export const ALLOW = {
  ok: "ok",
  /**
   * The call reached across a tenant boundary and the mode in force let it
   * through. This is the hole, recorded as it happens.
   */
  crossOrgAllowed: "cross_org_allowed",
} as const;

export const DENY = {
  crossOrg: "cross_org",
  insufficientScope: "insufficient_scope",
  notFound: "not_found",
  suspended: "organization_suspended",
} as const;

export type DecisionInput = {
  mode: IsolationMode;
  /** The tenant on the verified token. */
  actorOrgCode: string;
  /** Scopes on the verified token. */
  actorScopes: string[];
  /**
   * The scope this action needs, or null when any verified token will do.
   * Null is for calls that only touch the caller's own run log, which every
   * role must be able to write whatever its data permissions are. It relaxes
   * the permission check only - the tenant check still applies.
   */
  requiredScope: string | null;
  /**
   * The tenant that owns the record being reached for, or null when the call
   * targets no particular record (a listing of the caller's own data).
   */
  targetOrgCode: string | null;
  /**
   * Whether the acting tenant's organization is suspended.
   *
   * Kinde keeps issuing M2M tokens for a suspended organization - suspension
   * governs people signing in, not application credentials - so a token alone
   * proves nothing about whether the tenant is still allowed to operate. The
   * check has to happen here, on every call.
   */
  actorSuspended: boolean;
};

export type Decision = {
  allow: boolean;
  reason: string;
  /** True when actor and target are different tenants, whatever the outcome. */
  crossOrg: boolean;
};

/**
 * Order matters and follows the boundary outwards: which tenant, then which
 * permission. A cross-tenant call with the wrong scope reports `cross_org`,
 * because the tenant boundary is the more serious of the two.
 */
export function decide(input: DecisionInput): Decision {
  const crossOrg =
    input.targetOrgCode !== null && input.targetOrgCode !== input.actorOrgCode;

  // Checked before the mode is consulted, and so applies in both. A kill
  // switch that only worked in the enforcing mode would be no kill switch at
  // all - the leaky mode is exactly when you most need to stop a swarm.
  if (input.actorSuspended) {
    return { allow: false, reason: DENY.suspended, crossOrg };
  }

  if (input.mode === "per-org") {
    if (crossOrg) {
      return { allow: false, reason: DENY.crossOrg, crossOrg };
    }
    if (
      input.requiredScope !== null &&
      !input.actorScopes.includes(input.requiredScope)
    ) {
      return { allow: false, reason: DENY.insufficientScope, crossOrg };
    }
    return { allow: true, reason: ALLOW.ok, crossOrg };
  }

  // Shared mode models the common shortcut: one credential for the whole
  // swarm. Such a credential belongs to no tenant and carries every
  // permission, so neither check has anything to bite on. The call goes
  // through, and the audit row is the only thing that remembers it did.
  return {
    allow: true,
    reason: crossOrg ? ALLOW.crossOrgAllowed : ALLOW.ok,
    crossOrg,
  };
}

/**
 * The mode a deployment runs in. Decided by the server: an operator-set value,
 * otherwise the deployment environment, otherwise the enforcing mode. A value
 * that is not exactly "shared" is never treated as shared.
 */
export function resolveMode(raw: string | null | undefined): IsolationMode {
  return raw?.trim().toLowerCase() === "shared" ? "shared" : "per-org";
}
