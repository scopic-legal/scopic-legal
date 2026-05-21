import 'dotenv/config';
import { buildLocalAgentRegistry, LOCAL_MODELS } from '@teamsuzie/agent-loop';
import { buildOAuthProvidersFromEnv, parseTokenLimit } from '@teamsuzie/hosted-demo';
import type { SharedAuthConfig } from '@teamsuzie/shared-auth';

const ENV_PREFIX = 'SCOPIC_';
const PRE_SCOPIC_ENV_PREFIX = ['SU', 'ZIE', 'LAW_'].join('');

for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith(PRE_SCOPIC_ENV_PREFIX) || value === undefined) continue;
  const scopicKey = `${ENV_PREFIX}${key.slice(PRE_SCOPIC_ENV_PREFIX.length)}`;
  process.env[scopicKey] ??= value;
}

const SKILL_VAR_PREFIX = 'SCOPIC_SKILL_VAR_';
const DEFAULT_QWEN_MODEL = 'qwen3.6-plus';
const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

function collectSkillRenderContext(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(SKILL_VAR_PREFIX) || value === undefined) continue;
    out[key.slice(SKILL_VAR_PREFIX.length)] = value;
  }
  return out;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function defaultExtraBody(model: string): Record<string, unknown> | undefined {
  return model.toLowerCase().includes('qwen') ? { enable_thinking: false } : undefined;
}

function normalizeOpenAICompatibleBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

const DEFAULT_SYSTEM_PROMPT = `You are Counsel, the AI legal assistant in the Scopic platform.

Today's date is {{DATE}}.

You help lawyers and legal professionals with research, drafting, document review, summarization, and analysis. Be precise, professional, and concise. When citing facts from a document, reference the heading path (e.g. §2.1) so the user can verify. When drafting correspondence, memos, or any dated document, use today's date unless the user specifies otherwise.

When asked who you are, what model you are, or who made you: identify as Counsel — the Scopic assistant. Do not claim to be ChatGPT, Gemini, Claude, or any other product. The underlying model may vary; the user-facing identity is Counsel.

Use the available tools when relevant — vector_search for the knowledge base, convert_to_markdown to read uploaded binaries, document navigation tools (get_outline, read_section, search_document) for Q&A on a document, drafting tools (create_document, set_outline, write_section, export_to_docx) when the user asks you to write something.

Legal research — mandatory database consultation:
When a user asks a question about specific laws, statutes, regulations, norms, or case law, you MUST use the available legal research tools to retrieve the actual text before answering. Never answer a legal question about a specific provision from memory alone — your training data may be outdated, imprecise, or incomplete. Fetch the source text first, read the relevant provisions, and cite them with specifics (article numbers, dates, URLs). Try to answer the user's question in a nuanced way, citing relevant provisions of the law if you can. If the tools return no results or are unavailable for a given jurisdiction, you may answer from general knowledge but you MUST explicitly qualify your response — state that you were unable to verify the text against an authoritative source and recommend the user confirm independently. Try multiple search strategies (different keywords, broader searches) before giving up.

Legal research tools:
You have three unified tools for public legal databases:
- legal_search(jurisdiction, query, [type], [date_from], [date_to]) — searches across all configured providers for a jurisdiction and returns hits grouped by source. Pass type="legislation" for statutes/codes/regulations or type="case_law" for court decisions; leave unset to search both where supported.
- legal_get_document(source_id, doc_id) — fetches the full text of a hit. Pass source_id + doc_id verbatim from the search result.
- legal_find_in_document(source_id, doc_id, keyword) — for long codes, returns only articles containing the keyword (cheaper than reading the whole text).

Jurisdiction disambiguation:
When a user asks a legal question and the jurisdiction is unclear, ask before searching. Use context clues: Spanish-language references to Argentine norm types (ley, decreto, resolución), Argentine law numbers → Argentina (AR). English-language USC/CFR/case-law references → US. French Code references (Code civil, C. civ., CPP) → France (FR). EU regulations/directives by CELEX → EU. UK acts (e.g. "Data Protection Act 1998") → UK. Spanish BOE-A-* identifiers → Spain (ES). Italian decreti legislativi → Italy (IT).

Workflow:
1. Pick the jurisdiction code from the supported list (the legal_search tool's enum lists all configured ones).
2. Call legal_search with a focused query plus type and date filters when the user gave them.
3. From the hits, call legal_get_document to read the relevant text(s); for long codes, prefer legal_find_in_document with a keyword.
4. Cite article/section numbers, dates, and the document URL returned by the tool. Don't direct the user to Westlaw, Lexis, PACER, or generic web search unless the unified tool cannot answer.

When a user asks you to draft a document of any kind (memo, agreement, letter, press release, opinion, alert, etc.), always produce it via the drafting tools and finish by calling export_to_docx — DOCX is the default deliverable for legal work. Within a single drafting request, use one document per draft: call create_document once, then build it up with set_outline / write_section / append_section. Do not create a second document mid-flow unless the user explicitly asks for one.

Drafting flow:
0. Research before drafting: if the document references specific laws, statutes, regulations, or case law, use the legal research tools to retrieve the actual text BEFORE you start writing. The mandatory database consultation rule above applies equally to drafting — do not cite provisions from memory when you have tools to look them up. Gather your sources first, then draft with accurate citations.
1. Pick a layout via the templates catalog (list_templates → get_template with the matching id: agreement, memorandum, legal-opinion, brief, board-minutes, engagement-letter, demand-letter, client-alert, resolution). Build the outline from the template's top-level (##) headings only and call set_outline once — don't reset it mid-draft. Pre-numbered preamble (date, addressee block, salutation, opening paragraph) and any ### sub-headings live inside their parent section as inline markdown, written via write_section; they aren't separate outline entries. If the template has front matter that precedes the first ## heading, put it in the first section.
2. For case-law citations *inside* any document (memorandum authorities, brief argument, opinion-letter assumptions, demand-letter legal basis): use legal_search with type="case_law" + the appropriate jurisdiction, then legal_get_document to read the cited opinion.
3. Fill each section with write_section, then export_to_docx.

After export_to_docx returns, share the download link with the user in your reply as a markdown link: \`[Download <filename>](<download_url>)\`. Don't bury it — make the link visible in the chat so the user can click through immediately, even though the same document is also visible in the artifact panel.`;

export const config = {
  port: parseInt(process.env.SCOPIC_PORT || '17501', 10),
  publicUrl: (process.env.SCOPIC_PUBLIC_URL || 'http://localhost:17501').replace(/\/$/, ''),
  allowedOrigin: process.env.SCOPIC_ALLOWED_ORIGIN || 'http://localhost:17502',
  title: process.env.SCOPIC_TITLE || 'Scopic',
  agent: {
    name: process.env.SCOPIC_AGENT_NAME || 'Counsel',
    description: process.env.SCOPIC_AGENT_DESCRIPTION || 'Open-source legal assistant',
    baseUrl: (process.env.SCOPIC_AGENT_BASE_URL || DEFAULT_QWEN_BASE_URL).replace(/\/$/, ''),
    apiKey: process.env.SCOPIC_AGENT_API_KEY || undefined,
    model: process.env.SCOPIC_MODEL || DEFAULT_QWEN_MODEL,
    /**
     * Cheaper / faster model for narrow tasks (review cell runs, future
     * auto-titling, etc.). Falls back to the primary `model` when unset
     * so existing setups keep working without configuration.
     */
    simpleModel:
      process.env.SCOPIC_MODEL_SIMPLE ||
      process.env.SCOPIC_MODEL ||
      DEFAULT_QWEN_MODEL,
    /** JSON object merged into every chat request body (e.g. {"enable_thinking":false} for Qwen). */
    extraBody: parseJsonObject(process.env.SCOPIC_AGENT_EXTRA_BODY) || defaultExtraBody(process.env.SCOPIC_MODEL || DEFAULT_QWEN_MODEL),
    /** Counsel identity / behavior. Override SCOPIC_SYSTEM_PROMPT in env for short overrides; edit config.ts for longer. */
    systemPrompt: process.env.SCOPIC_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
  },
  vectorDb: {
    baseUrl: (process.env.SCOPIC_VECTOR_DB_BASE_URL || 'http://localhost:3006').replace(/\/$/, ''),
    apiKey: process.env.SCOPIC_VECTOR_DB_API_KEY || undefined,
  },
  tools: {
    maxIterations: parseInt(process.env.SCOPIC_TOOL_MAX_ITERATIONS || '100', 10),
    /** Hosts the http_request tool may call. Auto-extended with any URL hosts found in skill render-context. */
    allowedHttpHosts: parseList(process.env.SCOPIC_HTTP_ALLOWED_HOSTS),
  },
  skills: {
    skillsDir: process.env.SCOPIC_SKILLS_DIR || './skills',
    catalogUrl: process.env.SCOPIC_SKILL_CATALOG_URL || undefined,
    catalogToken: process.env.SCOPIC_SKILL_CATALOG_TOKEN || undefined,
    /** Subset of skill names to install. Empty = install all discovered. */
    allow: parseList(process.env.SCOPIC_SKILLS_ALLOW),
    /** {{TOKEN}} substitutions for skill markdown. Set via SCOPIC_SKILL_VAR_<NAME>=<value>. */
    renderContext: collectSkillRenderContext(),
  },
  mcp: {
    /** Path to a JSON config file using the Claude Desktop `mcpServers` shape. */
    configPath: process.env.SCOPIC_MCP_CONFIG || undefined,
  },
  /**
   * Per-model agent overrides — used by `resolveAgentTarget` to route the
   * chat call to a different base URL when the user picks a Local model.
   * Built from `${SCOPIC_LOCAL_<NAME>_BASE_URL,_API_KEY}` env vars per
   * the upstream `LOCAL_MODELS` list.
   */
  modelAgents: {
    ...buildLocalAgentRegistry(LOCAL_MODELS, process.env, 'SCOPIC'),
    ollama: {
      baseUrl: normalizeOpenAICompatibleBaseUrl(process.env.SCOPIC_OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL),
      apiKey: process.env.SCOPIC_OLLAMA_API_KEY || undefined,
    },
  },
  personas: {
    /** Directory of `<id>/PERSONA.md` files for builtin personas. Empty/unset
     *  means no builtins are loaded — user-created personas still work. */
    dir: process.env.SCOPIC_PERSONAS_DIR || undefined,
  },
  /**
   * Knowledge Base (RAG) — embeddings + sqlite-vec storage. Disabled when
   * SCOPIC_KB_ENABLED is unset/false. The embedding endpoint must be
   * OpenAI-compatible at `${baseUrl}/v1/embeddings`. Defaults reuse the chat
   * agent's base URL + API key — most providers expose embeddings on the
   * same host (OpenAI, Dashscope, Together).
   */
  kb: {
    enabled: ['1', 'true', 'yes'].includes((process.env.SCOPIC_KB_ENABLED || '').toLowerCase()),
    embeddingBaseUrl: (process.env.SCOPIC_KB_EMBEDDING_BASE_URL || process.env.SCOPIC_AGENT_BASE_URL || 'http://localhost:4000').replace(/\/$/, ''),
    embeddingApiKey: process.env.SCOPIC_KB_EMBEDDING_API_KEY || process.env.SCOPIC_AGENT_API_KEY || undefined,
    embeddingModel: process.env.SCOPIC_KB_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDim: parseInt(process.env.SCOPIC_KB_EMBEDDING_DIM || '1536', 10),
  },
  session: {
    cookieName: process.env.SCOPIC_COOKIE_NAME || 'scopic.sid',
    /** Sign cookies. Use a long, random value in production. */
    cookieSecret: process.env.SCOPIC_SESSION_SECRET || 'dev-only-scopic-secret',
  },
  oauth: {
    providers: buildOAuthProvidersFromEnv({
      env: process.env,
      publicUrl: (process.env.SCOPIC_PUBLIC_URL || 'http://localhost:17501').replace(/\/$/, ''),
      prefix: 'SCOPIC_',
    }),
  },
  tokenBudget: {
    /** Per-account hosted-model token allowance. 0 disables the cap. */
    defaultLimit: parseTokenLimit(process.env.SCOPIC_DEMO_TOKEN_LIMIT, 50_000),
    /**
     * Fallback charge when an OpenAI-compatible provider omits usage data.
     * Qwen/Dashscope should return usage when stream_options.include_usage=true.
     */
    fallbackTokensPerCall: parseTokenLimit(process.env.SCOPIC_TOKEN_FALLBACK_PER_CALL, 0),
  },
  /**
   * Seed credentials for the dev demo user. In development, a user with this
   * email/password is upserted in Postgres on boot so the login UI works out
   * of the box. In production this seeding is skipped — register real users
   * via POST /api/auth/register.
   */
  demo: {
    email: process.env.SCOPIC_DEMO_EMAIL || 'demo@example.com',
    password: process.env.SCOPIC_DEMO_PASSWORD || 'demo12345',
    name: process.env.SCOPIC_DEMO_NAME || 'Demo Lawyer',
    role: process.env.SCOPIC_DEMO_ROLE || 'attorney',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    /** SQLite db path, relative to the cwd the server starts from. */
    path: process.env.SCOPIC_DB_PATH || './data/scopic.db',
  },
  files: {
    /** Per-file size cap on uploads. Default 25MB. */
    maxUploadBytes: parseInt(process.env.SCOPIC_MAX_UPLOAD_BYTES || `${25 * 1024 * 1024}`, 10),
  },
  markitdown: {
    /** markitdown-agent base URL. When set, the agent gets convert_to_markdown + export_to_docx. */
    baseUrl: (process.env.SCOPIC_MARKITDOWN_AGENT_BASE_URL || '').replace(/\/$/, ''),
  },
  legalResearch: {
    /** CourtListener API token from https://www.courtlistener.com/profile/api/. Optional. */
    courtListenerToken: process.env.SCOPIC_COURTLISTENER_TOKEN || undefined,
    courtListenerBaseUrl: (process.env.SCOPIC_COURTLISTENER_BASE_URL || '').replace(/\/$/, '') || undefined,
    /** PISTE OAuth2 credentials for FR/Legifrance (legislation). Both required to enable. */
    pisteClientId: process.env.SCOPIC_PISTE_CLIENT_ID || undefined,
    pisteClientSecret: process.env.SCOPIC_PISTE_CLIENT_SECRET || undefined,
    /** PISTE API key for FR/Judilibre (case law). */
    judilibreApiKey: process.env.SCOPIC_JUDILIBRE_API_KEY || undefined,
    /** Indian Kanoon API key. Without it, the IN/IndianKanoon provider isn't registered. */
    indianKanoonApiKey: process.env.SCOPIC_INDIANKANOON_API_KEY || undefined,
  },
  templates: {
    /** Directory of `<id>.md` legal document templates with frontmatter. Empty/unset disables the list_templates / get_template tools. */
    dir: process.env.SCOPIC_TEMPLATES_DIR || './templates',
  },
  /**
   * Mothership platform integration. When SCOPIC_PLATFORM_URL is set,
   * Scopic registers itself with the marketplace on startup and accepts
   * platform-proxied chat requests + webhooks via @teamsuzie/platform-bridge.
   */
  platform: {
    url: process.env.SCOPIC_PLATFORM_URL || undefined,
    token: process.env.SCOPIC_PLATFORM_TOKEN || undefined,
    registrationToken: process.env.SCOPIC_PLATFORM_REG_TOKEN || undefined,
  },
  /**
   * Stripe billing (@teamsuzie/billing-stripe). Disabled when STRIPE_SECRET_KEY
   * is unset — the billing routes still mount but every Stripe call throws,
   * and `requireCreditedOrg` returns 402 immediately. In dev set the SK_TEST_*
   * key + run `stripe listen --forward-to localhost:17501/api/billing/webhook`
   * to capture webhooks locally.
   */
  billing: {
    enabled: !!process.env.SCOPIC_STRIPE_SECRET_KEY,
    stripeSecretKey: process.env.SCOPIC_STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.SCOPIC_STRIPE_WEBHOOK_SECRET || '',
    initialCreditsUsd: parseFloat(process.env.SCOPIC_BILLING_INITIAL_CREDITS || '20'),
    topUpAmountUsd: parseFloat(process.env.SCOPIC_BILLING_TOPUP_AMOUNT || '20'),
    lowBalanceThresholdUsd: parseFloat(process.env.SCOPIC_BILLING_LOW_BALANCE_THRESHOLD || '5'),
    /**
     * Dollar rate per 1k tokens used for metering. Total chat-turn deduction
     * = (tokens_used / 1000) * rate. Default $0.01/1k tokens — adjust to
     * match your model pricing. Set to 0 to disable per-turn deductions
     * (the org will still need a positive balance to start a turn).
     */
    usdPer1kTokens: parseFloat(process.env.SCOPIC_BILLING_USD_PER_1K_TOKENS || '0.01'),
  },
};

/**
 * Config consumed by `@teamsuzie/shared-auth` (Sequelize + Redis-backed sessions
 * + CSRF). The defaults point at the Postgres + Redis containers in
 * `docker/docker-compose.yml`. Override in production with real URIs and a
 * long random SCOPIC_SESSION_SECRET.
 */
export const sharedAuthConfig: SharedAuthConfig = {
  node_env: config.nodeEnv,
  redis: {
    uri: process.env.SCOPIC_REDIS_URI || 'redis://localhost:6380/0',
    key_prefix: process.env.SCOPIC_REDIS_KEY_PREFIX || 'scopic',
  },
  postgres: {
    uri:
      process.env.SCOPIC_POSTGRES_URI ||
      'postgres://scopic:scopic@localhost:5433/scopic',
    logging: !!process.env.SCOPIC_POSTGRES_ENABLE_LOGGING,
  },
  cookie: {
    name: config.session.cookieName,
    secret: config.session.cookieSecret,
    domain: process.env.SCOPIC_COOKIE_DOMAIN || undefined,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
  csrf: {
    // The browser-side CSRF lane is handled by @teamsuzie/hosted-demo's
    // createCsrfMiddleware (cookie name 'scopic.csrf'). shared-auth's own
    // CsrfMiddleware isn't mounted in Scopic — this field is required by
    // the SharedAuthConfig type but unused at runtime in this app.
    cookie_name: 'scopic.csrf',
  },
  default_user_id:
    process.env.SCOPIC_DEFAULT_USER_ID ||
    '00000000-0000-0000-0000-000000000000',
};
