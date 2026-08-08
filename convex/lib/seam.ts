import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { decide, DENY, type IsolationMode } from "./decide";
import { TokenError, verifyAccessToken, type VerifiedIdentity } from "./kindeToken";

/**
 * The enforcement seam.
 *
 * Every worker tool call passes through `guard`. It is the only place that
 * decides whether a call proceeds, and the only place that writes the audit
 * trail. Nothing downstream re-checks, and nothing upstream can skip it.
 *
 * The order is fixed: verify the token, resolve the mode from server state,
 * find out who owns the record, decide, record, answer. Every exit that is not
 * an allow goes through `refuse`, so there is no path that returns data
 * without a decision having been made and written down.
 */

/** What the call is reaching for. */
export type Target =
  /** A listing of the caller's own data. No particular record. */
  | { kind: "none" }
  /** The record named does not exist. */
  | { kind: "missing"; key?: string }
  /** A real record, and the tenant that owns it. */
  | { kind: "record"; doc: Doc<"resources"> };

export type ToolSpec = {
  /** Recorded in the audit row, e.g. "resource.read". */
  action: string;
  /** The scope this action needs, or null when any verified token will do. */
  requiredScope: string | null;
  /** Work out which record is being reached for. Runs after the token is verified. */
  resolveTarget: (
    identity: VerifiedIdentity,
    body: Record<string, unknown>,
  ) => Promise<Target>;
  /** Runs only after an allow. */
  perform: (
    target: Target,
    body: Record<string, unknown>,
    identity: VerifiedIdentity,
    mode: IsolationMode,
  ) => Promise<unknown>;
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function guard(
  ctx: ActionCtx,
  request: Request,
  spec: ToolSpec,
): Promise<Response> {
  // A caller may supply the correlation id so one run ties together across
  // many workers. It is a label for tracing, never an input to the decision.
  const correlationId =
    request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID();
  const workerLabel = request.headers.get("x-worker-label")?.trim() || undefined;

  const write = (args: {
    decision: "allow" | "deny";
    reason: string;
    actorOrgCode: string;
    targetOrgCode?: string;
    resourceKey?: string;
    mode: IsolationMode;
  }) =>
    ctx.runMutation(internal.audit.record, {
      correlationId,
      decision: args.decision,
      reason: args.reason,
      actorOrgCode: args.actorOrgCode,
      targetOrgCode: args.targetOrgCode,
      action: spec.action,
      resourceKey: args.resourceKey,
      isolationMode: args.mode,
      workerLabel,
    });

  // The mode is read before anything else can fail, so that even a refused
  // token is recorded against the mode the deployment was actually in.
  const mode: IsolationMode = await ctx.runQuery(internal.settings.isolationMode, {});

  const refuse = async (
    reason: string,
    status: number,
    actorOrgCode: string,
    extra: { targetOrgCode?: string; resourceKey?: string } = {},
  ) => {
    await write({ decision: "deny", reason, actorOrgCode, mode, ...extra });
    return json({ ok: false, reason, correlationId, isolationMode: mode }, status);
  };

  // 1. Who is calling. Nothing below this line trusts the request body for it.
  let identity: VerifiedIdentity;
  try {
    identity = await verifyAccessToken(request.headers.get("authorization"));
  } catch (error) {
    const reason = error instanceof TokenError ? error.reason : "verification_failed";
    // There is no verified tenant to attribute this to, and inventing one
    // would put a fiction in the audit trail.
    return refuse(reason, 401, "unknown");
  }

  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  // 2. What is being reached for, and who owns it.
  let target: Target;
  try {
    target = await spec.resolveTarget(identity, body);
  } catch {
    return refuse("bad_request", 400, identity.orgCode);
  }

  if (target.kind === "missing") {
    return refuse(DENY.notFound, 403, identity.orgCode, { resourceKey: target.key });
  }

  const targetOrgCode = target.kind === "record" ? target.doc.orgCode : null;
  const resourceKey = target.kind === "record" ? target.doc.key : undefined;

  // 3. The decision.
  const decision = decide({
    mode,
    actorOrgCode: identity.orgCode,
    actorScopes: identity.scopes,
    requiredScope: spec.requiredScope,
    targetOrgCode,
  });

  // 4. Written down before the caller is answered, allow or deny.
  await write({
    decision: decision.allow ? "allow" : "deny",
    reason: decision.reason,
    actorOrgCode: identity.orgCode,
    targetOrgCode: targetOrgCode ?? undefined,
    resourceKey,
    mode,
  });

  if (!decision.allow) {
    return json(
      { ok: false, reason: decision.reason, correlationId, isolationMode: mode },
      403,
    );
  }

  // 5. Only now does the work happen.
  const data = await spec.perform(target, body, identity, mode);

  return json(
    {
      ok: true,
      correlationId,
      isolationMode: mode,
      actorOrgCode: identity.orgCode,
      targetOrgCode: targetOrgCode ?? undefined,
      // True when this call just crossed a tenant boundary and was let through.
      crossOrg: decision.crossOrg,
      ...(data as object),
    },
    200,
  );
}
