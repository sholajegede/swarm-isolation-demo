import { ConvexError } from "convex/values";

/**
 * The tenancy boundary.
 *
 * Every read or write of tenant data goes through this module. Keeping it in
 * one small file is deliberate: there is exactly one door to guard, so it can
 * be reviewed in full and tested directly.
 */

export const DENY = {
  /** The caller reached for data owned by a different tenant. */
  crossOrg: "cross_org",
  /** No such record. */
  notFound: "not_found",
  /** The tenant's Kinde organization is suspended. */
  suspended: "organization_suspended",
  /** The token did not carry the permission this action needs. */
  insufficientScope: "insufficient_scope",
} as const;

export type DenyReason = (typeof DENY)[keyof typeof DENY];

/**
 * Refuse the call. Throws a ConvexError carrying a stable machine-readable
 * reason so callers and tests can assert on it.
 *
 * The payload stays deliberately thin. The tenant that owns the record is not
 * disclosed to the caller - that detail belongs in the audit log, which is
 * written server-side and never returned to a worker.
 */
export function deny(reason: DenyReason): never {
  throw new ConvexError({ reason });
}

/** Anything owned by a tenant carries the tenancy key. */
export type TenantOwned = { orgCode: string };

/**
 * Return the document only if the acting tenant owns it.
 *
 * This is the check that makes a stolen or guessed document id useless: holding
 * the id of another tenant's record is not enough, because ownership is
 * re-checked against the acting tenant on every access.
 *
 * A missing record and a record owned by another tenant are reported
 * separately. That is a considered choice for this demo, where showing the
 * boundary being hit is the point. A system that had to resist probing for
 * which ids exist would collapse both cases into one reason.
 */
export function requireSameOrg<T extends TenantOwned>(
  actorOrgCode: string,
  doc: T | null | undefined,
): T {
  if (!doc) {
    deny(DENY.notFound);
  }
  if (doc.orgCode !== actorOrgCode) {
    deny(DENY.crossOrg);
  }
  return doc;
}

/**
 * True when the acting tenant differs from the tenant that owns the record.
 * Used for audit and metrics, where the attempt itself is worth recording even
 * when the mode in force allowed it through.
 */
export function isCrossOrg(
  actorOrgCode: string,
  doc: TenantOwned | null | undefined,
): boolean {
  return Boolean(doc) && doc!.orgCode !== actorOrgCode;
}

/** Narrow an unknown thrown value to a deny reason, if it is one. */
export function denyReasonOf(error: unknown): DenyReason | undefined {
  if (error instanceof ConvexError) {
    const data = error.data as { reason?: string } | undefined;
    const reason = data?.reason;
    if (
      reason &&
      (Object.values(DENY) as string[]).includes(reason)
    ) {
      return reason as DenyReason;
    }
  }
  return undefined;
}
