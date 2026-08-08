import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { TokenError, verifyAccessToken } from "./lib/kindeToken";
import { guard, type Target } from "./lib/seam";

/**
 * The tool endpoints a worker calls.
 *
 * Workers never reach the database. Each data tool below hands its call to
 * `guard`, which is the single place where a call is allowed or refused and
 * the only place that writes the audit trail.
 */

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Identity echo. Reaches no tenant data, so there is nothing to enforce and it
 * stays outside the seam. It still requires a verified token.
 */
const whoami = httpAction(async (_ctx, request) => {
  try {
    const identity = await verifyAccessToken(request.headers.get("authorization"));
    return json(
      {
        ok: true,
        orgCode: identity.orgCode,
        scopes: identity.scopes,
        clientId: identity.clientId,
        expiresAt: identity.expiresAt,
      },
      200,
    );
  } catch (error) {
    return json(
      { ok: false, reason: error instanceof TokenError ? error.reason : "verification_failed" },
      401,
    );
  }
});

/**
 * Find the record a call is reaching for.
 *
 * `targetOrgCode` lets a caller name a tenant other than its own. That is the
 * point: it is how a worker reaches across, and what the two modes disagree
 * about. Naming a tenant does not grant anything - the seam still decides.
 */
async function resolveResource(
  ctx: ActionCtx,
  identity: { orgCode: string },
  body: Record<string, unknown>,
): Promise<Target> {
  if (typeof body.resourceId === "string") {
    const doc = await ctx.runQuery(internal.resources.seamLoadById, {
      resourceId: body.resourceId as Id<"resources">,
    });
    return doc ? { kind: "record", doc } : { kind: "missing" };
  }

  if (typeof body.key === "string") {
    const orgCode =
      typeof body.targetOrgCode === "string" && body.targetOrgCode.trim()
        ? body.targetOrgCode.trim()
        : identity.orgCode;
    const doc = await ctx.runQuery(internal.resources.seamLoadByKey, {
      orgCode,
      key: body.key,
    });
    return doc ? { kind: "record", doc } : { kind: "missing", key: body.key };
  }

  throw new Error("no selector supplied");
}

const listResources = httpAction(async (ctx, request) =>
  guard(ctx, request, {
    action: "resource.list",
    requiredScope: "resource:read",
    // A listing only ever returns the caller's own rows, so it reaches across
    // no boundary and has no target.
    resolveTarget: async () => ({ kind: "none" }),
    perform: async (_target, _body, identity) => {
      const rows = await ctx.runQuery(internal.resources.listForOrg, {
        actorOrgCode: identity.orgCode,
      });
      return {
        resources: rows.map((r) => ({ id: r._id, key: r.key, title: r.title })),
      };
    },
  }),
);

const readResource = httpAction(async (ctx, request) =>
  guard(ctx, request, {
    action: "resource.read",
    requiredScope: "resource:read",
    resolveTarget: (identity, body) => resolveResource(ctx, identity, body),
    perform: async (target) => {
      const doc = (target as { doc: Doc<"resources"> }).doc;
      return {
        resource: {
          id: doc._id,
          key: doc.key,
          title: doc.title,
          content: doc.content,
          ownerOrgCode: doc.orgCode,
        },
      };
    },
  }),
);

const writeResource = httpAction(async (ctx, request) =>
  guard(ctx, request, {
    action: "resource.write",
    requiredScope: "resource:write",
    resolveTarget: (identity, body) => resolveResource(ctx, identity, body),
    perform: async (target, body) => {
      const doc = (target as { doc: Doc<"resources"> }).doc;
      const content = typeof body.content === "string" ? body.content : "";
      await ctx.runMutation(internal.resources.seamWrite, {
        resourceId: doc._id,
        content,
      });
      return { written: { id: doc._id, key: doc.key, ownerOrgCode: doc.orgCode } };
    },
  }),
);

const http = httpRouter();

http.route({ path: "/tools/whoami", method: "POST", handler: whoami });
http.route({ path: "/tools/resource.list", method: "POST", handler: listResources });
http.route({ path: "/tools/resource.read", method: "POST", handler: readResource });
http.route({ path: "/tools/resource.write", method: "POST", handler: writeResource });

export default http;
