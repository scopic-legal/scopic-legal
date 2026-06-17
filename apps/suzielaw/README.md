# Scopic

The Scopic chat assistant. Express + React + Vite, copied from Team Suzie's `starter-chat` and adapted with legal-specific content.

For repo-level context (layout, sibling-clone setup, why a separate repo) see the top-level [repo README](../../README.md). For the underlying chat shell, tool-use loop, skills bridge, and MCP client — none of which we re-implemented — see the upstream [`starter-chat` README](https://github.com/firelex/open_teamsuzie/blob/main/apps/starters/starter-chat/README.md). This README only covers what's app-specific.

## Run

```bash
cp .env.example .env
#   → fill in SCOPIC_AGENT_BASE_URL and SCOPIC_AGENT_API_KEY
#   → optionally add SCOPIC_GOOGLE_CLIENT_ID / SCOPIC_GOOGLE_CLIENT_SECRET
pnpm --filter @scopic/assistant dev
```

Open <http://localhost:17502>.

## Configuration

Set in `.env`. Same shape as upstream `starter-chat`'s env, with `STARTER_CHAT_` renamed to `SCOPIC_`. The defaults that matter:

| Variable | Default | Purpose |
|---|---|---|
| `SCOPIC_AGENT_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible base URL |
| `SCOPIC_MODEL` | `gemini-3.5-flash` | Model string sent to `/v1/chat/completions` (must support tool use) |
| `SCOPIC_AGENT_API_KEY` | — | Bearer token for the model provider |
| `SCOPIC_GOOGLE_CLIENT_ID` / `SCOPIC_GOOGLE_CLIENT_SECRET` | — | Enables the Google sign-in button |
| `SCOPIC_PORT` / `SCOPIC_CLIENT_PORT` | `17501` / `17502` | Backend / frontend ports |
| `SCOPIC_TITLE` | `Scopic` | App title shown in the sidebar |
| `SCOPIC_AGENT_NAME` | `Counsel` | Assistant display name |
| `SCOPIC_VECTOR_DB_BASE_URL` | `http://localhost:3006` | Where the `vector_search` tool POSTs |
| `SCOPIC_TOOL_MAX_ITERATIONS` | `100` | Cap on tool-use loop turns |
| `SCOPIC_LOCAL_QWEN_BASE_URL` / `SCOPIC_LOCAL_GEMMA_BASE_URL` | `http://localhost:8801` / `http://localhost:8802` | OpenAI-compatible local model endpoints shown in Settings |
| `SCOPIC_OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint used for model discovery and chat routing |

Skills, MCP, and the http-allow-list work exactly as upstream — see the upstream README. The `.env.example` lists all of them with comments.

## Layout

```
apps/suzielaw/
  src/                Express backend (auth, chat, files, matters, reviews, KB)
    config.ts         SCOPIC_* env config
    index.ts          server bootstrap
    tools/            legal-specific tools (CourtListener, templates, diffs)
  client/
    src/
      App.tsx         AppShell + Sidebar + Routes
      pages/
        assistant.tsx      General Counsel chat
        matters.tsx        Matter workspace index
        matter-detail.tsx  Matter documents, reviews, and chats
        review-detail.tsx  Tabular review and structured extraction
        library.tsx        Legal workflow library
        personas.tsx       Built-in and user-created personas
        settings.tsx       Model picker and local app settings
```

## Generate PowerPoint decks (pptx-agent)

The `Counsel` assistant can generate `.pptx` slide decks via Team Suzie's `pptx-agent` HTTP service plus the bundled `presentations` skill. Setup:

1. **Start pptx-agent.** In a separate terminal, from your sibling teamsuzie clone:

   ```bash
   cd ../open_teamsuzie
   cp apps/agents/pptx-agent/.env.example apps/agents/pptx-agent/.env
   #   → set DEFAULT_LLM_MODEL (or PPTX_AGENT_MODEL) and any provider key
   pnpm dev:pptx-agent
   ```

2. **Point Scopic at it.** In `apps/suzielaw/.env`, uncomment:

   ```bash
   SCOPIC_SKILLS_DIR=../../../open_teamsuzie/packages/skills/templates
   SCOPIC_SKILLS_ALLOW=presentations
   SCOPIC_SKILL_VAR_PPTX_AGENT_URL=http://localhost:3009
   SCOPIC_SKILL_VAR_AGENT_API_KEY=
   SCOPIC_SKILL_VAR_AGENT_SLUG=scopic
   ```

3. **Restart the assistant.** The skill markdown is loaded into the system prompt at startup; the model will know how to call the pptx-agent via `http_request`.

4. **Try it.** Open the Library, run the *Draft a board update deck* workflow. Counsel will draft the outline, call the pptx-agent, and return a download link when the job finishes (60–120 seconds).

> **Note on async.** Deck generation is asynchronous — the agent submits a job and the pptx-agent fires a webhook when complete. Without an admin service implementing `GET /api/agents/resolve-by-key`, the webhook delivery silently fails and Counsel will need to poll. That's fine for local dev; in production you'd run the Team Suzie admin service alongside.

## Document templates

Markdown layouts for the document types lawyers actually produce live in `apps/suzielaw/templates/`. Each file has YAML frontmatter (id, title, description, document_type, when_to_use) and a body of the layout itself — parties block, recitals, IRAC sections, signature block, etc. — with `[BRACKETED PLACEHOLDERS]` to swap in.

| Template | Purpose |
|---|---|
| `agreement` | Generic contract layout (parties, recitals, definitions, operative terms, boilerplate) |
| `memorandum` | Internal IRAC memo (Issue / Brief Answer / Facts / Discussion / Conclusion) |
| `legal-opinion` | Formal opinion letter to a third party (assumptions, opinions, qualifications, reliance) |
| `brief` | Litigation brief (caption, preliminary statement, statement of facts, argument, conclusion) |
| `board-minutes` | Board meeting minutes (attendance, motions, votes, executive session, adjournment) |
| `engagement-letter` | Client engagement letter (scope, fees, conflicts, file retention) |
| `demand-letter` | Pre-litigation demand letter (background, legal basis, demand, deadline) |
| `client-alert` | Client alert (what happened / who it affects / what to do / open questions) |
| `resolution` | Written consent / resolution (recitals + RESOLVED clauses + omnibus authorization) |

The model reaches them through two tools: `list_templates` (catalog browse) and `get_template({id})` (fetch markdown body). Pair with `courtlistener_find_contract_precedent` for inspiration: the template gives the *layout*, the precedent gives real-world *language* to adapt. Add new templates by dropping a frontmatter-prefixed `.md` file in `templates/` and restarting the server.

## CourtListener (case law / RECAP / citations)

The assistant ships with thirteen tools that wrap CourtListener's v4 REST API:

| Tool | Purpose |
|---|---|
| `courtlistener_search` | Search opinions, RECAP dockets/documents, oral arguments, or judges |
| `courtlistener_get_opinion` | Fetch the full text of an opinion by id |
| `courtlistener_get_cluster` | Case-level metadata (caption, citations, judges, headnotes) |
| `courtlistener_get_docket` | Fetch a RECAP/PACER docket |
| `courtlistener_lookup_citation` | Verify and resolve citations |
| `courtlistener_get_person` | Full judge record (positions, education, ABA ratings) |
| `courtlistener_list_courts` | Resolve court ids by jurisdiction or name |
| `courtlistener_list_docket_entries` | Full timeline of filings on a docket |
| `courtlistener_get_recap_document` | OCR'd text of a specific PACER filing |
| `courtlistener_list_financial_disclosures` | Annual disclosures by judge |
| `courtlistener_list_disclosure_agreements` | Continuing-income / post-employment agreements |
| `courtlistener_opinions_cited` | Citation graph (forward + reverse) |
| `courtlistener_find_contract_precedent` | Pull real-world contract exhibits from RECAP as drafting precedents |

They work unauthenticated (with a low rate limit). For real use, set a token in `.env`:

```bash
SCOPIC_COURTLISTENER_TOKEN=<token from https://www.courtlistener.com/profile/api/>
```

The Library page seeds prompts that exercise these tools — case-law research, citation verification, judge profiles, RECAP docket pulls, opinion summaries, and circuit-split surveys.

## Adding legal content

The library, prompt seeds, and legal review presets live here:

- `client/src/data/practice-areas.ts` — taxonomy
- `src/data/prompts.ts` — seed prompt catalog
- `client/src/data/workflows.ts` — workflow agents (multi-step)
- `client/src/data/legal-presets.ts` — tabular review presets
- `src/data/review-templates.ts` — backend review template seeds

Tools for legal-specific actions live in `src/tools/`. Wire them into the agent loop in `src/index.ts`.
