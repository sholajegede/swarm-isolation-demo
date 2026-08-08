/**
 * Phase 2 gate, run live against Kinde and the running backend.
 *
 * Proves that the acting tenant comes from a verified token and nothing else:
 * a real tenant A token resolves to tenant A with the right scope, and the same
 * token is refused against tenant B's data.
 *
 *   pnpm verify:auth
 *
 * Exits non-zero on the first failed expectation.
 */
import {
  callTool,
  orgCodeFor,
  toolsBaseUrl,
  workerToken,
  type ToolResponse,
} from "./lib/kinde";

let failures = 0;

function check(label: string, passed: boolean, detail: string) {
  const mark = passed ? "PASS" : "FAIL";
  if (!passed) failures += 1;
  console.log(`  [${mark}] ${label}`);
  console.log(`         ${detail}`);
}

const reasonOf = (r: ToolResponse) => String(r.body.reason ?? "(none)");

async function main() {
  console.log(`Tools endpoint: ${toolsBaseUrl()}\n`);

  const orgA = orgCodeFor("A");
  const orgB = orgCodeFor("B");

  const aReader = await workerToken("A", "READER");
  const aWriter = await workerToken("A", "WRITER");
  const bReader = await workerToken("B", "READER");

  console.log("1. A real token resolves to its own tenant and scope");
  const whoA = await callTool("/tools/whoami", aReader);
  check(
    "tenant A reader resolves to tenant A",
    whoA.status === 200 && whoA.body.orgCode === orgA,
    `HTTP ${whoA.status}, orgCode=${String(whoA.body.orgCode)} (expected ${orgA})`,
  );
  check(
    "tenant A reader carries resource:read and nothing more",
    Array.isArray(whoA.body.scopes) &&
      (whoA.body.scopes as string[]).join(",") === "resource:read",
    `scopes=${JSON.stringify(whoA.body.scopes)}`,
  );

  const whoAWriter = await callTool("/tools/whoami", aWriter);
  check(
    "tenant A writer carries resource:write and nothing more",
    Array.isArray(whoAWriter.body.scopes) &&
      (whoAWriter.body.scopes as string[]).join(",") === "resource:write",
    `scopes=${JSON.stringify(whoAWriter.body.scopes)}`,
  );

  const whoB = await callTool("/tools/whoami", bReader);
  check(
    "tenant B reader resolves to tenant B",
    whoB.status === 200 && whoB.body.orgCode === orgB,
    `HTTP ${whoB.status}, orgCode=${String(whoB.body.orgCode)} (expected ${orgB})`,
  );

  console.log("\n2. Each tenant sees only its own resources");
  const listA = await callTool("/tools/resource.list", aReader);
  const listB = await callTool("/tools/resource.list", bReader);
  const aRows = (listA.body.resources ?? []) as Array<{ id: string; key: string }>;
  const bRows = (listB.body.resources ?? []) as Array<{ id: string; key: string }>;
  const aIds = new Set(aRows.map((r) => r.id));

  check(
    "tenant A's listing does not contain any of tenant B's records",
    aRows.length > 0 && bRows.length > 0 && !bRows.some((r) => aIds.has(r.id)),
    `A has ${aRows.length} rows, B has ${bRows.length} rows, overlap=0`,
  );

  console.log("\n3. The gate: tenant A holding tenant B's real id");
  // The id is obtained from tenant B's own authorised listing, which is how one
  // leaks in practice - through a log line, a prompt, or a confused model.
  const bSecret = bRows.find((r) => r.key === "merger-notes");
  if (!bSecret) {
    check("tenant B has the record used for the cross-tenant attempt", false, "not found");
    return;
  }

  const crossRead = await callTool("/tools/resource.read", aReader, {
    resourceId: bSecret.id,
  });
  check(
    "tenant A is refused tenant B's record",
    crossRead.status === 403 && reasonOf(crossRead) === "cross_org",
    `HTTP ${crossRead.status}, reason=${reasonOf(crossRead)} (expected 403 cross_org)`,
  );
  check(
    "the refusal leaks no content and does not name the owning tenant",
    !JSON.stringify(crossRead.body).includes("confidential") &&
      !JSON.stringify(crossRead.body).includes(orgB),
    `body=${JSON.stringify(crossRead.body)}`,
  );

  const ownerRead = await callTool("/tools/resource.read", bReader, {
    resourceId: bSecret.id,
  });
  check(
    "tenant B reads that same record through the same code path",
    ownerRead.status === 200 &&
      String((ownerRead.body.resource as { content?: string })?.content).includes(
        "confidential",
      ),
    `HTTP ${ownerRead.status} - so the refusal above is about ownership, not a broken read`,
  );

  console.log("\n4. A key that exists only in the other tenant");
  const crossKey = await callTool("/tools/resource.read", aReader, {
    key: "merger-notes",
  });
  check(
    "tenant A cannot resolve a key that lives only in tenant B",
    crossKey.status === 403 && reasonOf(crossKey) === "not_found",
    `HTTP ${crossKey.status}, reason=${reasonOf(crossKey)}`,
  );

  const ownKey = await callTool("/tools/resource.read", aReader, { key: "invoice-001" });
  check(
    "a key present in both tenants resolves to the caller's own record",
    ownKey.status === 200 &&
      String((ownKey.body.resource as { content?: string })?.content).includes("Tenant A"),
    `content=${String((ownKey.body.resource as { content?: string })?.content)}`,
  );

  console.log("\n5. Fail closed on anything that is not a valid token");
  const noToken = await callTool("/tools/resource.list", null);
  check(
    "no Authorization header is refused",
    noToken.status === 401 && reasonOf(noToken) === "missing_token",
    `HTTP ${noToken.status}, reason=${reasonOf(noToken)}`,
  );

  const garbage = await callTool("/tools/resource.list", "not-a-jwt");
  check(
    "a non-token is refused",
    garbage.status === 401,
    `HTTP ${garbage.status}, reason=${reasonOf(garbage)}`,
  );

  // Flip the last character of the signature. Everything else stays valid, so
  // this only passes if the signature is genuinely being checked.
  const [h, p, s] = aReader.split(".");
  const flipped = s[s.length - 1] === "A" ? "B" : "A";
  const tampered = `${h}.${p}.${s.slice(0, -1)}${flipped}`;
  const forged = await callTool("/tools/resource.list", tampered);
  check(
    "a token with a tampered signature is refused",
    forged.status === 401,
    `HTTP ${forged.status}, reason=${reasonOf(forged)}`,
  );

  // Re-sign nothing, just swap the payload for one claiming tenant B. The
  // signature no longer matches, which is the point.
  const claimsB = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), org_code: orgB }),
  ).toString("base64url");
  const rewritten = await callTool("/tools/resource.list", `${h}.${claimsB}.${s}`);
  check(
    "a token whose org_code was edited to another tenant is refused",
    rewritten.status === 401,
    `HTTP ${rewritten.status}, reason=${reasonOf(rewritten)} - the claim is signed, so it cannot be swapped`,
  );

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nverification aborted:", error instanceof Error ? error.message : error);
  process.exit(1);
});
