/**
 * Phase 5 gate, run live against Kinde and the cloud deployment.
 *
 * Suspends one tenant and shows three things:
 *   - a token already in a worker's hands stops working immediately
 *   - Kinde still issues that tenant new tokens, so identity alone stops nothing
 *   - the other tenants are untouched
 *
 *   pnpm kill-switch
 *
 * Exits non-zero on the first failed expectation. Always unsuspends.
 */
import { randomUUID } from "node:crypto";

import { auditFor, convexRun, setIsolationMode } from "./lib/convexAdmin";
import { callTool, orgCodeFor, required, workerToken } from "./lib/kinde";

let failures = 0;
let suspended = false;

function check(label: string, passed: boolean, detail: string) {
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
  console.log(`         ${detail}`);
}

const orgA = orgCodeFor("A");

/** Ask Kinde directly, so the claim about tokens is not taken on trust. */
async function kindeIssuesTokenFor(tenant: "A" | "B"): Promise<number> {
  const response = await fetch(required("KINDE_M2M_TOKEN_URL"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: required(`KINDE_M2M_TENANT_${tenant}_READER_CLIENT_ID`),
      client_secret: required(`KINDE_M2M_TENANT_${tenant}_READER_CLIENT_SECRET`),
      audience: required("KINDE_AUDIENCE"),
    }),
  });
  return response.status;
}

async function main() {
  convexRun("killSwitch:sync");
  setIsolationMode("per-org");

  // Tokens fetched now, before anything is suspended. These stand in for the
  // tokens a worker is already holding when the switch is thrown.
  const aReader = await workerToken("A", "READER");
  const bReader = await workerToken("B", "READER");

  console.log("Before the switch");
  const aBefore = await callTool("/tools/resource.list", aReader);
  const bBefore = await callTool("/tools/resource.list", bReader);
  check(
    "tenant A is working",
    aBefore.status === 200,
    `HTTP ${aBefore.status}, ${(aBefore.body.resources as unknown[])?.length ?? 0} records`,
  );
  check(
    "tenant B is working",
    bBefore.status === 200,
    `HTTP ${bBefore.status}, ${(bBefore.body.resources as unknown[])?.length ?? 0} records`,
  );

  console.log("\nSuspending tenant A");
  convexRun("killSwitch:suspend", { orgCode: orgA });
  suspended = true;

  const runId = randomUUID();
  const aAfter = await callTool(
    "/tools/resource.list",
    aReader,
    {},
    { correlationId: runId, workerLabel: "reader-1" },
  );
  check(
    "the token tenant A already held stops working at once",
    aAfter.status === 403 && aAfter.body.reason === "organization_suspended",
    `HTTP ${aAfter.status}, reason=${String(aAfter.body.reason)}`,
  );
  check(
    "no records come back with the refusal",
    aAfter.body.resources === undefined,
    `body=${JSON.stringify(aAfter.body)}`,
  );

  // The uncomfortable part, stated plainly rather than assumed away.
  const tokenStatus = await kindeIssuesTokenFor("A");
  check(
    "Kinde still issues tokens for the suspended organization",
    tokenStatus === 200,
    `token endpoint HTTP ${tokenStatus} - suspension governs people signing in, ` +
      `not machine credentials, which is why the server has to check`,
  );

  const freshRefusal = await callTool("/tools/resource.list", await workerToken("A", "READER"));
  check(
    "a freshly minted token is refused just the same",
    freshRefusal.status === 403 &&
      freshRefusal.body.reason === "organization_suspended",
    `HTTP ${freshRefusal.status}, reason=${String(freshRefusal.body.reason)}`,
  );

  console.log("\nThe other tenants");
  const bAfter = await callTool("/tools/resource.list", bReader);
  check(
    "tenant B keeps running, unaffected",
    bAfter.status === 200 &&
      (bAfter.body.resources as unknown[])?.length ===
        (bBefore.body.resources as unknown[])?.length,
    `HTTP ${bAfter.status}, ${(bAfter.body.resources as unknown[])?.length ?? 0} records`,
  );

  console.log("\nThe switch works in the leaky mode too");
  setIsolationMode("shared");
  const sharedRefusal = await callTool("/tools/resource.list", aReader);
  check(
    "a suspended tenant is stopped even in shared mode",
    sharedRefusal.status === 403 &&
      sharedRefusal.body.reason === "organization_suspended",
    `HTTP ${sharedRefusal.status}, reason=${String(sharedRefusal.body.reason)}`,
  );
  setIsolationMode("per-org");

  console.log("\nThe record of it");
  const rows = auditFor(runId);
  const cutoff = rows.find((r) => r.reason === "organization_suspended");
  check(
    "the cutoff is in the audit trail under its correlation id",
    Boolean(cutoff) && cutoff!.decision === "deny" && cutoff!.actorOrgCode === orgA,
    `correlationId=${runId}, rows=[${rows.map((r) => `${r.decision}/${r.reason}`).join(", ")}]`,
  );

  console.log("\nLifting the suspension");
  convexRun("killSwitch:unsuspend", { orgCode: orgA });
  suspended = false;

  const aRestored = await callTool("/tools/resource.list", aReader);
  check(
    "tenant A works again once the suspension is lifted",
    aRestored.status === 200,
    `HTTP ${aRestored.status}, ${(aRestored.body.resources as unknown[])?.length ?? 0} records`,
  );

  console.log(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
  );
}

main()
  .catch((error) => {
    console.error("\nkill switch run aborted:", error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(() => {
    // Never leave a tenant suspended because a check threw.
    if (suspended) {
      try {
        convexRun("killSwitch:unsuspend", { orgCode: orgA });
        console.log("tenant A unsuspended during cleanup");
      } catch {
        console.error(`TENANT A IS STILL SUSPENDED - run: npx convex run killSwitch:unsuspend '{"orgCode":"${orgA}"}'`);
      }
    }
    setIsolationMode("per-org");
    process.exit(failures === 0 ? 0 : 1);
  });
