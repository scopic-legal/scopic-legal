# Scopic — Manual Test Plan

End-to-end manual test pass for every user-facing feature. Run after a clean rebuild (`pnpm dev:full`); resets data and starts fresh where noted.

> Before starting: kill any orphan dev servers — `pkill -f "vite/bin/vite.js"` and `pkill -f "tsx watch.*suzielaw"`. Then `pnpm dev:full` should land Vite on **17502**. If it doesn't, you have orphans. Open `http://localhost:17502`.

---

## 0 — Pre-flight

- [ ] `pnpm dev:full` brings up markitdown-agent (port 3013) and the Scopic stack without errors. Tail `.dev-logs/markitdown-agent.log` if anything fails.
- [ ] Browser tab title reads **Scopic**. No icon next to the wordmark in the sidebar header. Body text renders in **Inter** (Google Font). DevTools → Network shows the Google Fonts request succeeding.
- [ ] Sidebar shows: **Assistant**, **Matters**, **Library**, **Personas**, **History**, **Admin**, **Settings** in the footer. (Knowledge Base appears only when `SCOPIC_KB_ENABLED=true`.)
- [ ] Status dot in the sidebar footer turns green within ~2 s of load (agent reachable).

## 1 — Auth

- [ ] At `/login`, sign in with `demo@example.com` / `demo`. Lands on Assistant.
- [ ] Reload the page — still signed in (cookie session persists).
- [ ] Click **Sign out** in the sidebar footer → returns to `/login`. Hitting any other route while signed out redirects to `/login`.

## 2 — Assistant (chat)

- [ ] Send a plain message ("Summarize the doctrine of res judicata in 2 paragraphs"). Streaming reply renders in real time.
- [ ] After the first user+assistant turn completes, the chat title in History updates from "New chat" to a 3–6 word auto-generated title.
- [ ] **Find-in-doc**: With a long assistant reply, Cmd/Ctrl+F search highlights matches inside the message (browser native works on the rendered DOM).
- [ ] **Stop streaming**: While the assistant is still typing, hit the stop button — the run halts and the partial reply remains.
- [ ] **Tool-call cards** render (collapsed by default) for any agent tool invocation; expanding shows the args + result.

## 3 — Persona switching

- [ ] Sidebar footer → click the persona picker → 12 built-in personas listed (Litigation, M&A, Capital Markets, Arbitration, Antitrust, Business of Law, Employment, IP, Privacy & Data, Real Estate, Tax, Transactional). Each has a distinct avatar.
- [ ] Pick **Litigation** → the picker closes, the chosen persona's avatar shows in the sidebar footer button, and the next chat reply visibly reflects litigation-flavoured framing.
- [ ] Click **Clear selection** in the picker → reverts to "Default Counsel".
- [ ] **CRUD** on the Personas page: create a custom persona (name, system prompt, avatar) → it appears in the picker. Edit it → changes apply. Delete it → removed from picker.
- [ ] Persona persists across reload (localStorage `scopic:selected-persona`).

## 4 — Workflows from Library

- [ ] `/library` — system catalog renders with **160+** workflows, paginated 24/page. "X built-in · Y saved" appears in the page header.
- [ ] **Filter by practice area** — dropdown filters; pagination resets to page 1.
- [ ] Click any tile → navigates to Assistant with the prompt pre-filled and the workflow label pinned to the input.
- [ ] **Create a workflow** dialog: enter name, description, practice areas, prompt → save → the new card appears at the top with a "saved" badge and is sorted before system items.
- [ ] **Edit** a saved workflow → changes persist.
- [ ] **Hide** a system workflow → disappears from the list. (Verify via API that it's hidden, not deleted.)
- [ ] **Delete** a saved workflow (with confirm dialog) → removed.
- [ ] **Share** dialog opens for a saved workflow.
- [ ] **History** dialog for a workflow lists prior runs.
- [ ] **Export workflows** → downloads `scopic-workflows-YYYY-MM-DD.csv` with header row + one row per workflow, properly quoted.
- [ ] **Background jobs** tab renders without errors.

## 5 — Matters

- [ ] `/matters` → empty state on first run with a clear CTA.
- [ ] **New matter** dialog: name + description → matter card appears.
- [ ] Edit (pencil), archive, and delete a matter — confirm dialogs gate destructive ops.
- [ ] **Share dialog** opens from the matter card menu.
- [ ] Click a matter → opens matter detail.

## 6 — Matter detail (documents + chats + reviews)

- [ ] **Folder tree**: create a subfolder, drag a document between folders, rename, delete a folder.
- [ ] **Upload documents** of multiple types: `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.html`, `.epub`. Each indexes (you see a chunk count after a few seconds) and is browseable in the side panel.
- [ ] Click a document → side panel renders the converted markdown with section anchors. Citations from chat replies should jump to those anchors.
- [ ] **Compare versions** dialog: pick two versions of the same document → diff panel shows insertions/deletions inline.
- [ ] **Matter chat**: start a chat scoped to the matter → workflows picker is available; uploaded matter documents appear in the agent's context (verify by asking "what documents do I have here?").
- [ ] **Reviews**: from the matter, **Create review from workflow** (FromWorkflowDialog) → pick a workflow → review row created.

## 7 — Reviews (tabular)

- [ ] In a matter, open a review → **ReviewGrid** renders with rows = documents, columns = questions.
- [ ] **Add column**: type a column title → blur the input → server drafts a starter prompt + format (text / number / date / boolean / list) via `/api/reviews/column/draft-prompt`. Spinner during draft, prompt appears editable.
- [ ] Edit the column prompt and format manually; run the column → cells fill in row by row with citations into source documents.
- [ ] Click a cell → side panel jumps to the citation in the doc and **flashes** with the redline highlight (`.redline-flash` animation).
- [ ] **Export** review to CSV / DOCX (Download button) → file matches grid contents.
- [ ] **Review chat**: start a chat scoped to the review → workflow picker available; chat sees the review columns + cells in context.

## 8 — Document drafting + DOCX export

- [ ] Ask Counsel to draft a memo or letter (e.g. "Draft a 2-page demand letter to opposing counsel re: breach of NDA").
- [ ] The agent calls `set_outline` → side panel artifact opens with the outline.
- [ ] Agent calls `write_section` per section → live updates in the side panel.
- [ ] **Redline view**: open a prior version side-by-side → tracked changes panel shows insertions / deletions cleanly.
- [ ] **Export DOCX**: download → opens in Word with intact headings, lists, tables.

## 9 — Document Q&A

- [ ] Upload a contract → ask "What are the termination clauses?" → the reply quotes language with `[§ X.Y]` style section-path citations.
- [ ] Click a citation in the reply → side panel scrolls to the cited section and flashes.
- [ ] **document-summarization skill**: upload a brief, type "summarize this" → structured summary (parties, holdings, reasoning, etc.) rather than a flat paragraph.

## 10 — CourtListener tools

- [ ] "Find Ninth Circuit cases on qualified immunity from 2023" → agent calls `courtlistener_search` (type=o), returns a few hits with case names + URLs.
- [ ] "Look up 410 U.S. 113" → `courtlistener_lookup_citation` resolves to Roe v. Wade.
- [ ] "Show me Justice Sotomayor's bio" → `courtlistener_search` (type=p) → `courtlistener_get_person` → biographical info renders.
- [ ] "Find a software license agreement filed as an exhibit in the Northern District of California" → `courtlistener_find_contract_precedent` returns RECAP exhibits with `text_status` per item.
- [ ] **Without an API token** the unauthenticated calls succeed (lower rate limit). With `SCOPIC_COURTLISTENER_TOKEN` set, the auth-only endpoints (docket entries, RECAP documents) also work.

## 11 — Knowledge Base (only when `SCOPIC_KB_ENABLED=true`)

- [ ] `/knowledge-base` appears in the nav. Upload a PDF / DOCX → it chunks and embeds (status visible per row).
- [ ] In Assistant, ask a question grounded in KB content → agent calls `vector_search`, reply cites the KB doc.
- [ ] Delete a KB document → it disappears from the list and from search results.

## 12 — History

- [ ] `/history` lists prior chats with their auto-generated titles, most recent first.
- [ ] Open an old chat → message history loads; you can continue the conversation.
- [ ] Delete a chat from history → removed.

## 13 — Settings — model picker

- [ ] Default model loads from server (`health.agent.model`, e.g. `qwen3.6-plus`).
- [ ] **Without a BYOK key**, only the default cloud model + local models are visible.
- [ ] Add a key for **OpenAI** in the Provider Keys card → GPT-5.5 row becomes visible. Pick it → next chat reply routes via OpenAI.
- [ ] Add a key for **DashScope** → Qwen 3.6-Plus row visible.
- [ ] Add a key for **Anthropic** → Claude Sonnet 4.6 row visible.
- [ ] Configure a **Local model** (Qwen 3.6-35B-A3B): edit the base URL → if a vLLM/llama.cpp server is up at that URL, status flips to reachable; selecting it routes chat to the local endpoint.
- [ ] Selected model persists across reload (`scopic:selected-model`).

## 14 — Admin — reset all content

- [ ] `/admin` page renders with the **Reset all content** card.
- [ ] **Reset all content** opens a destructive confirm dialog.
- [ ] Confirm → deletes all matters / folders / documents / chats / reviews / KB rows. Personas + saved prompts + model overrides are kept.
- [ ] Reset summary card afterward shows `kbDocsDeleted` + `filesDeleted` counts.

## 15 — Sidebar + shell

- [ ] All sidebar links highlight correctly when active.
- [ ] Status dot reflects agent reachability — kill the agent (e.g. wrong API key) and the dot flips to red within ~5 s of the next poll.

## 16 — Persistence + reload smoke

- [ ] Reload mid-chat → in-flight messages are not lost; the chat reopens with full history.
- [ ] Quit the dev server, restart `pnpm dev:full`, log back in → all matters, documents, chats, reviews, personas, saved workflows, BYOK keys, and selected model still present.
- [ ] On-disk: `apps/suzielaw/data/scopic.db` exists with non-empty `matters`, `chats`, `reviews`, `kb_documents` tables (`sqlite3 ... ".tables"`).

## 17 — Negative / regression checks

- [ ] Try to upload an unsupported file (e.g. `.exe`) → friendly error, no crash.
- [ ] Stop the markitdown-agent (port 3013) → DOCX/PDF upload returns a clear error; chat-only flows still work.
- [ ] Send 50+ short messages in one chat — no UI lag, no missed streaming chunks.
- [ ] Open the app in a second browser tab while signed in → both tabs share session; sending a message in one shows up in the other on reload.

---

## What to file as a bug vs a polish issue

- **Bug**: any crash, blank page, broken nav, broken upload, persona / workflow / matter / review CRUD failure, BYOK routing leak (paid call billed against the demo budget), citation that doesn't jump.
- **Polish**: spacing, copy, animation timing, font weight choices, empty-state wording.
