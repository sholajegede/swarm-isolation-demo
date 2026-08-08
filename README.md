# Swarm isolation demo

An AI agent swarm reaches across tenant boundaries. Kinde organization-scoped
identity stops it.

A swarm is a group of AI agents that work at the same time. Each customer is a
tenant. This demo runs a swarm of Kimi K3 agents for three tenants. Each agent
authenticates as its own Kinde machine-to-machine application. One server
component decides every call the agents make.

The demo runs in one of two modes. The mode is the only difference between a
leak and a containment.

| Mode | Agent identity | Result of a cross-tenant call |
| --- | --- | --- |
| `shared` | One credential for the whole swarm | The server permits the call. The data leaks. |
| `per-org` | One credential for each tenant | The server refuses the call with `403 cross_org`. |

The demo also has an emergency stop. You suspend one tenant, and its agents
stop. The other tenants continue to work.

## What you can watch

Open the console and try three things:

1. **Leak.** Select `shared`. Run a swarm. An agent reads another tenant's data.
2. **Contain.** Select `per-org`. Run the same swarm. The server refuses the
   same call and records it.
3. **Stop.** Start a run. Press the kill switch. That tenant stops. The others
   continue.

The agents are real. They decide their own actions. Nobody scripts the reach
across a tenant boundary.

## How the parts fit

Three services do three jobs:

- **Kinde** proves who each agent is. One organization holds one tenant. One
  machine-to-machine application holds one agent role in one tenant.
- **Convex** stores the data, decides each call, and streams each step to the
  browser.
- **Kimi K3** drives the agents. The agents decide what to do.

Short version: Kimi K3 decides, Kinde proves, Convex enforces and records.

Read `HOW-IT-WORKS.md` for the full explanation in plain words.

## Requirements

- Node 22 or later, and pnpm
- Python 3.11 or later
- A Kinde account
- A Convex account, or no account if you use a local deployment
- A Moonshot API key for Kimi K3

## Set up Kinde

Create these items in the Kinde dashboard.

**One API**

- Name: `Swarm Demo API`
- Audience: `swarm-demo-api`
- Scopes: `resource:read` and `resource:write`

**Three organizations**

Name them `Tenant A`, `Tenant B` and `Tenant C`. Kinde gives each one a code.
Write the three codes down. The codes are not secrets.

**Six machine-to-machine applications, two in each organization**

| Organization | Application | Scope |
| --- | --- | --- |
| Tenant A | `Tenant A Reader` | `resource:read` |
| Tenant A | `Tenant A Writer` | `resource:write` |
| Tenant B | `Tenant B Reader` | `resource:read` |
| Tenant B | `Tenant B Writer` | `resource:write` |
| Tenant C | `Tenant C Reader` | `resource:read` |
| Tenant C | `Tenant C Writer` | `resource:write` |

Authorize each application against `Swarm Demo API`. Give each one a single
scope. Least privilege is part of what the demo shows.

**One Management API application**

- Name: `Swarm Demo Management`
- Scopes: `read:organizations` and `update:organizations`

The kill switch uses this application.

## Install

```bash
pnpm install
python3 -m venv .venv
./.venv/bin/pip install -r swarm/requirements.txt
```

## Configure

Copy the example file, then fill it in.

```bash
cp .env.example .env.local
```

Set these values in `.env.local`:

- `KINDE_ISSUER_URL` is your Kinde domain, with no slash at the end.
- `KINDE_AUDIENCE` is `swarm-demo-api`.
- `KINDE_M2M_TOKEN_URL` is your Kinde domain, then `/oauth2/token`.
- `KINDE_ORG_TENANT_A`, `_B` and `_C` are the three organization codes.
- The twelve client id and client secret values, two for each application.
- `KINDE_MGMT_CLIENT_ID` and `KINDE_MGMT_CLIENT_SECRET`.
- `KIMI_MODEL`, `KIMI_BASE_URL` and `KIMI_API_KEY`.

Git ignores `.env.local`. Do not commit it.

## Start Convex

```bash
npx convex dev
```

This command writes `CONVEX_DEPLOYMENT` and the two Convex URLs into
`.env.local`. It offers a local deployment if you have no Convex account.

The Convex functions read their own environment. Set it once:

```bash
npx convex env set KINDE_ISSUER_URL https://YOUR-DOMAIN.kinde.com
npx convex env set KINDE_AUDIENCE swarm-demo-api
npx convex env set ISOLATION_MODE per-org
npx convex env set KINDE_ORG_TENANT_A org_xxxxxxxx
npx convex env set KINDE_ORG_TENANT_B org_xxxxxxxx
npx convex env set KINDE_ORG_TENANT_C org_xxxxxxxx
```

Then load the demo data:

```bash
pnpm seed
```

## Run it

Start the web app:

```bash
pnpm dev
```

Open `http://localhost:3000`. The console is at `/console`.

Run a swarm from the command line instead:

```bash
pnpm swarm --tenant A
```

## Prove it

Each script checks one part of the demo against the live services. Each script
exits non-zero if a check fails.

| Command | What it proves | Model calls |
| --- | --- | --- |
| `pnpm test` | The data layer isolates tenants. 23 unit tests. | No |
| `pnpm verify:auth` | The server takes the tenant from the token, and refuses edited tokens. 14 checks. | No |
| `pnpm repro:cross-tenant` | The same call leaks in `shared` and fails in `per-org`. 12 checks. | No |
| `pnpm kill-switch` | A suspended tenant stops at once. Other tenants continue. 10 checks. | No |
| `pnpm kill-switch:live` | The same, with two real swarms running. | Yes |
| `pnpm e2e` | The whole story in one pass, with the log entries matched. | Yes |
| `pnpm e2e --no-swarm` | The same, without the swarm run. | No |

Start with `pnpm e2e --no-swarm`. It runs the whole arc and costs nothing.

## Commands

| Command | Action |
| --- | --- |
| `pnpm dev` | Start the web app |
| `pnpm build` | Build the web app |
| `pnpm test` | Run the unit tests |
| `pnpm typecheck` | Check the types |
| `pnpm lint` | Check the code style |
| `pnpm seed` | Load the demo data again |
| `pnpm swarm --tenant A` | Run one swarm from the command line |

## How the server decides

Every agent call goes through one function in `convex/lib/seam.ts`. The order is
fixed:

1. The server checks the token against the Kinde public keys.
2. The server checks whether the tenant is suspended.
3. The server finds which tenant owns the record.
4. The server applies the rule in `convex/lib/decide.ts`.
5. The server writes one audit row.
6. The server answers the agent.

The server writes the audit row before it answers. A client that disconnects
cannot lose a refusal.

The agents never reach the database. They call tool endpoints over HTTP with
their own token. The request body chooses the record. The token decides the
tenant.

## Two facts that shape the design

**Kinde machine-to-machine tokens carry an `org_code` claim.** This claim makes
one identity for each tenant possible.

**Kinde organization suspension does not stop those tokens.** Suspension governs
people who sign in. Machine credentials keep working. Tokens already issued stay
valid until they expire, and nothing recalls them. So the server checks
suspension on every call. That check is what stops a running swarm, not the
suspension by itself.

## Known limits

- **Token lifetime is 24 hours.** Kinde sets this value for each application in
  its dashboard. The demo cannot change it, because the Management API
  application holds only organization scopes. A shorter lifetime does not affect
  the kill switch, because the server checks suspension on every call. A shorter
  lifetime does reduce the risk from a token that leaks another way.
- **The console has no operator login.** The isolation switch and the kill
  switch are public Convex functions. No agent can reach them, because agents
  hold Kinde tokens and call only the tool endpoints. But anyone who knows the
  deployment URL can. Run this demo on your own machine. A real deployment needs
  an operator login in front of these functions.
- **The console starts a Python process.** The `/api/swarm` route runs the swarm
  on the machine that serves the web app. This works on your own machine. It
  does not work on a serverless host.

## Deploy

The web app deploys to Vercel. Set the same variables from `.env.local` in the
Vercel project.

Deploy the Convex backend with `npx convex deploy`. Set the Convex environment
variables again for the production deployment.

The console cannot start a swarm on Vercel, because the route starts a Python
process. Run the swarm from your own machine with `pnpm swarm`.

## Documents

- `HOW-IT-WORKS.md` explains the demo in plain words.
- `BUILD_LOG.md` records each phase, its decisions, and what was checked.
- `BUILD_RECORD.md` collects the whole build, including every mistake.
- `CHANGELOG.md` lists the changes.
