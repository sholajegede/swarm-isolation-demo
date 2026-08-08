import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { isolationMode } from "./schema";

/**
 * Runs and the events inside them.
 *
 * A run belongs to one tenant and is written only through the seam, so a
 * worker can never append to another tenant's timeline. The correlation id on
 * the run is the same id that appears on every audit row it produces.
 */

export const start = internalMutation({
  args: {
    correlationId: v.string(),
    orgCode: v.string(),
    isolationMode,
    goal: v.string(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("runs", {
      ...args,
      status: "running",
      startedAt: Date.now(),
    }),
});

export const appendEvent = internalMutation({
  args: {
    correlationId: v.string(),
    orgCode: v.string(),
    workerLabel: v.string(),
    kind: v.union(
      v.literal("worker_started"),
      v.literal("tool_call"),
      v.literal("allowed"),
      v.literal("denied"),
      v.literal("worker_finished"),
      v.literal("note"),
    ),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_correlation", (q) => q.eq("correlationId", args.correlationId))
      .unique();

    // An event with no run, or a run belonging to another tenant, is dropped.
    // The seam has already matched the tenant; this is the second lock.
    if (!run || run.orgCode !== args.orgCode) {
      return null;
    }

    return ctx.db.insert("runEvents", {
      runId: run._id,
      correlationId: args.correlationId,
      orgCode: args.orgCode,
      workerLabel: args.workerLabel,
      kind: args.kind,
      message: args.message,
      at: Date.now(),
    });
  },
});

export const finish = internalMutation({
  args: {
    correlationId: v.string(),
    orgCode: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("killed"),
    ),
  },
  handler: async (ctx, { correlationId, orgCode, status }) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .unique();
    if (!run || run.orgCode !== orgCode) {
      return null;
    }
    await ctx.db.patch(run._id, { status, completedAt: Date.now() });
    return run._id;
  },
});

export const recent = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    ctx.db.query("runs").order("desc").take(limit ?? 5),
});

export const byCorrelation = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .unique();
    if (!run) return null;
    const events = await ctx.db
      .query("runEvents")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    return { run, events };
  },
});
