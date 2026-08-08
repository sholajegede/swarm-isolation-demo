/**
 * The whole arc, live, in one pass.
 *
 *   seed -> shared leak -> per-org refusal -> least privilege -> kill switch
 *        -> audit rows matched back to every beat
 *
 *   pnpm e2e              includes one real Kimi K3 swarm run
 *   pnpm e2e --no-swarm   enforcement only, no model calls
 *
 * Exits non-zero if any expectation fails. Always restores the deployment:
 * tenants unsuspended, mode per-org, demo data reseeded.
 *
 * A note on what is asserted about the swarm. The enforcement beats are
 * asserted exactly, because the server decides those and must be identical
 * every time. The swarm run is asserted loosely - that it ran, authenticated
 * and recorded steps - because what the agents choose to do is theirs to
 * decide and varies between runs. Requiring a model to misbehave on cue would
 * make this script lie about how reliable it is.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  auditFor,
  convexRun,
  setIsolationMode,
  type AuditRow,
} from "./lib/convexAdmin";
import { callTool, orgCodeFor, toolsBaseUrl, workerToken } from "./lib/kinde";

const withSwarm = !process.argv.includes("--no-swarm");

let failures = 0;
let suspendedOrg: string | null = null;
const beats: string[] = [];

function step(label: string) {
  console.log(`\n${label}`);
  console.log("-".repeat(label.length));
}

function check(label: string, passed: boolean, detail: string) {
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
  console.log(`         ${detail}`);
}

const reasons = (rows: AuditRow[]) => rows.map((r) => `${r.decision}/${r.reason}`);

function runSwarm(tenant: "A" | "B", correlationId: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "./.venv/bin/python",
      ["-m", "swarm", "--tenant", tenant, "--correlation-id", correlationId],
      {
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env, KIMI_MAX_CONCURRENCY: "2" },
      },
    );
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  console.log(`Swarm isolation, end to end`);
  console.log(`endpoint  ${toolsBaseUrl()}`);
  console.log(`swarm run ${withSwarm ? "included" : "skipped (--no-swarm)"}`);

  const orgA = orgCodeFor("A");
  const orgB = orgCodeFor("B");

  // ------------------------------------------------------------------ seed
  step("1. Seed three tenants and start from a known state");
  convexRun("killSwitch:sync");
  setIsolationMode("per-org");
  const seeded = convexRun<Array<{ name: string; resources: number }>>(
    "seed:seedDemo",
  );
  check(
    "three tenants seeded",
    Array.isArray(seeded) && seeded.length === 3,
    (seeded ?? []).map((t) => `${t.name}:${t.resources}`).join(", "),
  );

  const aReader = await workerToken("A", "READER");
  const aWriter = await workerToken("A", "WRITER");
  const bReader = await workerToken("B", "READER");

  // A real tenant B record for tenant A to reach for. The id comes from tenant
  // B's own authorised listing, which is how one leaks in practice.
  const listB = await callTool("/tools/resource.list", bReader);
  const bRows = (listB.body.resources ?? []) as Array<{ id: string; key: string }>;
  const target = bRows.find((r) => r.key === "merger-notes");
  check(
    "tenant B has the confidential record used throughout",
    Boolean(target),
    target ? `merger-notes ${target.id.slice(0, 10)}…` : "not found",
  );
  if (!target) return;

  // ---------------------------------------------------------------- shared
  step("2. Shared identity: the reach succeeds");
  setIsolationMode("shared");
  const leakRun = randomUUID();

  const leak = await callTool(
    "/tools/resource.read",
    aReader,
    { resourceId: target.id },
    { correlationId: leakRun, workerLabel: "reader-1" },
  );
  check(
    "tenant A reads tenant B's record",
    leak.status === 200 && leak.body.crossOrg === true,
    `HTTP ${leak.status}, crossOrg=${String(leak.body.crossOrg)}`,
  );
  check(
    "tenant B's confidential content came back",
    String((leak.body.resource as { content?: string })?.content ?? "").includes(
      "confidential",
    ),
    String((leak.body.resource as { content?: string })?.content ?? ""),
  );
  beats.push(`shared leak      ${leakRun}`);

  if (withSwarm) {
    step("3. A real Kimi K3 swarm runs under that same shared identity");
    const swarmRun = randomUUID();
    const code = await runSwarm("A", swarmRun);
    const swarmAudit = auditFor(swarmRun);
    const workers = new Set(
      swarmAudit.map((r) => r.workerLabel).filter((l) => l && l !== "orchestrator"),
    );

    check("the swarm process exited cleanly", code === 0, `exit code ${code}`);
    check(
      "its agents authenticated and were judged by the seam",
      swarmAudit.length > 0 && workers.size > 0,
      `${swarmAudit.length} decisions, ${workers.size} agents: ${[...workers].join(", ")}`,
    );
    const escapes = swarmAudit.filter((r) => r.reason === "cross_org_allowed").length;
    console.log(
      `         ${escapes} cross-tenant call(s) were permitted this run` +
        (escapes === 0
          ? " - the agents did not reach across this time, which is their choice to make"
          : ""),
    );
    beats.push(`swarm run        ${swarmRun}`);
  }

  // --------------------------------------------------------------- per-org
  step(`${withSwarm ? 4 : 3}. Identity per tenant: the same call is refused`);
  setIsolationMode("per-org");
  const blockRun = randomUUID();

  const blocked = await callTool(
    "/tools/resource.read",
    aReader,
    { resourceId: target.id },
    { correlationId: blockRun, workerLabel: "reader-1" },
  );
  check(
    "the identical call is refused 403 cross_org",
    blocked.status === 403 && blocked.body.reason === "cross_org",
    `HTTP ${blocked.status}, reason=${String(blocked.body.reason)}`,
  );
  check(
    "the correlation id comes back with the refusal",
    blocked.body.correlationId === blockRun,
    String(blocked.body.correlationId),
  );
  check(
    "no tenant B content is returned",
    !JSON.stringify(blocked.body).includes("confidential"),
    JSON.stringify(blocked.body),
  );
  beats.push(`per-org refusal  ${blockRun}`);

  step(`${withSwarm ? 5 : 4}. Least privilege inside the tenant's own data`);
  const scopeRun = randomUUID();
  const ownRows = ((await callTool("/tools/resource.list", aReader)).body
    .resources ?? []) as Array<{ id: string; key: string }>;
  const ownRecord = ownRows.find((r) => r.key === "consolidated-summary") ?? ownRows[0];

  const wrongScope = await callTool(
    "/tools/resource.write",
    aReader,
    { resourceId: ownRecord.id, content: "written by a read-only agent" },
    { correlationId: scopeRun, workerLabel: "reader-1" },
  );
  check(
    "a read-only agent cannot write, even to its own tenant",
    wrongScope.status === 403 && wrongScope.body.reason === "insufficient_scope",
    `HTTP ${wrongScope.status}, reason=${String(wrongScope.body.reason)}`,
  );

  const crossWrite = await callTool(
    "/tools/resource.write",
    aWriter,
    { resourceId: target.id, content: "tenant A writing into tenant B" },
    { correlationId: scopeRun, workerLabel: "writer-1" },
  );
  check(
    "the write agent cannot write into another tenant",
    crossWrite.status === 403 && crossWrite.body.reason === "cross_org",
    `HTTP ${crossWrite.status}, reason=${String(crossWrite.body.reason)}`,
  );
  beats.push(`scope refusals   ${scopeRun}`);

  // ------------------------------------------------------------ kill switch
  step(`${withSwarm ? 6 : 5}. Kill switch: one tenant stops, the others do not`);
  const killRun = randomUUID();

  const beforeKill = await callTool("/tools/resource.list", aReader);
  check("tenant A is working before the switch", beforeKill.status === 200, `HTTP ${beforeKill.status}`);

  convexRun("killSwitch:suspend", { orgCode: orgA });
  suspendedOrg = orgA;

  const afterKill = await callTool(
    "/tools/resource.list",
    aReader,
    {},
    { correlationId: killRun, workerLabel: "reader-1" },
  );
  check(
    "the token tenant A already held stops working",
    afterKill.status === 403 && afterKill.body.reason === "organization_suspended",
    `HTTP ${afterKill.status}, reason=${String(afterKill.body.reason)}`,
  );
  check(
    "tenant B is untouched",
    (await callTool("/tools/resource.list", bReader)).status === 200,
    "tenant B still lists its records",
  );

  const openRuns = convexRun<Array<{ orgCode: string; status: string }>>(
    "runs:recent",
    { limit: 20 },
  );
  check(
    "no run for tenant A is left hanging at running",
    !(openRuns ?? []).some((r) => r.orgCode === orgA && r.status === "running"),
    `${(openRuns ?? []).filter((r) => r.orgCode === orgA && r.status === "running").length} still open`,
  );

  convexRun("killSwitch:unsuspend", { orgCode: orgA });
  suspendedOrg = null;
  check(
    "lifting the suspension restores tenant A",
    (await callTool("/tools/resource.list", aReader)).status === 200,
    "tenant A lists its records again",
  );
  beats.push(`kill switch      ${killRun}`);

  // ---------------------------------------------------------------- audit
  step(`${withSwarm ? 7 : 6}. Every beat is in the audit trail, under its own id`);

  const leakRows = auditFor(leakRun);
  check(
    "the leak is recorded as an allow that crossed tenants",
    leakRows.some(
      (r) =>
        r.decision === "allow" &&
        r.reason === "cross_org_allowed" &&
        r.actorOrgCode === orgA &&
        r.targetOrgCode === orgB,
    ),
    `[${reasons(leakRows).join(", ")}] actor ${orgA} target ${orgB}`,
  );

  const blockRows = auditFor(blockRun);
  check(
    "the refusal is recorded against the same tenants",
    blockRows.some(
      (r) =>
        r.decision === "deny" &&
        r.reason === "cross_org" &&
        r.actorOrgCode === orgA &&
        r.targetOrgCode === orgB,
    ),
    `[${reasons(blockRows).join(", ")}]`,
  );

  const scopeRows = auditFor(scopeRun);
  check(
    "both scope refusals are recorded on one id",
    scopeRows.filter((r) => r.decision === "deny").length === 2 &&
      scopeRows.some((r) => r.reason === "insufficient_scope") &&
      scopeRows.some((r) => r.reason === "cross_org"),
    `[${reasons(scopeRows).join(", ")}]`,
  );

  const killRows = auditFor(killRun);
  check(
    "the cutoff is recorded",
    killRows.some((r) => r.reason === "organization_suspended"),
    `[${reasons(killRows).join(", ")}]`,
  );

  check(
    "the leak and the refusal are the same call with different outcomes",
    leakRows.some((r) => r.action === "resource.read") &&
      blockRows.some((r) => r.action === "resource.read"),
    "both recorded against action resource.read",
  );
}

main()
  .catch((error) => {
    console.error(`\naborted: ${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
  })
  .finally(() => {
    // Leave the deployment exactly as a fresh clone would expect it.
    try {
      if (suspendedOrg) {
        convexRun("killSwitch:unsuspend", { orgCode: suspendedOrg });
      }
      setIsolationMode("per-org");
      convexRun("seed:seedDemo");
    } catch {
      console.error("cleanup failed - check tenant suspension and isolation mode");
      failures += 1;
    }

    console.log("\nrun ids");
    for (const beat of beats) console.log(`  ${beat}`);

    console.log(
      failures === 0
        ? "\nAll beats passed. Deployment restored: tenants running, mode per-org.\n"
        : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
