import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * `orgCode` is the tenancy key on every tenant-owned table. It holds the Kinde
 * organization code, which arrives as the `org_code` claim on a verified M2M
 * token. Every read and write of tenant data is scoped by it.
 *
 * Nothing here trusts a caller-supplied tenant. From phase 2 onward the value
 * is taken off a verified token, never off the request body.
 */

export const isolationMode = v.union(v.literal("shared"), v.literal("per-org"));

export const workerRole = v.union(
  v.literal("orchestrator"),
  v.literal("reader"),
  v.literal("writer"),
);

export default defineSchema({
  /**
   * Server-held settings. The isolation mode lives here so an operator can
   * change it at runtime, seeded from the deployment environment.
   *
   * This is still server-decided: the row is written by an internal mutation
   * only. No worker and no browser can set it, and no request body is ever
   * consulted for it.
   */
  settings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** One row per tenant. Mirrors a Kinde organization. */
  tenants: defineTable({
    orgCode: v.string(),
    name: v.string(),
    /** Mirrors the Kinde organization state. The kill switch flips this. */
    isSuspended: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["orgCode"]),

  /**
   * One row per agent identity. `kindeClientId` is the public client id of the
   * org-scoped M2M app. The matching secret is never stored here, or anywhere
   * else in the database.
   */
  workers: defineTable({
    orgCode: v.string(),
    role: workerRole,
    label: v.string(),
    kindeClientId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgCode"]),

  /** The tenant data worth protecting. */
  resources: defineTable({
    orgCode: v.string(),
    key: v.string(),
    title: v.string(),
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgCode"])
    .index("by_org_key", ["orgCode", "key"]),

  /** One swarm run. `correlationId` ties every event and audit row together. */
  runs: defineTable({
    correlationId: v.string(),
    orgCode: v.string(),
    /** The mode the server was in when the run started. */
    isolationMode,
    goal: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("killed"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_correlation", ["correlationId"])
    .index("by_org", ["orgCode"]),

  /** Each step a worker takes, streamed to the browser as it happens. */
  runEvents: defineTable({
    runId: v.id("runs"),
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
    at: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_correlation", ["correlationId"]),

  /**
   * Every allow and every deny, without exception. `actorOrgCode` is the tenant
   * that made the call; `targetOrgCode` is the tenant that owns the data it
   * reached for. When those differ on an allow, that row is a recorded breach.
   */
  auditLog: defineTable({
    correlationId: v.string(),
    at: v.number(),
    decision: v.union(v.literal("allow"), v.literal("deny")),
    reason: v.string(),
    actorOrgCode: v.string(),
    targetOrgCode: v.optional(v.string()),
    action: v.string(),
    resourceKey: v.optional(v.string()),
    isolationMode,
    workerLabel: v.optional(v.string()),
  })
    .index("by_correlation", ["correlationId"])
    .index("by_actor_org", ["actorOrgCode"]),
});
