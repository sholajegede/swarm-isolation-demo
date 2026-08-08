import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { resolveMode, type IsolationMode } from "./lib/decide";

/**
 * The isolation mode.
 *
 * Server-decided in the sense that matters: it is read from server-held state
 * and the deployment environment, never from a request. Both functions here
 * are internal, so a worker cannot reach them at all, and the browser can only
 * change the mode through a deliberate operator endpoint.
 */

const KEY = "isolationMode";

export const isolationMode = internalQuery({
  args: {},
  handler: async (ctx): Promise<IsolationMode> => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();

    // An operator setting wins, then the deployment environment. Anything
    // missing or unrecognised lands on per-org, which enforces.
    return resolveMode(row?.value ?? process.env.ISOLATION_MODE);
  },
});

export const setIsolationMode = internalMutation({
  args: { mode: v.union(v.literal("shared"), v.literal("per-org")) },
  handler: async (ctx, { mode }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();

    if (row) {
      await ctx.db.patch(row._id, { value: mode, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key: KEY,
        value: mode,
        updatedAt: Date.now(),
      });
    }
    return mode;
  },
});
