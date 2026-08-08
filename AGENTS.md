<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on this project

## What it is

A demo of tenant isolation for AI agent swarms. Kimi K3 agents run for three
tenants. Each agent authenticates as its own Kinde machine-to-machine
application. Convex stores the data and decides every call.

Read `README.md` first.

## The one rule that matters

**Every agent call passes through `convex/lib/seam.ts`. That is the only place
a call is allowed or refused, and the only place the audit trail is written.**

The rule itself lives in `convex/lib/decide.ts` as a pure function. Keep it
pure. It takes the mode, the acting tenant, its scopes, the required scope, the
target tenant, and whether the tenant is suspended. It returns a decision. No
network, no database, no token.

Two things follow:

- Do not add a second place that decides. If a new tool endpoint needs a check,
  it declares what it needs and lets `guard` apply it.
- Do not re-check inside `perform`. A second copy of the rule is a second rule.

## Things that will bite you

- **`actorOrgCode` is never user input.** It comes from a verified token. Any
  function that takes it is `internal`, so nothing outside the backend can call
  in naming a tenant of its choosing.
- **The isolation mode is server-decided.** It is read from server state and the
  deployment environment. No agent and no browser sends it. Anything other than
  an exact `shared` resolves to `per-org`.
- **Kinde keeps issuing tokens for a suspended organization.** Suspension
  governs people signing in, not machine credentials, and an issued token stays
  valid until it expires. The server checks suspension on every call. That check
  is what stops a run, not the suspension by itself.
- **Convex functions read their own environment.** Setting a value in
  `.env.local` does not reach them. Use `npx convex env set`.
- **Do not write a literal interpreter path in a route handler.** The bundler
  resolves it and follows `.venv/bin/python`, a symlink out of the project, and
  the build fails. See `app/api/swarm/route.ts`.

## Checks

Run these before you commit:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

These check the running system against Kinde and Convex, and need `.env.local`:

```bash
pnpm e2e --no-swarm   # the whole arc, no model calls
pnpm verify:auth      # token checks
pnpm repro:cross-tenant
pnpm kill-switch
```

Each script exits non-zero if a check fails. Start with `pnpm e2e --no-swarm`.

## Tests

`convex/decide.test.ts` covers the rule. `convex/tenancy.test.ts` covers the
data layer and suspension state. Both use `convex-test`, which runs in memory
and needs no deployment.

When you change the boundary, break it on purpose and run the tests. If they
still pass, they are not testing the boundary.

## Authorship

This repository is authored by its owner. Never add an AI assistant as a
contributor: no `Co-Authored-By` trailer naming an assistant, no "Generated
with" line, no assistant product links, no robot emoji, and never commit under
an assistant identity. The same applies to pull requests, issues, comments and
documentation.

`.githooks/commit-msg` enforces this, and `pnpm install` points
`core.hooksPath` at `.githooks`. Do not disable it. Do not pass `--no-verify`.
