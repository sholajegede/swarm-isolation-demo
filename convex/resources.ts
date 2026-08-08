import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { requireSameOrg } from "./lib/tenancy";

/**
 * Tenant data access.
 *
 * Everything here is `internal`. That is the point: a browser or a worker
 * cannot call these directly and hand in whichever `orgCode` it likes. The only
 * caller is the enforcement seam, which derives `actorOrgCode` from a verified
 * token before it gets here.
 *
 * So `actorOrgCode` is never user input. It is the output of token
 * verification, passed inward.
 */

/** List one tenant's resources. Scoped by index, so other tenants are not read at all. */
export const listForOrg = internalQuery({
  args: { actorOrgCode: v.string() },
  handler: async (ctx, { actorOrgCode }) =>
    ctx.db
      .query("resources")
      .withIndex("by_org", (q) => q.eq("orgCode", actorOrgCode))
      .collect(),
});

/**
 * Read one resource by id.
 *
 * This is the interesting one. A worker that has somehow learned another
 * tenant's document id - guessed it, saw it in a log, was told it by a
 * confused model - still cannot read the record, because ownership is checked
 * against the acting tenant after the load.
 */
export const readById = internalQuery({
  args: {
    actorOrgCode: v.string(),
    resourceId: v.id("resources"),
  },
  handler: async (ctx, { actorOrgCode, resourceId }) => {
    const doc = await ctx.db.get(resourceId);
    return requireSameOrg(actorOrgCode, doc);
  },
});

/** Read one resource by its tenant-local key. */
export const readByKey = internalQuery({
  args: {
    actorOrgCode: v.string(),
    key: v.string(),
  },
  handler: async (ctx, { actorOrgCode, key }) => {
    const doc = await ctx.db
      .query("resources")
      .withIndex("by_org_key", (q) =>
        q.eq("orgCode", actorOrgCode).eq("key", key),
      )
      .unique();
    return requireSameOrg(actorOrgCode, doc);
  },
});

/** Create a resource inside the acting tenant. The owner is never taken from input. */
export const create = internalMutation({
  args: {
    actorOrgCode: v.string(),
    key: v.string(),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { actorOrgCode, key, title, content }) =>
    ctx.db.insert("resources", {
      orgCode: actorOrgCode,
      key,
      title,
      content,
      createdAt: Date.now(),
    }),
});

/** Update a resource, but only one the acting tenant owns. */
export const update = internalMutation({
  args: {
    actorOrgCode: v.string(),
    resourceId: v.id("resources"),
    content: v.string(),
  },
  handler: async (ctx, { actorOrgCode, resourceId, content }) => {
    const doc = await ctx.db.get(resourceId);
    const owned = requireSameOrg(actorOrgCode, doc);
    await ctx.db.patch(owned._id, { content, updatedAt: Date.now() });
    return owned._id;
  },
});
