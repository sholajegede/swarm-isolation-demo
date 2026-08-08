# Changelog

This project follows the order of its build. Each entry lists what the change
adds, and what the author checked against the live services.

## 0.1.0

The first working demo. It runs a Kimi K3 agent swarm for three tenants, and it
shows a tenant boundary hold and fail.

### Added

**Isolation modes.** The server runs in `shared` or `per-org`. The server
decides the mode. No agent and no browser can change it. Any value other than
`shared` resolves to `per-org`, so a wrong value fails closed.

**Tenant data model.** Convex tables for tenants, agents, resources, runs, run
events, audit rows, and settings. Each tenant-owned table carries an `orgCode`
field. That field holds the Kinde `org_code` claim.

**Kinde token checks.** The server checks each token against the Kinde public
keys. It checks the signature, the issuer, the audience, and the expiry time. It
pins RS256, so a sender cannot choose a weaker algorithm. It refuses a token
that carries no `org_code`.

**One enforcement point.** Every agent call passes through `convex/lib/seam.ts`.
The rule itself sits in `convex/lib/decide.ts` as a pure function. The server
writes one audit row for every decision, allow and refuse alike, before it
answers the caller.

**Kimi K3 swarm.** A Python service runs an orchestrator and three agents. Two
agents read and one agent writes. Each agent gets its own Kinde token before it
calls a tool. Each agent gets only the tools its scope permits.

**Kill switch.** The Management API suspends a tenant organization. The server
then refuses every call from that tenant, in both modes. The kill switch also
closes any run that the tenant left open.

**Operator console.** A landing page and a console. The console holds the mode
switch, the tenant picker, the run button, the kill switch, five counters, a
live timeline, and the audit trail. The timeline updates as the agents work.

**Proof scripts.** Six scripts check the demo against the live services. Each
one exits non-zero if a check fails. `pnpm e2e` runs the whole story in one
pass.

### Checked

- 23 unit tests. The tenant isolation tests were mutation-tested: with the
  ownership check removed, exactly the cross-tenant tests failed.
- `pnpm verify:auth`, 14 checks. A token with one changed character in the
  signature is refused. A token with an edited `org_code` is refused.
- `pnpm repro:cross-tenant`, 12 checks. The same call leaks in `shared` and
  fails with `403 cross_org` in `per-org`.
- `pnpm kill-switch`, 10 checks. A token already held stops working at once.
- `pnpm e2e`, all beats in one pass, with a real Kimi K3 swarm.
- The three beats were also clicked through in a browser, across two tenants.

### Known limits

- Kinde issues these tokens with a 24 hour lifetime. Change this value in the
  Kinde dashboard.
- The console has no operator login. Run the demo on your own machine.
- The console starts the swarm as a local process, so it needs a host that runs
  Python.
