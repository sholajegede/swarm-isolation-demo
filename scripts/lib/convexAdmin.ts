import { execFileSync } from "node:child_process";

/**
 * Run an internal Convex function as an operator, through the CLI.
 *
 * This is the operator path, not the worker path. Workers reach the deployment
 * over HTTP with a Kinde token and can only touch the tool endpoints. Changing
 * the isolation mode or reading the audit trail happens here instead, with
 * deployment credentials, which is what keeps the mode server-decided.
 */
export function convexRun<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
  attempts = 3,
): T {
  let raw = "";
  let lastError: unknown;

  // The CLI reaches the deployment over the network. A dropped connection
  // failed a whole run, so retry the call itself. Convex functions here are
  // safe to repeat: they set a value or read one, and none of them add a row.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      raw = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        // execFileSync is synchronous, so wait the same way.
        execFileSync("sleep", [String(0.5 * (attempt + 1))]);
      }
    }
  }

  if (lastError) {
    throw new Error(
      `convex run ${fn} failed after ${attempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  // The CLI can print notices before the result. Take the last JSON value.
  const start = raw.search(/[[{"]/);
  if (start === -1) {
    return null as T;
  }
  try {
    return JSON.parse(raw.slice(start)) as T;
  } catch {
    return null as T;
  }
}

export type IsolationMode = "shared" | "per-org";

export function setIsolationMode(mode: IsolationMode): void {
  convexRun("settings:setIsolationMode", { mode });
}

export type AuditRow = {
  correlationId: string;
  decision: "allow" | "deny";
  reason: string;
  actorOrgCode: string;
  targetOrgCode?: string;
  action: string;
  resourceKey?: string;
  isolationMode: IsolationMode;
  workerLabel?: string;
};

export function auditFor(correlationId: string): AuditRow[] {
  return convexRun<AuditRow[]>("audit:byCorrelation", { correlationId }) ?? [];
}
