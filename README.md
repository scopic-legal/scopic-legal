# Scopic

Scopic is an AI workspace for lawyers. It helps legal teams review documents, ask questions against uploaded materials, draft first-pass work product, compare versions, and use practice-area workflows from one focused desktop app.

Scopic is built for lawyers who want practical assistance inside their own matter work, not a generic chatbot dressed up in legal language.

## What Scopic Helps With

- Review contracts, pleadings, policies, evidence bundles, and other matter documents.
- Ask grounded questions and trace answers back to source material.
- Draft memos, emails, chronologies, issue lists, clause summaries, and document outlines.
- Compare document versions and work through proposed redlines.
- Use legal workflows for litigation, M&A, employment, privacy, IP, tax, arbitration, real estate, capital markets, and related practice areas.
- Keep model and provider choices flexible through bring-your-own-key settings.

## Designed For Legal Work

Scopic's assistant, Counsel, is tuned for legal workflows. It can summarize documents, extract issues, organize facts, prepare drafting structures, and help lawyers move from raw material to reviewable work product.

The app is meant to support legal judgment, not replace it. Outputs should be checked by a qualified lawyer before being used with clients, courts, regulators, counterparties, or third parties.

## Main Areas

- **Assistant:** Chat with Counsel and attach documents or workflow context.
- **Library:** Start from legal workflow templates instead of blank prompts.
- **Personas:** Switch between practice-area modes with different legal focus.
- **History:** Return to prior conversations and matter work.
- **Settings:** Configure model providers, keys, and local options.

## Documents

Scopic can work with common legal file types, including Word documents and PDFs. Depending on the feature and local setup, it can also handle spreadsheets, slide decks, HTML, and other converted formats.

Document features include:

- Document Q&A with source references.
- Drafting with export to Word-compatible output.
- Version comparison and proposed edit review.
- Optional knowledge-base search across stored materials.

## Privacy And Responsibility

Scopic can be run locally and configured with your own model provider credentials. The exact data path depends on the providers and features you enable.

Before using Scopic on confidential, privileged, regulated, or client-sensitive material, confirm:

- Which model provider is being used.
- Whether data is sent to a third-party API.
- Whether authentication and billing features are enabled.
- Whether your organization permits the intended use.

## Developer Setup

This repository contains the Scopic app. It is a thin legal-domain application built on Team Suzie packages from a sibling checkout.

Expected folder layout:

```text
parent-folder/
  open_teamsuzie/
  scopic-lawyer-client/
```

Requirements:

- Node 20+
- pnpm 9+
- Python 3.10+ for document conversion features
- Docker for the full local auth stack

Install and run:

```bash
pnpm install
pnpm deps:build
cp apps/suzielaw/.env.example apps/suzielaw/.env
pnpm dev:full
```

Open:

```text
http://localhost:17502
```

Chat-only development:

```bash
pnpm dev
```

Build:

```bash
pnpm typecheck
pnpm build
```

## Configuration

Important local configuration lives in:

```text
apps/suzielaw/.env
```

Do not commit real credentials, local databases, or development logs.

Useful options include:

- Model provider API keys and base URLs.
- Local model endpoints.
- Document conversion service URL.
- Optional knowledge-base settings.
- Optional Stripe billing settings.
- Optional legal research provider keys.

## Project Boundary

Scopic should stay focused on the legal product: practice areas, legal prompts, workflow definitions, Counsel's identity, branding, and app-specific routes.

Reusable chat UI, agent-loop behavior, document tooling, database helpers, and shared infrastructure should live upstream in Team Suzie and be imported here.

See [AGENTS.md](AGENTS.md) before making code changes.

## License

[MIT](LICENSE)
