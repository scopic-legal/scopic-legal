# AGENTS.md

This repo is meant to be worked on by coding agents. Read this file before
editing.

## Project Shape

`Scopic` is a thin, legal-domain app built on top of [Team
Suzie](https://github.com/firelex/open_teamsuzie). It is the canonical example
of the *"build your app in a sibling repo"* pattern documented in the upstream
README — meaning it consumes upstream packages via `link:` references rather
than vendoring them.

- Sibling clone of Team Suzie expected at `../open_teamsuzie`.
- App lives in `apps/suzielaw/` (Express + Vite, copied from
  `starter-chat` at bootstrap).
- `@teamsuzie/{ui,agent-loop,approvals,db-sqlite,markdown-document}` are
  consumed via `link:` to the sibling clone.

## Stay Thin — Import Upstream

This is the most important rule in this repo:

**Anything that isn't legal-specific should live upstream.** When you find
yourself about to add code here that could plausibly be useful to another
chat app, the answer is almost always to extract it into the appropriate
upstream package first, then `import` from there.

**What belongs here (downstream, app-specific):**
- Practice-area taxonomy (`apps/suzielaw/client/src/data/practice-areas.ts`)
- Seed prompt catalog and workflow definitions
- Counsel's identity / system prompt
- Auth glue specific to this app's stub auth (`Protected`, `useSession`,
  `protected.tsx`)
- App-specific routes (`/library`, `/history`, `/settings`)
- Branding strings (`Scopic`, `Counsel`)

**What does NOT belong here — extract upstream instead:**
- UI components (cards, panels, dropdowns, status indicators, model pickers).
  Add to `@teamsuzie/ui` and import.
- Chat-handling helpers (tool-use status, artifact panel, markdown renderer,
  whimsical-verb lists, prettifiers). Add to `@teamsuzie/ui` or
  `@teamsuzie/agent-loop`.
- Redline / tracked-changes / version-diff UI. Use `@teamsuzie/ui`
  `TrackedChangesPanel`, `RedlinePanelContent`, `VersionDiff`,
  `RedlineRuns`, `RedlineSpan`. Local `tracked-changes-panel.tsx` and
  `redline-panel.tsx` were deleted in the P4.5 sweep; Scopic now
  just supplies `onResolve`/`onLoadRedline` callbacks pointing at its
  cookie-authed endpoints. `compare-versions.tsx` is the thin
  matter-aware wrapper around upstream `VersionDiff`.
- Redline/propose-edits server logic. Use `@teamsuzie/docx`
  `extractRedlineParagraphs`, `findEditParagraphIndex`,
  `proposeDocumentEdits`, `acceptRevision`, `rejectRevision`. The local
  `src/redline-view.ts` was deleted; `src/tools/propose-edits.ts` is a
  thin file-store + `documentVersions` wrapper around
  `proposeDocumentEdits`.
- Document navigation/drafting tools. Add to `@teamsuzie/markdown-document`.
- DB plumbing helpers. Add to `@teamsuzie/db-sqlite`.
- Sidekick services (conversion agents, etc.). Add to `apps/agents/*`
  upstream.

**Smells that mean "extract first":**
- The same file modified in this repo and `open_teamsuzie` in the same change.
- An inline type, hook, or component here that has a near-identical twin in
  `apps/starters/starter-chat` upstream.
- Adding a new dependency here that another app would also need.

When tempted to copy-paste from `starter-chat` upstream into a downstream
file, ask: *should this be a `@teamsuzie/ui` export?* — usually it should.

## Working Rules

- Prefer small, focused changes that preserve existing package boundaries.
- Match upstream patterns before introducing new abstractions.
- Do not commit `apps/suzielaw/.env` or any other credential file —
  `.env.example` is the contract.
- Do not commit `data/` (SQLite databases) or `.dev-logs/`.
- If a change touches auth, file uploads, the document store, or chat
  routing, treat it as security-sensitive.

## Common Commands

```bash
# Build upstream packages so the link: references resolve to compiled dist
pnpm deps:build

# Start markitdown-agent + Scopic in one shot
pnpm dev:full

# Chat-only (no document tools)
pnpm dev

# Typecheck + build the app
pnpm typecheck
pnpm build
```

## When in Doubt

Document the upstream/downstream boundary instead of smuggling app-specific
behavior into shared packages — and the inverse: don't keep generic chat or
agent code locked into this repo when a sibling app would also benefit.
