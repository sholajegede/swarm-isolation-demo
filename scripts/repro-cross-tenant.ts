/**
 * Phase 3 gate, run live.
 *
 * The same call, made twice, against a server that differs only in the mode it
 * was put into. A tenant A worker reaches for a tenant B record.
 *
 *   shared   the call goes through, and the breach is recorded
 *   per-org  the call is refused 403 cross_org, with a correlation id
 *
 * The audit trail is then read back for both, by correlation id.
 *
 *   pnpm repro:cross-tenant
 *
 * Exits non-zero on the first failed expectation. Always restores per-org.
 */
import { randomUUID } from "node:crypto";

import { auditFor, setIsolationMode, type AuditRow } from "./lib/convexAdmin";
import { callTool, orgCodeFor, toolsBaseUrl, workerToken } from "./lib/kinde";

let failures = 0;

/**
 * Set once the script is about to modify a seeded record, so the change can be
 * undone however the run ends. A proof script that leaves the data different
 * from how it found it makes the next script lie.
 */
let undoWrite: (() => Promise<void>) | null = null;

function check(label: string, passed: boolean, detail: string) {
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
  console.log(`         ${detail}`);
}

const describeRows = (rows: AuditRow[]) =>
  rows.map((r) => `${r.decision}/${r.reason}`).join(", ") || "(none)";

async function main() {
  console.log(`Tools endpoint: ${toolsBaseUrl()}\n`);

  const orgA = orgCodeFor("A");
  const orgB = orgCodeFor("B");
  const aReader = await workerToken("A", "READER");
  const bReader = await workerToken("B", "READER");

  // A tenant A worker needs a real tenant B record to reach for. Tenant B's
  // own authorised listing supplies the id, which is how one leaks in life.
  const listB = await callTool("/tools/resource.list", bReader);
  const bRows = (listB.body.resources ?? []) as Array<{ id: string; key: string }>;
  const target = bRows.find((r) => r.key === "merger-notes");
  if (!target) {
    console.error("tenant B has no merger-notes record. Run pnpm seed first.");
    process.exit(1);
  }

  // ---------------------------------------------------------------- shared
  console.log("SHARED mode - one identity for the whole swarm, no org scoping");
  setIsolationMode("shared");
  const sharedRun = randomUUID();

  const leak = await callTool(
    "/tools/resource.read",
    aReader,
    { resourceId: target.id },
    { correlationId: sharedRun, workerLabel: "reader-1" },
  );

  check(
    "the tenant A worker reads tenant B's record",
    leak.status === 200 && leak.body.ok === true,
    `HTTP ${leak.status}`,
  );
  check(
    "the leaked content is tenant B's",
    String((leak.body.resource as { content?: string })?.content ?? "").includes(
      "confidential",
    ),
    `content=${String((leak.body.resource as { content?: string })?.content)}`,
  );
  check(
    "the response admits it crossed a boundary",
    leak.body.crossOrg === true && leak.body.isolationMode === "shared",
    `crossOrg=${String(leak.body.crossOrg)}, mode=${String(leak.body.isolationMode)}`,
  );

  const sharedAudit = auditFor(sharedRun);
  const breach = sharedAudit.find((r) => r.reason === "cross_org_allowed");
  check(
    "the breach is recorded as an allow that crossed tenants",
    Boolean(breach) &&
      breach!.decision === "allow" &&
      breach!.actorOrgCode === orgA &&
      breach!.targetOrgCode === orgB,
    `rows=[${describeRows(sharedAudit)}], actor=${breach?.actorOrgCode}, target=${breach?.targetOrgCode}`,
  );

  // --------------------------------------------------------------- per-org
  console.log("\nPER-ORG mode - the same call, the same worker, the same record");
  setIsolationMode("per-org");
  const perOrgRun = randomUUID();

  const blocked = await callTool(
    "/tools/resource.read",
    aReader,
    { resourceId: target.id },
    { correlationId: perOrgRun, workerLabel: "reader-1" },
  );

  check(
    "the call is refused 403 cross_org",
    blocked.status === 403 && blocked.body.reason === "cross_org",
    `HTTP ${blocked.status}, reason=${String(blocked.body.reason)}`,
  );
  check(
    "the refusal carries the correlation id back to the caller",
    blocked.body.correlationId === perOrgRun,
    `correlationId=${String(blocked.body.correlationId)}`,
  );
  check(
    "no tenant B content is returned",
    !JSON.stringify(blocked.body).includes("confidential"),
    `body=${JSON.stringify(blocked.body)}`,
  );

  const perOrgAudit = auditFor(perOrgRun);
  const denial = perOrgAudit.find((r) => r.reason === "cross_org");
  check(
    "the refusal is recorded against the same correlation id",
    Boolean(denial) &&
      denial!.decision === "deny" &&
      denial!.actorOrgCode === orgA &&
      denial!.targetOrgCode === orgB,
    `rows=[${describeRows(perOrgAudit)}]`,
  );

  // ------------------------------------------------------- scope, per-org
  console.log("\nPER-ORG mode - least privilege inside the tenant's own data");
  const scopeRun = randomUUID();
  const ownRow = (
    (await callTool("/tools/resource.list", aReader)).body.resources as Array<{
      id: string;
    }>
  )[0];

  const wrongScope = await callTool(
    "/tools/resource.write",
    aReader,
    { resourceId: ownRow.id, content: "written by a read-only worker" },
    { correlationId: scopeRun, workerLabel: "reader-1" },
  );
  check(
    "a read-only worker cannot write, even to its own tenant",
    wrongScope.status === 403 && wrongScope.body.reason === "insufficient_scope",
    `HTTP ${wrongScope.status}, reason=${String(wrongScope.body.reason)}`,
  );

  const aWriter = await workerToken("A", "WRITER");

  // Remember the record as it was, so the successful write below can be undone.
  const before = await callTool("/tools/resource.read", aReader, {
    resourceId: ownRow.id,
  });
  const originalContent = String(
    (before.body.resource as { content?: string })?.content ?? "",
  );
  undoWrite = async () => {
    await callTool(
      "/tools/resource.write",
      aWriter,
      { resourceId: ownRow.id, content: originalContent },
      // Its own correlation id, so restoring does not appear in the run above.
      { correlationId: randomUUID(), workerLabel: "cleanup" },
    );
  };

  const rightScope = await callTool(
    "/tools/resource.write",
    aWriter,
    { resourceId: ownRow.id, content: "written by the write worker" },
    { correlationId: scopeRun, workerLabel: "writer-1" },
  );
  check(
    "the write worker can write to its own tenant",
    rightScope.status === 200,
    `HTTP ${rightScope.status}`,
  );

  const crossWrite = await callTool(
    "/tools/resource.write",
    aWriter,
    { resourceId: target.id, content: "tenant A writing into tenant B" },
    { correlationId: scopeRun, workerLabel: "writer-1" },
  );
  check(
    "the write worker cannot write into another tenant",
    crossWrite.status === 403 && crossWrite.body.reason === "cross_org",
    `HTTP ${crossWrite.status}, reason=${String(crossWrite.body.reason)}`,
  );

  const scopeAudit = auditFor(scopeRun);
  check(
    "all three attempts are on one correlation id",
    scopeAudit.length === 3,
    `rows=[${describeRows(scopeAudit)}]`,
  );

  console.log(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
  );
}

main()
  .catch((error) => {
    console.error("\nrepro aborted:", error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(async () => {
    // Put the record back before anything else, while the mode still permits
    // the write, then leave the deployment in the enforcing mode.
    if (undoWrite) {
      try {
        await undoWrite();
        console.log("seeded record restored");
      } catch {
        console.error("could not restore the seeded record - run pnpm seed");
        failures += 1;
      }
    }
    setIsolationMode("per-org");
    console.log("isolation mode restored to per-org");
    process.exit(failures === 0 ? 0 : 1);
  });
