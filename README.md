# Swarm isolation demo

A swarm of Kimi K3 agents works for three customers at the same time. Each customer is a tenant. This demo shows one agent reading another tenant's private records, then shows the server refusing the same call.

The idea is small. An agent proves nothing about itself. It presents a token, Kinde signs that token, and the token names one tenant. The server compares the tenant on the token against the tenant that owns the record, on every call. A token minted for one tenant cannot read another, because the server checks, not because the agent behaves.

![Flow of one agent call. Three Kimi K3 agents for Tenant A each exchange their own client credentials at Kinde for a token that carries an org_code claim and one scope. The agent calls a tool endpoint over HTTP, never the database. One function then runs four checks in a fixed order: signature against the Kinde JWKS, tenant suspension, org_code against the record owner, and required scope. Each check has one refusal: 401 invalid_token, 403 organization_suspended, 403 cross_org, and 403 insufficient_scope. In shared mode the third check instead permits the call and returns 200 cross_org_allowed, which reaches Tenant B and C records. A pass returns 200 ok and reaches Tenant A records. Every outcome writes one audit row before the caller is answered, carrying a correlationId.](article-assets/diagram.png)

Every agent call passes through one function. That function is the only place a call is allowed or refused, and the only place the audit trail is written.

## The two modes

The server holds the mode. No agent and no browser can set it. Any value that is not exactly `shared` resolves to `per-org`, so a wrong value fails into the enforcing mode.

The numbers below come from two Kimi K3 runs against the same three tenants, with the same prompt and the same records. Only the mode differed.

| | `shared` | `per-org` |
| --- | --- | --- |
| Agent identity | One credential for the whole swarm | One credential for each tenant |
| Token carries `org_code` | Not used | Checked on every call |
| Token carries a scope | Not used | Checked on every call |
| Cross-tenant read | The server permits it | The server refuses it, `403 cross_org` |
| Agents in the run | 3 | 3 |
| Tool calls | 6 | 11 |
| Cross-tenant attempts | 2 | 2 |
| Calls the server refused | 0 | 2 |
| **Cross-tenant reads that succeeded** | **2** | **0** |
| What the reading agent reported | "Collected invoice-001 from all three organizations: Tenant A: 1,200.00; Tenant B: 9,900.00; Tenant C: 450.00." | "The reads against Tenant A and Tenant C were refused with reason cross_org, so I did not retry." |

The agent did not change between those runs. The prompt did not change. The identity it carried changed.

## Decisions the server returns

The server writes one audit row for each decision, and returns the reason to the caller with a correlation id. It writes the row before it answers, so a client that disconnects cannot lose a refusal.

| Reason | HTTP | The server returns this when | Modes |
| --- | --- | --- | --- |
| `ok` | 200 | The caller reads or writes a record its own tenant owns. | both |
| `cross_org_allowed` | 200 | The caller reaches another tenant's record and the mode permits it. The audit row names both tenants. | `shared` |
| `cross_org` | 403 | The caller reaches another tenant's record. | `per-org` |
| `insufficient_scope` | 403 | The token does not carry the scope the action needs. | `per-org` |
| `not_found` | 403 | No such record inside the caller's own tenant. | both |
| `organization_suspended` | 403 | The tenant is suspended. Checked before the mode, so it stops a swarm in both modes. | both |
| `missing_token` | 401 | The request carries no `Authorization` header. | both |
| `malformed_token` | 401 | The header is present but is not a bearer token. | both |
| `invalid_token` | 401 | The signature does not check out, or the token is malformed. | both |
| `token_expired` | 401 | The token passed its expiry time. | both |
| `wrong_audience` | 401 | The `aud` claim does not match the registered API. | both |
| `wrong_issuer` | 401 | The `iss` claim does not match the Kinde domain. | both |
| `missing_org_code` | 401 | The token carries no `org_code` claim, so it names no tenant. | both |
| `server_misconfigured` | 401 | The deployment has no issuer or audience set, so it can check nothing. | both |

## What you need

- Node 22 or later, and pnpm
- Python 3.11 or later
- A Kinde account
- A Convex account, or no account if you use a local deployment
- A Moonshot API key for Kimi K3

## Set up Kinde

Create one API. Name it `Swarm Demo API`, set the audience to `swarm-demo-api`, and add two scopes: `resource:read` and `resource:write`.

Create three organizations, named `Tenant A`, `Tenant B` and `Tenant C`. Kinde gives each one a code. Write the three codes down. The codes are identifiers, not secrets.

Create six machine-to-machine applications, two inside each organization. Authorize each one against `Swarm Demo API`, and give each one a single scope.

| Organization | Application | Scope |
| --- | --- | --- |
| Tenant A | `Tenant A Reader` | `resource:read` |
| Tenant A | `Tenant A Writer` | `resource:write` |
| Tenant B | `Tenant B Reader` | `resource:read` |
| Tenant B | `Tenant B Writer` | `resource:write` |
| Tenant C | `Tenant C Reader` | `resource:read` |
| Tenant C | `Tenant C Writer` | `resource:write` |

Create one more application for the Management API. Name it `Swarm Demo Management`, and give it `read:organizations` and `update:organizations`. The kill switch uses this application.

## Configure the environment

Copy the example file, then fill it in.

```bash
cp .env.example .env.local
```

| Variable | Holds |
| --- | --- |
| `KINDE_ISSUER_URL` | Your Kinde domain, with no slash at the end |
| `KINDE_AUDIENCE` | `swarm-demo-api` |
| `KINDE_M2M_TOKEN_URL` | Your Kinde domain, then `/oauth2/token` |
| `KINDE_ORG_TENANT_A`, `_B`, `_C` | The three organization codes |
| `KINDE_M2M_TENANT_{A,B,C}_{READER,WRITER}_CLIENT_ID` | Six client ids |
| `KINDE_M2M_TENANT_{A,B,C}_{READER,WRITER}_CLIENT_SECRET` | Six client secrets |
| `KINDE_MGMT_CLIENT_ID`, `KINDE_MGMT_CLIENT_SECRET` | The Management API application |
| `KIMI_MODEL`, `KIMI_BASE_URL`, `KIMI_API_KEY` | Kimi K3 access |
| `KIMI_REASONING_EFFORT` | `low`, `high` or `max`. Defaults to `low` |
| `SWARM_PYTHON` | The Python interpreter the console starts. Defaults to `.venv/bin/python` |

Git ignores `.env.local`. Do not commit it.

The Convex functions read their own environment, so `.env.local` does not reach them. Set those values once:

```bash
npx convex env set KINDE_ISSUER_URL https://YOUR-DOMAIN.kinde.com
npx convex env set KINDE_AUDIENCE swarm-demo-api
npx convex env set ISOLATION_MODE per-org
npx convex env set KINDE_ORG_TENANT_A org_xxxxxxxx
npx convex env set KINDE_ORG_TENANT_B org_xxxxxxxx
npx convex env set KINDE_ORG_TENANT_C org_xxxxxxxx
```

## Install and run

```bash
pnpm install
python3 -m venv .venv
./.venv/bin/pip install -r swarm/requirements.txt
```

Start Convex. The command writes `CONVEX_DEPLOYMENT` and the two Convex URLs into `.env.local`, and offers a local deployment if you have no Convex account.

```bash
npx convex dev
```

Load the demo data, then start the web app:

```bash
pnpm seed
pnpm dev
```

Open `http://localhost:3000`. The console is at `/console`. Pick a tenant, start a swarm, and watch each agent step arrive.

Run a swarm from the command line instead:

```bash
pnpm swarm --tenant A
```

## Verify it

Each script checks one part of the build against the live services. Each script exits non-zero if a check fails, and each one restores the deployment before it ends.

| Command | Checks | What it proves | Model calls |
| --- | --- | --- | --- |
| `pnpm test` | 23 | The data layer isolates tenants, and an unknown tenant counts as suspended. | No |
| `pnpm verify:auth` | 14 | The server takes the tenant from the token. It refuses a token with one changed character in the signature, and a token whose `org_code` was edited. | No |
| `pnpm repro:cross-tenant` | 12 | The same call succeeds in `shared` and returns `403 cross_org` in `per-org`. Least privilege holds inside a tenant. | No |
| `pnpm kill-switch` | 10 | A token held before suspension stops working at once. Other tenants keep running. | No |
| `pnpm e2e --no-swarm` | 19 | The whole story in one pass, with the audit rows matched to each beat. | No |
| `pnpm e2e` | 21 | The same, plus one real Kimi K3 swarm. | Yes |
| `pnpm kill-switch:live` | 6 | Two real swarms run, and one tenant is suspended mid-run. | Yes |

Start with `pnpm e2e --no-swarm`. It walks the whole arc and costs nothing.

The unit tests carry one result worth naming. Delete the ownership check from `convex/lib/tenancy.ts` and run `pnpm test` again: exactly three of the six tenancy tests fail, and they are the three cross-tenant tests. Restore the check and all six pass. A suite that cannot fail when the boundary breaks proves nothing.

## What this build proves, and what it does not

**Kinde M2M tokens carry an `org_code` claim.** All six applications returned a token naming their own organization and holding exactly one scope. That claim is what makes one identity per tenant possible.

**Suspending a Kinde organization does not stop its M2M agents.** This was measured before anything was built on it:

```
suspend Tenant C   ->  is_suspended: true
token endpoint     ->  HTTP 200      (Kinde still issues M2M tokens)
```

Suspension governs people who sign in. It does not stop the client-credentials flow, and a token already issued stays valid until it expires, because nothing recalls a JWT. So the kill switch does not rest on suspension alone. The server reads suspension state on every call and refuses. That check is what ends a run in progress.

With two swarms running and one tenant suspended twelve seconds in, the audit recorded this:

```
tenant A: {"ok": 2, "organization_suspended": 17}
tenant B: {"ok": 39}                                run status: completed
```

Tenant A did real work, then stopped. Tenant B finished normally and was never refused.

**Kinde issues these tokens with a 24 hour lifetime.** Change the lifetime for each application in the Kinde dashboard. A shorter lifetime does not make the kill switch work, because suspension never invalidated tokens. It reduces the damage from a token that leaks some other way.

**The console has no operator login.** The mode switch and the kill switch are public Convex functions. No agent can reach them, because agents hold Kinde tokens and call only the tool endpoints. Anyone who knows the deployment URL can. Run this demo on your own machine, and put a login in front of those functions for anything real.

**This build runs three agents, not three hundred.** Moonshot's Agent Swarm runs up to 300 sub-agents. The pattern does not change with scale, because the server checks one call at a time. The operational load does change. Four thousand tool calls produce four thousand audit rows, and those rows need somewhere to go.

**The agents choose their own actions, so runs differ.** In one `shared` run the agents did not reach across a tenant boundary at all. Nothing here scripts the reach. `pnpm e2e` asserts the server's decisions exactly, and reports what the agents did as information.

**The console starts a local process.** The `/api/swarm` route runs the Python swarm on the machine that serves the web app. This works locally. It does not work on a serverless host, so run the swarm with `pnpm swarm` in that case.

## How the code is laid out

```
convex/
  lib/decide.ts          The rule, as a pure function. No network, no database.
  lib/seam.ts            The single door. Every agent call passes through it.
  lib/kindeToken.ts      Checks a token against the Kinde JWKS.
  lib/kindeManagement.ts The Kinde Management API, for the kill switch.
  lib/tenancy.ts         Checks record ownership after a load.
  http.ts                The tool endpoints agents call.
  settings.ts            The isolation mode, held server-side.
  audit.ts               One row for each decision.
  runs.ts, tenants.ts    Runs, run events, suspension state.
  public.ts              The only public surface. Telemetry, never records.

swarm/
  identity.py            One Kinde application per role per tenant.
  backend.py             The only way an agent reaches data.
  kimi.py                The Moonshot client.
  worker.py              One agent: think, call a tool, react, report.
  orchestrator.py        Splits the goal, runs the agents.

app/
  page.tsx               Landing page.
  console/               The console, with the live timeline.
  api/swarm/route.ts     Starts a run.

scripts/                 The verification scripts in the table above.
```

## Regenerate the diagram

The diagram source is `article-assets/diagram.mmd`. Edit it, then run:

```bash
pnpm diagram
```

The script calls the Mermaid CLI through `npx`, so nothing is added to the dependency tree. It writes `article-assets/diagram.png` at 1800 CSS pixels wide and scale 3.

## More

`CHANGELOG.md` lists the changes. `AGENTS.md` holds the rules for anyone, or anything, writing code here.
