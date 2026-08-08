# Build log

What each phase built, what was decided, and what was checked live before the
phase was saved.

---

## Phase 0 — Scaffold

**Built**

- Next.js 16 (App Router, TypeScript, Tailwind v4) at the repo root.
- `lib/env.ts` — server-side configuration. Holds two rules the rest of the
  build depends on:
  - `ISOLATION_MODE` is read from the deployment environment only.
  - Any value other than an explicit `shared` resolves to `per-org`, so a
    missing or misspelled value fails closed into the enforcing mode.
- `app/api/health/route.ts` — reports status, the server-decided isolation
  mode, and a booleans-only view of which services are configured.
- `.env.example` — every variable the build needs, documented and empty.
- `HOW-IT-WORKS.md` — plain-English guide to the app, the file layout, and how
  Kimi K3, Kinde, and Convex fit together.
- Convex, `jose`, `convex-test`, and Vitest installed.

**Decisions**

- The health route reports `configured` as booleans, never values, so it stays
  safe to expose.
- The Kimi K3 model id lives in `KIMI_MODEL`. It is never a constant in code,
  because pinned ids go 404.
- `ISOLATION_MODE` is deliberately not a `NEXT_PUBLIC_` variable. Neither the
  browser nor a worker can read or set it.
- `.gitignore` keeps ignoring `.env*` but re-includes `.env.example`.

**Checked live, before saving**

- `pnpm typecheck` and `pnpm build` both clean. `/api/health` compiled dynamic,
  so it reads the environment per request rather than at build time.
- `pnpm dev` booted, then against the running server:
  - `GET /api/health` → HTTP 200,
    `{"status":"ok","isolationMode":"per-org","configured":{"convex":false,"kindeAuth":false,"kindeManagement":false,"kimi":false}}`
  - `GET /` → HTTP 200, no errors in the dev log.
- The fail-closed default is proven by that response: no `ISOLATION_MODE` is set
  anywhere yet, and the server still resolved `per-org`.

**Open**

- No Kinde, Convex, or Kimi credentials yet. Phases 2, 4, and 5 have live gates
  that cannot run until they exist.

---

## Phase 1 — Data model + tenancy

**Built**

- `convex/schema.ts` — `tenants`, `workers`, `resources`, `runs`, `runEvents`,
  `auditLog`. `orgCode` is the tenancy key on every tenant-owned table and holds
  the Kinde `org_code` claim. Indexes are org-scoped, so a tenant listing never
  reads another tenant's rows.
- `convex/lib/tenancy.ts` — the boundary, kept to one small file so there is a
  single door to guard. `requireSameOrg` re-checks ownership after a load, which
  is what makes a stolen or guessed document id useless. `DENY` holds the stable
  machine-readable refusal reasons.
- `convex/resources.ts` — the tenant data accessors, all `internal`.
- `convex/tenancy.test.ts` — six tests over `convex-test`.

**Decisions**

- Every data accessor is `internalQuery` / `internalMutation`. Nothing public
  takes an `orgCode` argument, so a browser or a worker cannot call in with a
  tenant of its choosing. The enforcement seam is the only caller, and from
  phase 2 it derives `actorOrgCode` from a verified token.
- `actorOrgCode` is therefore never user input; it is the output of token
  verification passed inward. Phase 1 supplies it directly only because token
  verification does not exist yet.
- A refusal tells the caller `cross_org` but not which tenant owns the record.
  The owning tenant goes to the audit log, which is server-side.
- `not_found` and `cross_org` are reported separately. That is deliberate here,
  where showing the boundary being hit is the point; a system resisting probing
  for which ids exist would collapse both into one reason. Noted in the code.
- Convex runs as a local anonymous deployment, so no account is needed to
  develop or test. `.convex/` is local backend state and is ignored;
  `convex/_generated` is committed.

**Checked live, before saving**

- `pnpm test` → 6 passed, covering: an org-scoped listing excludes the other
  tenant; tenant A holding tenant B's real document id is refused `cross_org`;
  tenant B reads that same record through the same code path, so the refusal is
  about ownership and not a broken read; a key that exists in both tenants
  resolves to the caller's own row; a key that exists only in tenant B is
  `not_found` for tenant A; a cross-tenant write is refused and the target row
  is unchanged with no `updatedAt`; a created row is owned by its creator and
  invisible from the other side.
- **Mutation-tested the suite.** With the ownership check deleted from
  `requireSameOrg`, exactly the 3 cross-tenant tests failed and the other 3 kept
  passing. Restoring it returned 6/6. The suite fails when the boundary breaks,
  which is the only thing that makes a green run mean anything.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` all clean.

**Open**

- The tests prove the data layer isolates. They do not yet prove the *system*
  isolates, because nothing verifies who the caller is. That is phase 2.
