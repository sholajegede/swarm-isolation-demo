"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { configuredOrgCodes, readOrg, setOrgSuspended } from "./lib/kindeManagement";

/**
 * The kill switch.
 *
 * Suspending a tenant is two things, and both are needed:
 *
 *   1. Kinde is updated, because it is the authority on the organization.
 *   2. The enforcement copy is updated, because that is what the seam reads on
 *      every call.
 *
 * Only the second one actually stops a running swarm. Kinde keeps issuing M2M
 * tokens for a suspended organization, and tokens already issued stay valid
 * until they expire, so identity alone will not end a run. Kinde is updated
 * first so that the authority and the enforcement copy never disagree in the
 * dangerous direction.
 */

export const suspend = internalAction({
  args: { orgCode: v.string() },
  handler: async (ctx, { orgCode }): Promise<{ orgCode: string; suspended: boolean }> => {
    await setOrgSuspended(orgCode, true);
    await ctx.runMutation(internal.tenants.setSuspended, {
      orgCode,
      isSuspended: true,
    });
    // The tenant can no longer close its own runs, so close them here.
    await ctx.runMutation(internal.runs.killInFlight, { orgCode });
    return { orgCode, suspended: true };
  },
});

export const unsuspend = internalAction({
  args: { orgCode: v.string() },
  handler: async (ctx, { orgCode }): Promise<{ orgCode: string; suspended: boolean }> => {
    // The enforcement copy is cleared only after Kinde has agreed, so a failed
    // call leaves the tenant stopped rather than half-released.
    await setOrgSuspended(orgCode, false);
    await ctx.runMutation(internal.tenants.setSuspended, {
      orgCode,
      isSuspended: false,
    });
    return { orgCode, suspended: false };
  },
});

/** Pull suspension state back from Kinde, for changes made in its dashboard. */
export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<Array<{ orgCode: string; isSuspended: boolean }>> => {
    const results: Array<{ orgCode: string; isSuspended: boolean }> = [];
    for (const orgCode of configuredOrgCodes()) {
      const status = await readOrg(orgCode);
      await ctx.runMutation(internal.tenants.setSuspended, {
        orgCode,
        isSuspended: status.isSuspended,
      });
      results.push({ orgCode, isSuspended: status.isSuspended });
    }
    return results;
  },
});
