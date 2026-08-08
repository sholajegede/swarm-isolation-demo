import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { isolationMode } from "./schema";

/**
 * The audit trail.
 *
 * Every decision the seam reaches is written here, allow and deny alike, with
 * the correlation id that ties it to the run that caused it. A row is written
 * before the caller is answered, so a refusal cannot be lost by a client that
 * hangs up.
 */

export const record = internalMutation({
  args: {
    correlationId: v.string(),
    decision: v.union(v.literal("allow"), v.literal("deny")),
    reason: v.string(),
    actorOrgCode: v.string(),
    targetOrgCode: v.optional(v.string()),
    action: v.string(),
    resourceKey: v.optional(v.string()),
    isolationMode,
    workerLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("auditLog", { ...args, at: Date.now() }),
});

export const byCorrelation = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) =>
    ctx.db
      .query("auditLog")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect(),
});
