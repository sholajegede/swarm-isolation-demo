<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Authorship

This repository is authored by its owner. **Never** add an AI assistant as a
contributor, in any form:

- no `Co-Authored-By:` trailer naming an assistant or a `noreply@` bot address
- no "Generated with", "Created with", or "Assisted by" credit lines
- no links to assistant products
- no 🤖 emoji footer
- never commit or author under an assistant identity

This is enforced, not merely requested. `.githooks/commit-msg` rejects any
commit that breaks the rule, and `pnpm install` points `core.hooksPath` at
`.githooks` so the hook is active on a fresh clone. Do not disable it, do not
pass `--no-verify`.

The same applies to pull request titles and bodies, issue text, code comments,
and documentation.
