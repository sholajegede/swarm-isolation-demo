import { internalMutation } from "./_generated/server";

/**
 * Demo data. Three tenants, each with resources that are obviously theirs, so
 * that a cross-tenant read is unmistakable when you see it in the timeline.
 *
 * Org codes come from the deployment environment, not from arguments, so the
 * seed cannot be pointed at a tenant that was never configured.
 */

const TENANTS = [
  { envVar: "KINDE_ORG_TENANT_A", name: "Tenant A" },
  { envVar: "KINDE_ORG_TENANT_B", name: "Tenant B" },
  { envVar: "KINDE_ORG_TENANT_C", name: "Tenant C" },
] as const;

const RESOURCES: Record<string, Array<{ key: string; title: string; content: string }>> = {
  "Tenant A": [
    { key: "invoice-001", title: "Invoice 001", content: "Tenant A - amount due 1,200.00" },
    { key: "contract-acme", title: "Acme contract", content: "Tenant A - renews March, 24 month term" },
    { key: "payroll-summary", title: "Payroll summary", content: "Tenant A - 34 staff, confidential" },
  ],
  "Tenant B": [
    { key: "invoice-001", title: "Invoice 001", content: "Tenant B - amount due 9,900.00" },
    { key: "merger-notes", title: "Merger notes", content: "Tenant B - confidential, not for distribution" },
    { key: "customer-list", title: "Customer list", content: "Tenant B - 812 accounts" },
  ],
  "Tenant C": [
    { key: "invoice-001", title: "Invoice 001", content: "Tenant C - amount due 450.00" },
    { key: "roadmap", title: "Product roadmap", content: "Tenant C - internal only" },
    { key: "incident-log", title: "Incident log", content: "Tenant C - 3 open incidents" },
  ],
};

export const seedDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const summary: Array<{ name: string; orgCode: string; resources: number }> = [];

    for (const { envVar, name } of TENANTS) {
      const orgCode = process.env[envVar]?.trim();
      if (!orgCode) {
        throw new Error(`${envVar} is not set on the Convex deployment`);
      }

      // Replace any previous seed for this tenant so the script is repeatable.
      const existingResources = await ctx.db
        .query("resources")
        .withIndex("by_org", (q) => q.eq("orgCode", orgCode))
        .collect();
      for (const row of existingResources) {
        await ctx.db.delete(row._id);
      }

      const existingTenant = await ctx.db
        .query("tenants")
        .withIndex("by_org", (q) => q.eq("orgCode", orgCode))
        .unique();
      if (existingTenant) {
        await ctx.db.patch(existingTenant._id, { name, isSuspended: false });
      } else {
        await ctx.db.insert("tenants", {
          orgCode,
          name,
          isSuspended: false,
          createdAt: now,
        });
      }

      for (const resource of RESOURCES[name]) {
        await ctx.db.insert("resources", {
          orgCode,
          key: resource.key,
          title: resource.title,
          content: resource.content,
          createdAt: now,
        });
      }

      summary.push({ name, orgCode, resources: RESOURCES[name].length });
    }

    return summary;
  },
});
