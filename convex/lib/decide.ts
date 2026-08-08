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
} as const;

export type DecisionInput = {
  mode: IsolationMode;
  /** The tenant on the verified token. */
  actorOrgCode: string;
  /** Scopes on the verified token. */
  actorScopes: string[];
  /** The scope this action needs. */
  requiredScope: string;
  /**
   * The tenant that owns the record being reached for, or null when the call
   * targets no particular record (a listing of the caller's own data).
   */
  targetOrgCode: string | null;
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

  if (input.mode === "per-org") {
    if (crossOrg) {
      return { allow: false, reason: DENY.crossOrg, crossOrg };
    }
    if (!input.actorScopes.includes(input.requiredScope)) {
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
