import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { resolveMode, type IsolationMode } from "./lib/decide";

/**
 * What the operator console may see and do.
 *
 * These are the only public functions in the codebase. Two rules shape them:
 *
 *   1. They expose telemetry - runs, events, audit rows, tenant status - and
 *      never tenant records. The contents of a tenant's data stay behind the
 *      seam, so the console cannot become a second way to read it.
 *   2. The isolation mode and the kill switch are operator controls. A worker
 *      still cannot reach them: workers hold Kinde tokens and talk to the tool
 *      endpoints, and nothing here is reachable that way. A real deployment
 *      would put an operator login in front of these; this demo does not, and
 *      the console is meant to be run locally.
 */

export const tenants = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("tenants").collect();
    return rows
      .map((t) => ({
        orgCode: t.orgCode,
        name: t.name,
        isSuspended: t.isSuspended,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const isolationMode = query({
  args: {},
  handler: async (ctx): Promise<IsolationMode> => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "isolationMode"))
      .unique();
    return resolveMode(row?.value ?? process.env.ISOLATION_MODE);
  },
});

/** Operator control. Never reachable from a worker's token. */
export const setIsolationMode = mutation({
  args: { mode: v.union(v.literal("shared"), v.literal("per-org")) },
  handler: async (ctx, { mode }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "isolationMode"))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { value: mode, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key: "isolationMode",
        value: mode,
        updatedAt: Date.now(),
      });
    }
    return mode;
  },
});

/** The state of one run, so the console can say whether it is still going. */
export const runStatus = query({
  args: { correlationId: v.optional(v.string()) },
  handler: async (ctx, { correlationId }) => {
    if (!correlationId) return null;
    const run = await ctx.db
      .query("runs")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .unique();
    return run ? { status: run.status, goal: run.goal } : null;
  },
});

/** The live timeline. Convex pushes this to the browser as it is written. */
export const runEvents = query({
  args: { correlationId: v.optional(v.string()) },
  handler: async (ctx, { correlationId }) => {
    if (!correlationId) return [];
    return ctx.db
      .query("runEvents")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
  },
});

export const auditForRun = query({
  args: { correlationId: v.optional(v.string()) },
  handler: async (ctx, { correlationId }) => {
    if (!correlationId) return [];
    return ctx.db
      .query("auditLog")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
  },
});

/**
 * The four numbers that say what happened.
 *
 * `escapes` is the one that matters: a call that crossed a tenant boundary and
 * was allowed through. In per-org mode it should always be zero.
 */
export const metrics = query({
  args: { correlationId: v.optional(v.string()) },
  handler: async (ctx, { correlationId }) => {
    const empty = {
      workers: 0,
      toolCalls: 0,
      crossOrgAttempts: 0,
      blocked: 0,
      escapes: 0,
      stopped: 0,
    };
    if (!correlationId) return empty;

    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();

    const workers = new Set<string>();
    let toolCalls = 0;
    let crossOrgAttempts = 0;
    let blocked = 0;
    let escapes = 0;
    let stopped = 0;

    for (const row of rows) {
      if (row.workerLabel && row.workerLabel !== "orchestrator") {
        workers.add(row.workerLabel);
      }
      if (row.action.startsWith("resource.")) {
        toolCalls += 1;
      }
      if (row.targetOrgCode && row.targetOrgCode !== row.actorOrgCode) {
        crossOrgAttempts += 1;
      }
      if (row.decision === "deny") {
        blocked += 1;
      }
      if (row.decision === "allow" && row.reason === "cross_org_allowed") {
        escapes += 1;
      }
      if (row.reason === "organization_suspended") {
        stopped += 1;
      }
    }

    return {
      workers: workers.size,
      toolCalls,
      crossOrgAttempts,
      blocked,
      escapes,
      stopped,
    };
  },
});

/** Recent decisions across every tenant, for the audit panel. */
export const recentAudit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    ctx.db.query("auditLog").order("desc").take(limit ?? 25),
});

export const suspendTenant = action({
  args: { orgCode: v.string() },
  handler: async (ctx, { orgCode }): Promise<{ orgCode: string; suspended: boolean }> =>
    ctx.runAction(internal.killSwitch.suspend, { orgCode }),
});

export const unsuspendTenant = action({
  args: { orgCode: v.string() },
  handler: async (ctx, { orgCode }): Promise<{ orgCode: string; suspended: boolean }> =>
    ctx.runAction(internal.killSwitch.unsuspend, { orgCode }),
});

export const reseed = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    await ctx.runMutation(internal.seed.seedDemo, {});
    return { ok: true };
  },
});
