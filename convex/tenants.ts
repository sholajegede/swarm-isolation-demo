import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

/**
 * The enforcement copy of each tenant's suspension state.
 *
 * Kinde is the authority. This table is what the seam reads, so a decision
 * costs no network call. The kill switch writes Kinde first and mirrors here,
 * and `killSwitch.sync` pulls the truth back if somebody changes it in the
 * Kinde dashboard instead.
 */

export const isSuspended = internalQuery({
  args: { orgCode: v.string() },
  handler: async (ctx, { orgCode }) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_org", (q) => q.eq("orgCode", orgCode))
      .unique();

    // An unknown tenant is treated as suspended. A verified token for an
    // organization this deployment has never heard of gets nothing.
    return tenant ? tenant.isSuspended : true;
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("tenants").collect(),
});

export const setSuspended = internalMutation({
  args: { orgCode: v.string(), isSuspended: v.boolean() },
  handler: async (ctx, { orgCode, isSuspended: suspended }) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_org", (q) => q.eq("orgCode", orgCode))
      .unique();
    if (!tenant) return null;
    await ctx.db.patch(tenant._id, { isSuspended: suspended });
    return tenant._id;
  },
});
