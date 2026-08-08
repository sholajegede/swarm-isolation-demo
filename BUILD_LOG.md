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

---

## Phase 2 — Kinde auth foundation (live)

**Kinde setup in use** (codes are not secrets; credentials live only in `.env.local`)

- Issuer: `https://devrelstudio.kinde.com`
- API audience: `swarm-demo-api`, scopes `resource:read` and `resource:write`
- Organizations: Tenant A `org_2606b8199462b`, Tenant B `org_364dd8200a3d3`,
  Tenant C `org_0c39cb2010b01`
- Seven M2M apps: a reader and a writer inside each organization, plus one
  Management API app held back for phase 5.

**Built**

- `convex/lib/kindeToken.ts` — verifies a bearer token against Kinde's JWKS and
  returns the identity it proves: `orgCode`, `scopes`, `clientId`, `tokenId`.
  Signature, issuer, audience and expiry are all checked, `RS256` is pinned, and
  a token carrying no `org_code` is refused rather than guessed at. Every path
  out of the module either returns a verified identity or throws.
- `convex/http.ts` — the tool endpoints a worker calls: `/tools/whoami`,
  `/tools/resource.list`, `/tools/resource.read`. The acting tenant comes from
  the token; the request body only chooses which record is wanted.
- `convex/seed.ts` — three tenants with obviously-theirs data, org codes read
  from the deployment environment so the seed cannot name a tenant that was
  never configured.
- `scripts/verify-kinde-auth.ts` (`pnpm verify:auth`) — the live gate.

**Decisions**

- One JWKS fetcher per issuer, cached per isolate, so verification does not call
  Kinde on every request. `jose` refetches only on an unknown key id.
- The refusal body is `{ ok: false, reason }` and nothing else. It does not name
  the tenant that owns the record; that goes to the audit log, server-side.
- Convex functions read their own environment, so `KINDE_ISSUER_URL`,
  `KINDE_AUDIENCE`, `ISOLATION_MODE` and the org codes are set on the
  deployment with `npx convex env set`, not inherited from `.env.local`.

**Checked live, before saving**

`pnpm verify:auth` against real Kinde and the running backend — 14 checks, all
passing:

- A real tenant A token resolves to `org_2606b8199462b` with exactly
  `resource:read`; the tenant A writer carries exactly `resource:write`; the
  tenant B token resolves to tenant B.
- Tenant A's listing and tenant B's listing have zero overlap.
- **The gate.** Tenant A, holding a *real* id for tenant B's `merger-notes`
  record obtained from tenant B's own authorised listing, is refused with
  `HTTP 403 cross_org`. The response body is `{"ok":false,"reason":"cross_org"}`
  — no content, and no mention of the owning tenant.
- Tenant B reads that same record through the same code path and gets it, so
  the refusal is about ownership rather than a broken read.
- A key that exists only in tenant B is `not_found` for tenant A, while
  `invoice-001`, which exists in both, resolves to the caller's own row.
- Fails closed on: no Authorization header (`missing_token`), a non-token
  (`malformed_token`), a token with one character flipped in the signature
  (`invalid_token`), and a token whose `org_code` was edited to tenant B
  (`invalid_token`). The last two are what prove the signature is genuinely
  checked — if verification were being skipped they would have returned 200.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (6/6) and `pnpm build` all clean.

**Open**

- Kinde issues these M2M tokens with a 24 hour lifetime. Phase 7 calls for
  short-lived tokens; that is a per-application setting in Kinde and should be
  reduced before the production pass is claimed done.
- Scope is resolved off the token but not yet *enforced* — a `resource:read`
  token is not currently stopped from calling a write tool. That check, the two
  isolation modes and the audit trail are phase 3.

---

## Convex moved to a cloud deployment

Between phases 2 and 3 the backend moved off the local anonymous deployment.

- Project `shola-jegede/swarm-isolation-demo`, deployment
  `fastidious-warthog-135`. Tools are served from
  `https://fastidious-warthog-135.convex.site`.
- Deployment environment re-set with `npx convex env set`, data re-seeded, and
  `pnpm verify:auth` re-run against the cloud deployment: 14/14 still passing.
- Nothing has to run locally now for the tool endpoints to answer.

---

## Phase 3 — Enforcement seam + the two modes

**Built**

- `convex/lib/decide.ts` — the rule, as a pure function. No network, no
  database, no token. It takes the mode, the acting tenant, its scopes, the
  scope required, and the tenant that owns the target, and returns
  allow/deny plus a reason. Everything around it is plumbing.
- `convex/lib/seam.ts` — the single door. Fixed order: verify the token,
  resolve the mode from server state, find who owns the record, decide, write
  the audit row, answer. Every non-allow exit runs through one `refuse` helper,
  so there is no path that returns data without a recorded decision.
- `convex/settings.ts` — the isolation mode, held server-side. An operator row
  wins, then the deployment environment, then `per-org`. Both functions are
  internal, so no worker and no browser can set it.
- `convex/audit.ts` — one row per decision, written *before* the caller is
  answered so a client that hangs up cannot lose a refusal.
- `convex/resources.ts` — added `seamLoad*` and `seamWrite`, which deliberately
  do not check ownership. They exist so the seam can learn who owns a record and
  then make the decision itself, in one place.
- `/tools/resource.write` added, so scope is enforced against something real.
- `scripts/repro-cross-tenant.ts` (`pnpm repro:cross-tenant`).

**Decisions**

- The checks run boundary-outwards: tenant first, then permission. A
  cross-tenant call with the wrong scope reports `cross_org`, because the tenant
  boundary is the more serious of the two.
- `shared` skips both checks rather than only the org check. The shortcut being
  modelled is one credential for the whole swarm, and such a credential belongs
  to no tenant and carries every permission, so neither check has anything to
  bite on.
- A request may name `targetOrgCode` to reach for another tenant. Naming a
  tenant grants nothing — it only states what is being reached for, and the seam
  still decides. This is what the two modes disagree about.
- `x-correlation-id` and `x-worker-label` are tracing labels only and never
  reach the decision. Every response carries the correlation id back, including
  refusals.
- Token failures are audited too, attributed to `unknown`. There is no verified
  tenant to attribute them to, and inventing one would put a fiction in the
  trail.
- The mode is changed by an operator through the Convex CLI, not over HTTP.
  That is what keeps it server-decided.

**Checked live, before saving**

`pnpm repro:cross-tenant` against the cloud deployment — 12 checks, all passing.
The same worker, the same record, the same call, twice:

- **shared** — tenant A reads tenant B's `merger-notes` and gets
  `Tenant B - confidential, not for distribution`, HTTP 200, `crossOrg: true`.
  The audit row is `allow / cross_org_allowed`, actor `org_2606b8199462b`,
  target `org_364dd8200a3d3`. The breach is recorded as it happens.
- **per-org** — identical call, `HTTP 403 cross_org`, body
  `{"ok":false,"reason":"cross_org","correlationId":"2f0f21d6-…","isolationMode":"per-org"}`.
  No tenant B content. Audit row `deny / cross_org` under the same correlation
  id.
- **least privilege** — a `resource:read` worker writing to its *own* tenant is
  refused `insufficient_scope`; the `resource:write` worker succeeds; the write
  worker reaching into tenant B is refused `cross_org`. All three land on one
  correlation id, in order: `deny/insufficient_scope, allow/ok, deny/cross_org`.

Two modes differing on a byte-identical call is the proof that the check is
load-bearing, not decoration.

`convex/decide.test.ts` adds 10 unit tests over the rule itself, including that
only an exact `shared` is shared — `""`, `"sharedd"`, `"off"`, `"0"`, `null` and
`undefined` all resolve to `per-org`.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (16/16) and `pnpm build` clean.

**A regression found and fixed during the gate**

The first run of `repro:cross-tenant` broke `verify:auth`. Not a seam fault: the
repro's successful write overwrote a seeded record, so a later assertion about
seed content failed. The script now records the original content and restores it
however the run ends. Both scripts were then run in both orders, twice, and pass
independently. A proof script that leaves the data different from how it found
it makes the next script lie.

**Open**

- Kinde's 24 hour token lifetime, still outstanding from phase 2.
