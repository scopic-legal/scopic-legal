/**
 * Cloud providers the app supports for BYOK. Each entry maps a
 * provider id (opaque string used by `@teamsuzie/model-settings`'s
 * `provider_keys` table) to:
 *   - `label`: display name in the settings UI
 *   - `baseUrl`: OpenAI-compatible base URL (the agent loop appends
 *     `/v1/chat/completions`)
 *   - `modelIds`: model ids that route to this provider when the user
 *     has a BYOK key for it. If a model id appears here, the chat
 *     handler accepts it as a valid request when the corresponding
 *     provider key is set.
 *   - `wireModelIds` (optional): UI model id → wire model id rewrites.
 *     The picker uses prefixed ids (`anthropic/claude-sonnet-4-6`,
 *     `openai/gpt-5.5`) for clarity in the UI, but the actual provider
 *     APIs expect bare ids (`claude-sonnet-4-6`, `gpt-5.5`). When BYOK
 *     fires for one of these, the chat handler rewrites the request
 *     body's `model` field via this map before posting.
 *   - `extraBody` (optional): provider-specific request body extensions
 *     accepted by that provider. Omitted means "send no non-standard fields".
 *
 * Anthropic uses Anthropic's OpenAI-compatibility endpoint
 * (`/v1/chat/completions`), so it slots in alongside OpenAI / Dashscope
 * without needing a native adapter in `@teamsuzie/agent-loop`. Some
 * advanced features (extended thinking, prompt caching) may behave
 * differently than via the native Messages API — verify before relying
 * on them.
 */
export interface CloudProvider {
  id: string;
  label: string;
  baseUrl: string;
  /**
   * UI model-id namespace for this provider (e.g. `openai/`, `anthropic/`).
   * Any model id that starts with this prefix routes to the provider, and the
   * prefix is stripped before the id is sent on the wire. This is what lets a
   * user pick *any* model the provider offers — including ones newer than this
   * code — without us maintaining a hard-coded allow-list. Providers that use
   * bare wire ids (Dashscope/Qwen) leave this unset.
   */
  modelPrefix?: string;
  /**
   * Curated fallback model ids (prefixed). Shown when the live `/v1/models`
   * fetch is unavailable, and used to seed the picker before the live list
   * loads. Not an allow-list — routing is prefix-based.
   */
  modelIds: string[];
  /**
   * OpenAI-style `GET /v1/models` URL. When set, the app fetches the live
   * catalog with the user's key so the newest models appear automatically.
   */
  modelsUrl?: string;
  /** How to authenticate the `modelsUrl` request. */
  listAuth?: 'bearer' | 'anthropic';
  /**
   * Substring/prefix matches used to keep only chat-capable models from the
   * live `/v1/models` response (which also lists embeddings, audio, etc.).
   * Matched against the bare (unprefixed) model id. Empty = keep all.
   */
  chatModelMatchers?: string[];
  /** Optional UI id → wire id rewrite. Defaults to stripping `modelPrefix`. */
  wireModelIds?: Record<string, string>;
  /** Optional provider-specific request-body extensions. */
  extraBody?: Record<string, unknown>;
  /** Optional helper text rendered under the input in the settings dialog. */
  hint?: string;
  /** Optional URL where users find their key. */
  keyUrl?: string;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    modelPrefix: 'anthropic/',
    modelsUrl: 'https://api.anthropic.com/v1/models',
    listAuth: 'anthropic',
    chatModelMatchers: ['claude'],
    // Seed list only — the live /v1/models fetch supersedes this and surfaces
    // whatever Claude models your key can actually call (including newer ones).
    modelIds: [
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
    ],
    hint: 'Powers Claude. Once your key is saved, the picker lists every Claude model your account can call.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    modelPrefix: 'openai/',
    modelsUrl: 'https://api.openai.com/v1/models',
    listAuth: 'bearer',
    chatModelMatchers: ['gpt', 'o1', 'o3', 'o4', 'chatgpt'],
    // Seed list only — superseded by the live /v1/models fetch.
    modelIds: [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'openai/gpt-4.1',
      'openai/gpt-4.1-mini',
    ],
    hint: 'Add a key from your OpenAI account — usage is billed to your account. Once saved, the picker lists every GPT model your account can call.',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'dashscope',
    label: 'Alibaba Cloud (Qwen — recommended)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
    modelsUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
    listAuth: 'bearer',
    chatModelMatchers: ['qwen'],
    modelIds: ['qwen3.6-plus'],
    extraBody: { enable_thinking: false },
    hint: 'Powers the default Qwen model. Free tier available — sign up for a free key to get started immediately.',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
];

/**
 * Returns the provider that owns this model id, or null. Prefix-based: any id
 * shaped `<prefix>/<model>` routes to the provider whose `modelPrefix` matches,
 * so models newer than this code still resolve. Falls back to exact membership
 * for bare ids (e.g. the default `qwen3.6-plus`).
 */
export function providerForModel(modelId: string): CloudProvider | null {
  for (const p of CLOUD_PROVIDERS) {
    if (p.modelPrefix && modelId.startsWith(p.modelPrefix)) return p;
  }
  for (const p of CLOUD_PROVIDERS) {
    if (p.modelIds.includes(modelId)) return p;
  }
  return null;
}

/**
 * Map a UI model id to the wire id its provider expects. An explicit
 * `wireModelIds` entry wins; otherwise the provider's `modelPrefix` is
 * stripped (`openai/gpt-4o` → `gpt-4o`). Falls back to the input unchanged.
 */
export function wireModelIdFor(uiModelId: string): string {
  for (const p of CLOUD_PROVIDERS) {
    if (p.wireModelIds && uiModelId in p.wireModelIds) {
      return p.wireModelIds[uiModelId]!;
    }
  }
  for (const p of CLOUD_PROVIDERS) {
    if (p.modelPrefix && uiModelId.startsWith(p.modelPrefix)) {
      return uiModelId.slice(p.modelPrefix.length);
    }
  }
  return uiModelId;
}

/**
 * Fetch the provider's live model catalog via its OpenAI-style `/v1/models`
 * endpoint using the caller's key, filtered to chat-capable models and
 * returned as prefixed UI ids. Throws on network / auth failure so callers
 * can fall back to the curated `modelIds`.
 */
export async function fetchProviderModels(
  provider: CloudProvider,
  apiKey: string,
): Promise<{ id: string; name: string }[]> {
  if (!provider.modelsUrl) {
    return provider.modelIds.map((id) => ({
      id,
      name: provider.modelPrefix ? id.slice(provider.modelPrefix.length) : id,
    }));
  }
  const headers: Record<string, string> =
    provider.listAuth === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };
  const response = await fetch(provider.modelsUrl, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`${provider.label} model list failed (${response.status})`);
  }
  const body = (await response.json()) as {
    data?: Array<{ id?: string; display_name?: string }>;
  };
  const matchers = provider.chatModelMatchers ?? [];
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const entry of body.data ?? []) {
    const bareId = (entry.id ?? '').trim();
    if (!bareId || seen.has(bareId)) continue;
    if (matchers.length > 0 && !matchers.some((m) => bareId.toLowerCase().includes(m))) {
      continue;
    }
    seen.add(bareId);
    out.push({
      id: provider.modelPrefix ? `${provider.modelPrefix}${bareId}` : bareId,
      name: entry.display_name?.trim() || bareId,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Body extensions to use when routing directly to a cloud provider. The empty
 * object is intentional: BYOK routes must not inherit default-agent provider
 * knobs such as Dashscope's `enable_thinking` when the target is OpenAI.
 */
export function extraBodyForProvider(provider: CloudProvider): Record<string, unknown> {
  return provider.extraBody ?? {};
}

/** Convenience: provider ids only. */
export const CLOUD_PROVIDER_IDS = CLOUD_PROVIDERS.map((p) => p.id);
