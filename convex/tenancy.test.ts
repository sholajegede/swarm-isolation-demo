import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DENY, denyReasonOf } from "./lib/tenancy";
import schema from "./schema";

// Every runnable module under convex/, including _generated. Type-only
// declaration files and the tests themselves are excluded.
const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.d.ts",
  "!./**/*.test.ts",
]);

const TENANT_A = "org_tenant_a";
const TENANT_B = "org_tenant_b";

/**
 * Run a call that is expected to be refused and report the reason it was
 * refused with. Returns `undefined` when the call unexpectedly succeeded, so a
 * silent pass-through fails the assertion rather than slipping by.
 */
async function refusalReason(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return denyReasonOf(error) ?? `unrecognised error: ${String(error)}`;
  }
}

async function seed() {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    for (const [orgCode, name] of [
      [TENANT_A, "Tenant A"],
      [TENANT_B, "Tenant B"],
    ]) {
      await ctx.db.insert("tenants", {
        orgCode,
        name,
        isSuspended: false,
        createdAt: now,
      });
    }

    const aInvoice = await ctx.db.insert("resources", {
      orgCode: TENANT_A,
      key: "invoice-001",
      title: "Tenant A invoice",
      content: "A: 1200.00",
      createdAt: now,
    });
    const bInvoice = await ctx.db.insert("resources", {
      orgCode: TENANT_B,
      key: "invoice-001",
      title: "Tenant B invoice",
      content: "B: 9900.00",
      createdAt: now,
    });
    const bSecret = await ctx.db.insert("resources", {
      orgCode: TENANT_B,
      key: "merger-notes",
      title: "Tenant B merger notes",
      content: "B: confidential",
      createdAt: now,
    });

    return { aInvoice, bInvoice, bSecret };
  });

  return { t, ...ids };
}

describe("tenant isolation", () => {
  test("a listing returns only the acting tenant's resources", async () => {
    const { t } = await seed();

    const forA = await t.query(internal.resources.listForOrg, {
      actorOrgCode: TENANT_A,
    });

    expect(forA).toHaveLength(1);
    expect(forA.every((r) => r.orgCode === TENANT_A)).toBe(true);
    expect(forA.map((r) => r.content)).not.toContain("B: 9900.00");
  });

  test("tenant A cannot read tenant B's resource, even holding its id", async () => {
    const { t, bSecret } = await seed();

    // The id is real and the record exists. The only thing standing between
    // tenant A and the contents is the ownership check.
    expect(
      await refusalReason(
        t.query(internal.resources.readById, {
          actorOrgCode: TENANT_A,
          resourceId: bSecret,
        }),
      ),
    ).toBe(DENY.crossOrg);
  });

  test("tenant B can read its own resource through the same code path", async () => {
    const { t, bSecret } = await seed();

    const doc = await t.query(internal.resources.readById, {
      actorOrgCode: TENANT_B,
      resourceId: bSecret,
    });

    // The refusal above is about ownership, not a broken read path.
    expect(doc.content).toBe("B: confidential");
  });

  test("a key that exists in another tenant does not resolve across the boundary", async () => {
    const { t } = await seed();

    // Both tenants have a resource keyed "invoice-001". A must get its own.
    const own = await t.query(internal.resources.readByKey, {
      actorOrgCode: TENANT_A,
      key: "invoice-001",
    });
    expect(own.content).toBe("A: 1200.00");

    // "merger-notes" exists, but only inside tenant B.
    expect(
      await refusalReason(
        t.query(internal.resources.readByKey, {
          actorOrgCode: TENANT_A,
          key: "merger-notes",
        }),
      ),
    ).toBe(DENY.notFound);
  });

  test("tenant A cannot write to tenant B's resource, and nothing changes", async () => {
    const { t, bSecret } = await seed();

    expect(
      await refusalReason(
        t.mutation(internal.resources.update, {
          actorOrgCode: TENANT_A,
          resourceId: bSecret,
          content: "overwritten by tenant A",
        }),
      ),
    ).toBe(DENY.crossOrg);

    // A refused write must leave no trace.
    const after = await t.run(async (ctx) => ctx.db.get(bSecret));
    expect(after?.content).toBe("B: confidential");
    expect(after?.updatedAt).toBeUndefined();
  });

  test("a created resource is owned by the acting tenant", async () => {
    const { t } = await seed();

    const id = (await t.mutation(internal.resources.create, {
      actorOrgCode: TENANT_A,
      key: "new-note",
      title: "A note",
      content: "A: note",
    })) as Id<"resources">;

    const created = await t.run(async (ctx) => ctx.db.get(id));
    expect(created?.orgCode).toBe(TENANT_A);

    // And it is invisible from the other side of the boundary.
    expect(
      await refusalReason(
        t.query(internal.resources.readById, {
          actorOrgCode: TENANT_B,
          resourceId: id,
        }),
      ),
    ).toBe(DENY.crossOrg);
  });
});
