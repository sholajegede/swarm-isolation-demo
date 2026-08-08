import { describe, expect, test } from "vitest";

import { ALLOW, DENY, decide, resolveMode, type IsolationMode } from "./lib/decide";

const A = "org_tenant_a";
const B = "org_tenant_b";

const call = (
  mode: IsolationMode,
  targetOrgCode: string | null,
  scopes: string[] = ["resource:read"],
) =>
  decide({
    mode,
    actorOrgCode: A,
    actorScopes: scopes,
    requiredScope: "resource:read",
    targetOrgCode,
  });

describe("the decision rule", () => {
  test("per-org refuses a cross-tenant call", () => {
    const d = call("per-org", B);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe(DENY.crossOrg);
    expect(d.crossOrg).toBe(true);
  });

  test("shared allows the same cross-tenant call, and says so", () => {
    const d = call("shared", B);
    expect(d.allow).toBe(true);
    expect(d.reason).toBe(ALLOW.crossOrgAllowed);
    expect(d.crossOrg).toBe(true);
  });

  test("both modes allow a tenant its own record", () => {
    for (const mode of ["per-org", "shared"] as const) {
      const d = call(mode, A);
      expect(d.allow).toBe(true);
      expect(d.reason).toBe(ALLOW.ok);
      expect(d.crossOrg).toBe(false);
    }
  });

  test("per-org refuses a missing scope on the tenant's own record", () => {
    const d = call("per-org", A, ["resource:write"]);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe(DENY.insufficientScope);
  });

  test("a cross-tenant call reports cross_org even when the scope is also wrong", () => {
    // The tenant boundary is the more serious failure, so it is the one named.
    const d = call("per-org", B, ["resource:write"]);
    expect(d.reason).toBe(DENY.crossOrg);
  });

  test("shared ignores the scope too, which is the shortcut it models", () => {
    const d = call("shared", A, []);
    expect(d.allow).toBe(true);
  });

  test("a call with no particular target is never cross-tenant", () => {
    for (const mode of ["per-org", "shared"] as const) {
      expect(call(mode, null).crossOrg).toBe(false);
    }
  });

  test("per-org still needs the scope when there is no target", () => {
    expect(call("per-org", null, []).reason).toBe(DENY.insufficientScope);
  });
});

describe("resolving the mode", () => {
  test("only an exact 'shared' is shared", () => {
    expect(resolveMode("shared")).toBe("shared");
    expect(resolveMode(" SHARED ")).toBe("shared");
  });

  test("everything else falls to the enforcing mode", () => {
    for (const raw of [undefined, null, "", "  ", "per-org", "sharedd", "off", "false", "0"]) {
      expect(resolveMode(raw)).toBe("per-org");
    }
  });
});
