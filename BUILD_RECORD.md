# Build record

A single consolidated account of this build: what was made, what broke, what
turned out to be untrue, and what was proved live at each step.

Compiled from `BUILD_LOG.md`, the git history, and the working tree. Everything
here is drawn from committed artefacts and recorded verification output rather
than from memory, so figures and quotations are the real ones.

---

## 1. What this is

A working demo of multi-tenant isolation for AI agent swarms.

A swarm of Kimi K3 agents runs for a platform with three tenants. Each agent
authenticates as its own organization-scoped Kinde machine-to-machine
application. A single enforcement point decides every call. The demo runs in
one of two modes, and the mode is the only thing that changes between a leak
and a containment:

| Mode | Agent identity | Cross-tenant reach |
| --- | --- | --- |
| `shared` | One credential for the whole swarm | Permitted. The data leaks. |
| `per-org` | One credential per tenant | Refused `403 cross_org`, and recorded. |

There is also a kill switch: suspend one tenant and its agents stop, while the
other tenants continue.

**Size:** roughly 5,100 lines across `convex/` (2,414), `swarm/` (998),
`scripts/` (927) and `app/` (783). Nine commits.

---

## 2. Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4) — landing page and
  operator console.
- **Convex** — database, backend functions, and the reactive timeline that
  streams each agent step to the browser. Runs as a cloud deployment
  (`fastidious-warthog-135`).
- **Kinde** — organizations as tenants, one M2M application per agent role per
  tenant, and the Management API behind the kill switch.
- **Kimi K3** via the Moonshot API — the model driving the agents. Python
  service, orchestrator plus three workers.

---

## 3. The build, in order

### Phase 0 — Scaffold

Next.js, Convex, `jose`, `convex-test`, Vitest. Two rules set here shaped
everything after:

1. `ISOLATION_MODE` is read from the deployment only.
2. Anything other than an explicit `shared` resolves to `per-org`.

The health endpoint reports which subsystems are configured as **booleans, never
values**, so it stays safe to expose.

**Proved:** `GET /api/health` returned `isolationMode: "per-org"` while no
`ISOLATION_MODE` was set anywhere — the fail-closed default demonstrating
itself rather than being asserted.

### Phase 1 — Data model and the boundary

Tables: `tenants`, `workers`, `resources`, `runs`, `runEvents`, `auditLog`, and
later `settings`. `orgCode` is the tenancy key on every tenant-owned table and
holds the Kinde `org_code` claim.

`convex/lib/tenancy.ts` holds the boundary in one small file. `requireSameOrg`
re-checks ownership **after** the load, which is what makes a stolen or guessed
document id useless.

Every data accessor is `internal`. Nothing public accepts an `orgCode`
argument, so no browser or agent can call in naming a tenant of its choosing.

**Proved:** six tests. Then the suite was **mutation-tested** — the ownership
check was deleted from `requireSameOrg` and the tests re-run. Exactly the three
cross-tenant tests failed and the other three kept passing. Restoring returned
6/6. A green suite that cannot fail when the boundary breaks proves nothing;
this one fails.

### Phase 2 — Kinde token verification

`convex/lib/kindeToken.ts` verifies a bearer token against Kinde's JWKS and
returns the identity it proves. Signature, issuer, audience and expiry all
checked. RS256 pinned, so a sender cannot choose a weaker algorithm. A token
carrying no `org_code` is refused rather than guessed at.

**A risk flagged before building, then settled by measurement.** The demo
depends on M2M access tokens carrying an `org_code` claim, and Kinde M2M apps
authenticate as an application rather than as a user in an organization. Rather
than build twelve applications and discover the claim missing, one was made and
its token decoded. The claim was present, and all six tenant applications came
back correct:

```
TENANT_A_READER  org_2606b8199462b  resource:read
TENANT_A_WRITER  org_2606b8199462b  resource:write
TENANT_B_READER  org_364dd8200a3d3  resource:read
TENANT_B_WRITER  org_364dd8200a3d3  resource:write
TENANT_C_READER  org_0c39cb2010b01  resource:read
TENANT_C_WRITER  org_0c39cb2010b01  resource:write
```

**Proved:** 14 live checks. The central one: tenant A, holding a *real* id for
tenant B's `merger-notes` record obtained from tenant B's own authorised
listing, was refused `403 cross_org` with body
`{"ok":false,"reason":"cross_org"}`. Tenant B then read that same record through
the same code path, so the refusal was about ownership and not a broken read.

Two checks matter more than the other twelve: a token with **one character
flipped in the signature**, and a token whose **`org_code` was edited to tenant
B**. Both refused. Had verification been skipped, both would have returned 200.

### Phase 3 — One seam, one rule, two modes

`convex/lib/decide.ts` holds the rule as a pure function — no network, no
database, no token — so it can be tested exhaustively. `convex/lib/seam.ts` is
the single door around it: verify the token, resolve the mode from server state,
find who owns the record, decide, write the audit row, answer.

Checks run boundary-outwards: tenant first, then permission. A cross-tenant call
with the wrong scope reports `cross_org`, because the tenant boundary is the
more serious failure.

`shared` skips **both** checks, not only the tenant one. The shortcut being
modelled is one credential for the whole swarm, and such a credential belongs to
no tenant and carries every permission.

**Proved:** the same worker, the same record, a byte-identical call, twice.

- `shared` → 200, content `Tenant B - confidential, not for distribution`,
  audit `allow / cross_org_allowed`, actor `org_2606b8199462b`, target
  `org_364dd8200a3d3`.
- `per-org` → `403 cross_org`, correlation id returned, no content, audit
  `deny / cross_org` under the same id.

Least privilege inside a tenant held too, all three on one correlation id:
`deny/insufficient_scope, allow/ok, deny/cross_org`.

### Phase 4 — The Kimi K3 swarm

An orchestrator splits the goal; two readers and one writer run with their own
tokens. Workers never touch the database — they call tool endpoints, and the
seam judges them.

The swarm **never reads the isolation mode from configuration**. It opens a run
and the backend reports which mode it is in. An agent that could read the mode
is one step from choosing it.

**Proved:** same code, same prompts, only the server's mode differing.

- `shared`: a reader made two cross-tenant calls, both permitted, and reported:
  *"Collected invoice-001 from all three organizations: Tenant A: 1,200.00;
  Tenant B: 9,900.00; Tenant C: 450.00. The consolidated total is 11,550.00."*
  Two other tenants' real figures, taken by an agent that should never have seen
  them.
- `per-org`: a reader reached for the same two tenants, was refused both times,
  and reported it accurately: *"read refused with reason `cross_org` — per-org
  isolation prevents me from accessing Tenant B's invoice."*
- The audit for that run tallied 42 `ok` and exactly 2 `cross_org` denials,
  naming both target organizations and the worker that tried.

The reach is **not scripted**. The agents receive a platform-wide goal and a
tool parameter for naming an organization. Whether they reach across is theirs
to decide; what happens when they do is the server's.

### Phase 5 — The kill switch

**The plan's central assumption was wrong, and checking took five minutes.**

The plan expected that suspending a Kinde organization would stop its agents,
their tokens being refused or invalidated. Measured before anything was built on
it:

```
suspend Tenant C   ->  is_suspended: true
token endpoint     ->  HTTP 200      (still issues M2M tokens)
```

Kinde suspension governs **people signing in**. Machine credentials are
application-level and keep working, and tokens already issued stay
cryptographically valid until they expire — nothing recalls them. A kill switch
resting on that assumption would have looked correct in a demo and stopped
nothing.

So suspension became part of the decision rule, checked on **every call**, and
before the mode is consulted, so it applies in `shared` too. A kill switch that
only worked in the enforcing mode would be no kill switch at all, because the
leaky mode is exactly when a swarm most needs stopping.

The Management API module refuses to act on any organization outside this
deployment's three tenants — the Kinde account holds unrelated organizations,
and a wrong code should not be able to suspend one.

**Proved:** 10 deterministic checks, then the live version. Two real swarms
running, one tenant suspended twelve seconds in:

```
tenant A audit: {"ok": 2, "organization_suspended": 17}
tenant B audit: {"ok": 39}
tenant B run status: completed
```

Tenant A did real work, then stopped where it stood. Tenant B never noticed.

### Phase 6 — Console and live timeline

Landing page plus an operator console: isolation switch at the top, tenant
picker, run and kill-switch buttons, five metrics, live timeline, audit trail
underneath.

`convex/public.ts` is the only public surface in the codebase, and it exposes
**telemetry only — never tenant records**. The console cannot become a second
way to read what the seam protects.

**Proved in a browser**, all three beats across two tenants:

- **Leak** — `shared`, Tenant A. `ESCAPES 2`, tile turning red, timeline line
  `read_resource CROSSED into org_0c39cb2010b01 and was allowed`.
- **Contain** — `per-org`, Tenant B. `CROSS-ORG ATTEMPTS 2, BLOCKED 2,
  ESCAPES 0`, with `read_resource refused: cross_org` inline.
- **Kill** — run started, switch thrown mid-flight. Tenant chip → `suspended`,
  `BLOCKED` climbed to 21, timeline froze with an explanation.

### Phase 7 — Production pass

Stuck runs closed by the kill switch, the writer no longer invents record ids,
loading states distinguished from zero, copy rewritten to simplified technical
English, and a fail-closed test added for unknown tenants. 23 tests.

---

## 4. Every mistake, collected

The useful part. In order of when it bit.

### Repository created in the wrong place

The build plan named an organization, so the repo went there. It should have
been the user's own account. It had to be deleted and recreated, and the token
lacked `delete_repo` scope, so the user deleted it. **Lesson:** the plan named
a destination; the person had a different one in mind. Ask when creating
something outward-facing.

### Assuming Convex needed an account

The first attempt at codegen failed with "No CONVEX_DEPLOYMENT set". Convex
turned out to support anonymous local deployments, so no account was needed to
develop or test. Later moved to cloud on request.

### `convex-test` module glob

The documented `import.meta.glob("./**/!(*.*.)*.*s")` pattern silently matched
nothing, because Vite dropped extglob support. Fixed with explicit include and
exclude patterns. **Failure mode:** the tests did not fail with "no tests" — they
failed with "Could not find the `_generated` directory", which points somewhere
else entirely.

### `path` is a reserved variable in zsh

A shell loop using `for path in ...` overwrote `PATH` and produced
`command not found: curl`. Three seconds of confusion, worth knowing.

### kimi-k3 rejects any temperature but its default

The first swarm run failed on all three workers:
`invalid temperature: only 1 is allowed for this model`. Worse, the retry path
blamed the reasoning-effort hint and retried into a second failure. Now the
retry checks what the API actually objected to, and the planner prints why it
fell back instead of swallowing the error. **Lesson:** a fallback that hides its
reason turns one bug into two.

### The write worker was given tools it could never use

`writer-1` made 8 calls and had all 8 refused with `insufficient_scope` and
`not_found`. Its token carries `resource:write` only, and it had been handed
read tools. Each worker now gets only the tools its scope permits, and the
orchestrator looks up the write target with the reader identity and passes the
id. **This is what least privilege actually costs**, and pretending otherwise
produced eight refusals that taught nobody anything.

### The swarm poisoned its own source data

A run wrote its summary into `invoice-001` — the record the readers read. The
next run read that text and obeyed it, reporting that consolidation "is not
authorized". The demo had quietly become a feedback loop. Each tenant now has a
separate `consolidated-summary` record as the only write target.

### Parallel workers and TLS

Concurrent workers sharing connections produced intermittent
`SSLV3_ALERT_BAD_RECORD_MAC`. Each thread now holds its own pooled session with
connection-level retries. **4xx is never retried**, because a refusal is an
answer, not a fault.

### Model concurrency

Six workers against an account allowing three requests in flight produced HTTP
429s that damaged both runs of the first mid-run kill test. Calls are now gated
by a semaphore and rate limits retried with backoff — a rate limit is a "not
now", not a "no".

### The writer had nothing to write

All three workers ran in parallel, so the writer, holding `resource:write` and
no read tools, never saw the readers' findings and said so plainly: *"I cannot
complete this task as specified… there is no read tool, so I have no way to
retrieve the readers' findings."* Readers now run first and hand over results.

### A proof script that corrupted the next proof script

`repro:cross-tenant` wrote to a seeded record, which broke `verify:auth`'s
content assertion on the following run. The repro now restores what it writes.
**A proof script that leaves the data different from how it found it makes the
next script lie.**

### The bundler followed a symlink out of the project

`pnpm build` failed with `Symlink [project]/.venv/bin/python is invalid`.
Turbopack statically resolves interpreter paths written as literals. Three
attempts were needed: removing `path.join(process.cwd(), …)` was not enough,
because the literal string itself was still resolved. The path is now assembled
from segments at run time.

### Auto-scroll that moved the page

The timeline used `scrollIntoView`, which walks up the tree and scrolls the
**page**, not just the list. While a run streamed, the controls moved out from
under the pointer — **the kill switch was genuinely missed on the first
attempt** because the button had shifted mid-click. Only clicking in a real
browser surfaced this.

### A run stuck at "running" for ever

A suspended tenant cannot close its own run, because the finish endpoint is
behind the same seam now refusing it. The run sat at `running`, which reads as
still working when it is dead. The kill switch now closes them.

### The writer invented a record id

When its lookup was refused, the writer fabricated `invoice-summary-tenant-a`
and got `bad_request`. Saying nothing left a gap for it to fill. The task now
names the absence explicitly and tells it not to invent one.

### Not a bug: Dark Reader

A hydration mismatch and a button that appeared to lose its fill both traced to
the Dark Reader extension rewriting the page. Computed styles confirmed the CSS
was correct. Worth knowing before debugging your own code for an hour.

---

## 5. Two findings worth the article on their own

**1. Kinde M2M tokens carry `org_code`, but organization suspension does not
stop them.** These two facts together are the whole design. The first makes
per-tenant agent identity possible. The second means identity alone cannot
revoke anything, because a JWT already issued cannot be recalled. Enforcement
has to be checked server-side on every call. A demo built on the assumption
would have appeared to work.

**2. Model behaviour is genuinely variable, and that is the honest part.** In
one `shared` run the agents did not attempt a cross-tenant read at all, and hit
the turn limit before summarising. The fix was not to script the reach — it was
to give the workers enough turns and a clearly split goal, then let them decide.
The demo shows what agents do, not what they were told to do.

---

## 6. What is not done

- **Token lifetime is 24 hours.** The Management API application is scoped to
  organizations, and `GET /api/v1/applications` returns `403`, so it cannot be
  changed from code. It is a per-application dashboard setting. Its significance
  is smaller than expected: because suspension never invalidated tokens, a
  shorter lifetime would not have made the kill switch work. What it still buys
  is a smaller window on a token that leaks another way.
- **The console has no operator login.** The isolation switch and kill switch
  are public functions. A worker cannot reach them, but anyone with the
  deployment URL could. The demo is meant to be run locally, and a real
  deployment would put an operator login in front.
- **Phase 9** — the README with setup and deployment notes.

---

## 7. File map

```
convex/
  schema.ts            Tables. orgCode is the tenancy key on each.
  lib/decide.ts        The rule, as a pure function.
  lib/seam.ts          The single door every tool call passes through.
  lib/kindeToken.ts    JWKS verification; returns the identity a token proves.
  lib/kindeManagement.ts  Management API; guarded to this deployment's tenants.
  lib/tenancy.ts       Ownership re-check after load.
  http.ts              Tool endpoints and run bookkeeping.
  settings.ts          The isolation mode, server-side only.
  audit.ts             One row per decision, allow and deny alike.
  runs.ts              Runs and their events.
  tenants.ts           Suspension state the seam reads.
  killSwitch.ts        Suspend, unsuspend, sync.
  public.ts            The only public surface. Telemetry, never records.

swarm/
  identity.py          One M2M application per role per tenant.
  backend.py           The only way an agent reaches data.
  kimi.py              Moonshot client, concurrency-gated.
  worker.py            The agent loop.
  orchestrator.py      Planning and fan-out.

scripts/
  verify-kinde-auth.ts     Phase 2 gate, 14 checks.
  repro-cross-tenant.ts    Phase 3 gate, 12 checks.
  kill-switch.ts           Phase 5 gate, 10 checks, no model calls.
  kill-mid-run.ts          Phase 5 gate, live, two swarms.
  e2e-narrative.ts         The whole arc in one pass, audit rows matched.

app/
  page.tsx             Landing.
  console/             The console.
  api/swarm/route.ts   Starts a run.
```

---

## 8. Commit history

```
fd9984e  scaffold Next.js + Convex with fail-closed config
6699131  enforce owner-only authorship with a commit-msg hook
a7c7319  tenant data model and the isolation boundary
d278137  verify Kinde tokens and take the tenant from the token
65040e6  one seam, one rule, two modes
7b2ae45  the Kimi K3 swarm, each worker with its own identity
a112950  the kill switch, enforced where it actually bites
b025405  add the console: live timeline, mode switch and kill switch
dc47a1c  scroll the timeline list instead of the page
```

`BUILD_LOG.md` holds the per-phase detail, including the verification output
quoted above.
