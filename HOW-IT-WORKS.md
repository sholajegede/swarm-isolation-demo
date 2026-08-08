# How this app works

Plain-English guide to what this project is, what each part does, and how the
three outside services fit together.

---

## 1. What this app is

An **AI swarm** is a group of AI agents that work at the same time on one job.
One agent reads records, another writes a summary, another checks something
else. They run in parallel, and they run fast.

This app runs a swarm for a business that has **several customers**. Each
customer is a **tenant**, and each tenant's data must stay private from the
others.

The danger is simple:

> If every agent in the swarm shares one login, then one agent that goes wrong
> can reach **every** customer's data. Agents move faster than a human can
> react, so by the time you notice, it has already touched everything.

This app shows that failure happening, then shows the fix, then shows an
emergency stop. Three things you can watch on screen.

---

## 2. The two modes

The app runs in one of two modes. **The server decides the mode.** An agent
cannot pick its own mode, and neither can the browser. That matters: if an agent
could choose how much power it has, the whole protection would be pointless.

| Mode | What each agent carries | What happens when tenant A's agent reaches for tenant B's data |
| --- | --- | --- |
| `shared` | One login for the whole swarm | **It works.** The data leaks. This is the hole. |
| `per-org` | A login scoped to one tenant only | **Blocked, 403.** The reach stops at the tenant boundary. |

If the setting is missing or misspelled, the app uses `per-org`. Broken
configuration lands on the safe option, never the leaky one. That idea is called
**failing closed**, and it shows up all over this codebase.

---

## 3. The three outside services

### Kinde — who each agent is

Kinde is the identity service. It answers "who is calling, and what are they
allowed to do?"

- A **Kinde Organization** represents one tenant. Tenant A is one org, tenant B
  is another.
- A **Machine-to-Machine (M2M) app** is a login for software rather than a
  person. Each agent role in each tenant gets its own M2M app.
- An agent trades its M2M credentials for a **token** — a short-lived signed
  pass that says which org it belongs to and what it may do. A read agent gets a
  token that can only read. A write agent gets one that can only write.
- Kinde can **suspend an organization**. Every token for that tenant stops
  working at once. That is the emergency stop.

### Convex — the data and the live view

Convex is the database and the backend.

- It stores the tenants, the agents, each tenant's records, and the log.
- It holds the **enforcement seam** — the single piece of code every agent
  action must pass through. Nothing reaches the data without going through it.
- It pushes updates to the browser **live**, so each agent's step appears on
  screen the moment it happens, with no refresh.

### Kimi K3 — the thinking

Kimi K3 is the AI model that drives the agents.

- An **orchestrator** takes the job and splits it into tasks.
- **Worker agents** take those tasks and decide what to do.
- The model id is read from configuration, never written into the code, because
  pinned model ids stop working over time.

Important: the agents are genuinely deciding their own actions. The cross-tenant
reach is not a scripted fake. It happens because an agent tried it.

---

## 4. How one run flows

1. You pick a tenant in the browser and start a run.
2. The **orchestrator** (Kimi K3) splits the job and hands tasks to workers.
3. Each **worker** asks Kinde for a token before it does anything. In `per-org`
   mode that token is locked to one tenant.
4. The worker calls the backend with that token. **Workers never touch the
   database directly.** They can only go through the tool endpoints.
5. The **enforcement seam** checks the call, in this order:
   - Is the token real? (checked against Kinde's public keys)
   - Is it still valid, and not expired?
   - Does the tenant on the token match the data being asked for?
   - Does the token carry the right permission for this action?
6. **Allow or deny.** Either way the seam writes a log row with a
   **correlation id** — a tracking number that ties every step of one run
   together, so a denial can be traced back to the exact agent and moment.
7. The result streams to the browser as it happens.

If any check cannot be completed — the key lookup fails, the token is malformed,
anything unclear — the answer is **deny**. Never "allow because we are not
sure".

---

## 5. Where the code lives

```
app/                     The website (Next.js)
  page.tsx               The landing page: the problem, in plain words.
  console/               The console. Mode switch, tenant picker, run and
                         kill-switch buttons, metrics, live timeline, and
                         the audit trail underneath.
  api/swarm/route.ts     Starts a swarm run and hands back its id.
  api/health/route.ts    Health check. Reports the mode the server decided
                         and which services are configured. Booleans only,
                         never actual values.

lib/
  env.ts                 Reads configuration. Decides the isolation mode and
                         forces the safe default when it is missing.

convex/                  The backend and the database
  schema.ts              Table shapes: tenants, workers, resources, runs,
                         run events, audit log. Every tenant-owned table
                         carries orgCode, the tenancy key.
  lib/tenancy.ts         The boundary. Checks that the caller's tenant owns
                         the record it asked for, and refuses if not.
  resources.ts           Reading and writing tenant data. All internal, so
                         nothing outside the backend can call in with a
                         tenant of its choosing.
  tenancy.test.ts        Proves tenant A cannot reach tenant B's data, even
                         when it holds a real id for it.
  lib/kindeToken.ts      Checks a worker's token against Kinde's public keys
                         and reports which tenant it proves. A token that
                         fails any check is refused, never trusted.
  lib/decide.ts          The rule itself, as one small function: given the
                         mode, the caller and the target, allow or refuse.
  lib/seam.ts            The single door. Verify, decide, write it down,
                         answer. Nothing gets data without passing through.
  settings.ts            Holds the mode, server-side only.
  audit.ts               One row per decision, allow and deny alike.
  http.ts                The tool endpoints workers call. The tenant comes
                         from the token; the request only picks the record.
  seed.ts                Demo data for the three tenants.

scripts/
  lib/kinde.ts           Gets a worker token the way a worker does.
  verify-kinde-auth.ts   Live proof against real Kinde: a tenant A token is
                         refused tenant B's record, and edited tokens are
                         refused outright.
  repro-cross-tenant.ts  Live proof of the two modes: the same worker makes
                         the same call twice, and only the mode differs.
                         Shared lets it through, per-org refuses it 403.
  kill-switch.ts         Live proof of the emergency stop, without model
                         calls. Suspends a tenant and shows its existing
                         token stop working while other tenants carry on.
  kill-mid-run.ts        The same, with two real swarms running, one of
                         them suspended part way through.

swarm/                   The Kimi K3 agents (Python)
  identity.py            Each worker gets its own token, for its own tenant
                         and its own role. No shared credential exists.
  backend.py             The only way a worker reaches data.
  kimi.py                Talks to the Kimi K3 model.
  worker.py              One agent: think, call a tool, react, report.
  orchestrator.py        Splits the job and runs three workers at once.

  Run it with:
    python3 -m venv .venv && ./.venv/bin/pip install -r swarm/requirements.txt
    ./.venv/bin/python -m swarm --tenant A

scripts/                 Live proof scripts                  [coming later]
```

Two files carry the safety rules, and they are small on purpose:

- `lib/env.ts` — the mode comes from the server, and a broken value fails
  closed.
- the enforcement seam in `convex/` — every agent action passes through one
  place, so there is exactly one door to guard.

---

## 6. How the three fit together

```
   Kimi K3                    Kinde                     Convex
  (decides)              (proves identity)          (holds the data)
      |                          |                          |
      | 1. worker gets a task    |                          |
      |------------------------->|                          |
      |   2. asks for a token    |                          |
      |      for its tenant      |                          |
      |<-------------------------|                          |
      |   3. short-lived token,  |                          |
      |      one tenant only     |                          |
      |                                                     |
      | 4. calls a tool endpoint, carrying that token       |
      |---------------------------------------------------->|
      |                                                     |
      |                     5. the seam checks the token     |
      |                        against Kinde's public keys,  |
      |                        matches the tenant, checks    |
      |                        the permission                |
      |                                                     |
      |<----------------------------------------------------|
      |   6. allow (data) or deny (403 + reason)             |
      |      either way, a log row is written                |
      |                                                     |
                                                   7. the browser
                                                      updates live
```

Short version: **Kimi K3 decides, Kinde proves, Convex enforces and records.**

The emergency stop suspends a tenant's organization in Kinde, and the seam
refuses every call that tenant makes from that moment. Other tenants keep
running, untouched.

One detail matters more than it looks. Suspending an organization does **not**
stop its agents getting tokens — suspension governs people signing in, and
agents use machine credentials, which keep working. Tokens already handed out
also stay valid until they expire, and nothing can call them back. So the stop
cannot rely on identity alone: step 5 checks whether the tenant is suspended on
**every single call**, which is what actually ends a run in progress. It works
in both modes, because the leaky mode is exactly when you most need to stop a
swarm.

---

## 7. What is built so far

- [x] The app scaffold, configuration handling, and the health check
- [x] Database tables and the tenant isolation test
- [x] Token checking against Kinde
- [x] The enforcement seam and the two modes
- [x] The Kimi K3 swarm
- [x] The emergency stop
- [x] The screen you watch it on

`BUILD_LOG.md` records what each step built and what was tested before it was
saved.

---

## 8. What you need to run it

Copy `.env.example` to `.env.local` and fill it in. You need three accounts:

- **Kinde** — a domain, a registered API, two or three organizations, an M2M app
  per agent role per organization, and one Management API app for the emergency
  stop.
- **Convex** — `npx convex dev` fills in its own values.
- **Kimi K3** — an API key from Moonshot or OpenRouter, plus the model id.

Until those are filled in, the health check reports each one as `false` and the
app runs but does nothing useful.
