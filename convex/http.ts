import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { TokenError, verifyAccessToken } from "./lib/kindeToken";
import { denyReasonOf } from "./lib/tenancy";

/**
 * The tool endpoints a worker calls.
 *
 * Workers never reach the database. They come through here, and the acting
 * tenant is taken from the verified token rather than from anything they sent.
 *
 * Phase 2 establishes verification and tenant resolution. The isolation modes,
 * the scope check and the audit trail land on top of this in phase 3.
 */

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Anything that is not an allow ends up here, so there is one refusal path. */
function refuse(reason: string, status: number) {
  return json({ ok: false, reason }, status);
}

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
    if (error instanceof TokenError) {
      return refuse(error.reason, 401);
    }
    // An unexpected failure is still a refusal. Never fall through to allow.
    return refuse("verification_failed", 401);
  }
});

const listResources = httpAction(async (ctx, request) => {
  let identity;
  try {
    identity = await verifyAccessToken(request.headers.get("authorization"));
  } catch (error) {
    return refuse(error instanceof TokenError ? error.reason : "verification_failed", 401);
  }

  const rows = await ctx.runQuery(internal.resources.listForOrg, {
    actorOrgCode: identity.orgCode,
  });

  return json(
    {
      ok: true,
      actorOrgCode: identity.orgCode,
      resources: rows.map((r) => ({ id: r._id, key: r.key, title: r.title })),
    },
    200,
  );
});

const readResource = httpAction(async (ctx, request) => {
  let identity;
  try {
    identity = await verifyAccessToken(request.headers.get("authorization"));
  } catch (error) {
    return refuse(error instanceof TokenError ? error.reason : "verification_failed", 401);
  }

  let body: { key?: string; resourceId?: string };
  try {
    body = await request.json();
  } catch {
    return refuse("malformed_body", 400);
  }

  try {
    // The acting tenant is the one on the token. The body only chooses which
    // record is being asked for, never who is asking.
    const doc = body.resourceId
      ? await ctx.runQuery(internal.resources.readById, {
          actorOrgCode: identity.orgCode,
          resourceId: body.resourceId as never,
        })
      : body.key
        ? await ctx.runQuery(internal.resources.readByKey, {
            actorOrgCode: identity.orgCode,
            key: body.key,
          })
        : null;

    if (doc === null) {
      return refuse("missing_selector", 400);
    }

    return json(
      {
        ok: true,
        actorOrgCode: identity.orgCode,
        resource: { key: doc.key, title: doc.title, content: doc.content },
      },
      200,
    );
  } catch (error) {
    const reason = denyReasonOf(error);
    if (reason) {
      return refuse(reason, 403);
    }
    // Includes a malformed document id, which Convex rejects at the validator.
    return refuse("bad_request", 400);
  }
});

const http = httpRouter();

http.route({ path: "/tools/whoami", method: "POST", handler: whoami });
http.route({ path: "/tools/resource.list", method: "POST", handler: listResources });
http.route({ path: "/tools/resource.read", method: "POST", handler: readResource });

export default http;
