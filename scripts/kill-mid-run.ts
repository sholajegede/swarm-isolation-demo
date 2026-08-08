/**
 * Phase 5 gate, the live version: suspend a tenant while its swarm is running.
 *
 * Two real Kimi K3 swarms start at once, one for tenant A and one for tenant B.
 * Part way through, tenant A is suspended. Tenant A's workers should stop where
 * they stand. Tenant B's run should finish as if nothing happened.
 *
 *   pnpm kill-switch:live
 *
 * This one costs model calls. The deterministic proof is `pnpm kill-switch`.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { auditFor, convexRun, setIsolationMode, type AuditRow } from "./lib/convexAdmin";
import { orgCodeFor } from "./lib/kinde";

const SUSPEND_AFTER_MS = 12_000;

let failures = 0;
let suspended = false;

function check(label: string, passed: boolean, detail: string) {
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
  console.log(`         ${detail}`);
}

function runSwarm(tenant: "A" | "B", correlationId: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      "./.venv/bin/python",
      ["-m", "swarm", "--tenant", tenant, "--correlation-id", correlationId],
      {
        stdio: ["ignore", "pipe", "pipe"],
        // Two swarms run side by side here. The account allows three requests
        // in flight, so each process is held to one and neither starves the
        // other. A single swarm on its own uses the default.
        env: { ...process.env, KIMI_MAX_CONCURRENCY: "1" },
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("close", () => resolve(out));
  });
}

const tally = (rows: AuditRow[]) => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  }
  return counts;
};

async function main() {
  convexRun("killSwitch:sync");
  setIsolationMode("per-org");
  convexRun("seed:seedDemo");

  const orgA = orgCodeFor("A");
  const runA = randomUUID();
  const runB = randomUUID();

  console.log(`tenant A run ${runA}`);
  console.log(`tenant B run ${runB}`);
  console.log(`\nboth swarms starting; tenant A will be suspended after ${SUSPEND_AFTER_MS / 1000}s\n`);

  const timer = setTimeout(() => {
    console.log(">>> suspending tenant A mid-run\n");
    try {
      convexRun("killSwitch:suspend", { orgCode: orgA });
      suspended = true;
    } catch (error) {
      console.error("suspend failed:", error);
    }
  }, SUSPEND_AFTER_MS);

  const [outA, outB] = await Promise.all([runSwarm("A", runA), runSwarm("B", runB)]);
  clearTimeout(timer);

  check(
    "tenant A was suspended while its swarm was still running",
    suspended,
    suspended ? "suspend fired mid-run" : "suspend never fired",
  );

  const auditA = auditFor(runA);
  const auditB = auditFor(runB);
  const countsA = tally(auditA);
  const countsB = tally(auditB);

  console.log(`\n  tenant A audit: ${JSON.stringify(countsA)}`);
  console.log(`  tenant B audit: ${JSON.stringify(countsB)}\n`);

  check(
    "tenant A's workers were cut off",
    (countsA.organization_suspended ?? 0) > 0,
    `${countsA.organization_suspended ?? 0} organization_suspended refusals under ${runA}`,
  );
  check(
    "tenant A got real work done before the cutoff",
    (countsA.ok ?? 0) > 0,
    `${countsA.ok ?? 0} allowed calls before it was stopped, so this is a cutoff and not a failure to start`,
  );
  check(
    "tenant B was never refused for suspension",
    (countsB.organization_suspended ?? 0) === 0,
    `${countsB.organization_suspended ?? 0} suspension refusals for tenant B`,
  );
  check(
    "tenant B kept working throughout",
    (countsB.ok ?? 0) > 0,
    `${countsB.ok ?? 0} allowed calls for tenant B`,
  );

  const runs = convexRun<Array<{ correlationId: string; status: string }>>(
    "runs:recent",
    { limit: 10 },
  );
  const statusB = runs?.find((r) => r.correlationId === runB)?.status;
  check(
    "tenant B's run reached a normal end",
    statusB === "completed",
    `tenant B run status=${String(statusB)}`,
  );

  console.log("--- tenant A output (tail) ---");
  console.log(outA.split("\n").slice(-14).join("\n"));
  console.log("\n--- tenant B output (tail) ---");
  console.log(outB.split("\n").slice(-14).join("\n"));

  console.log(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
  );
}

main()
  .catch((error) => {
    console.error("\naborted:", error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(() => {
    if (suspended) {
      try {
        convexRun("killSwitch:unsuspend", { orgCode: orgCodeFor("A") });
        console.log("tenant A unsuspended");
      } catch {
        console.error("TENANT A IS STILL SUSPENDED - run npx convex run killSwitch:unsuspend");
      }
    }
    setIsolationMode("per-org");
    process.exit(failures === 0 ? 0 : 1);
  });
