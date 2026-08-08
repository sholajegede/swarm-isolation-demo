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
