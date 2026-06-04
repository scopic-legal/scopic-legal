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
   * fetch is unavailable, and used as the Settings/composer picker shortlist.
   * Not an allow-list for prefixed providers — routing is still prefix-based.
   */
  modelIds: string[];
  /** Optional friendly display names keyed by UI model id. */
  modelNames?: Record<string, string>;
  /**
   * OpenAI-style `GET /v1/models` URL. When set, the app checks the live
   * catalog with the user's key, then filters it to the curated shortlist.
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

export const GOOGLE_OPENAI_COMPAT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    modelPrefix: 'anthropic/',
    modelsUrl: 'https://api.anthropic.com/v1/models',
    listAuth: 'anthropic',
    chatModelMatchers: ['claude'],
    // Lawyer-facing shortlist. Keep this to the current flagship/balanced set;
    // do not surface dated snapshots from the provider catalog.
    modelIds: [
      'anthropic/claude-opus-4-8',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
    ],
    modelNames: {
      'anthropic/claude-opus-4-8': 'Claude Opus 4.8',
      'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6',
      'anthropic/claude-haiku-4-5': 'Claude Haiku 4.5',
    },
    hint: 'Use Claude through Anthropic. Once your key is saved, Counsel can call the current Claude chat models.',
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
    // Lawyer-facing shortlist. Keep this to current GPT chat models, not dated snapshots.
    modelIds: [
      'openai/gpt-5.5',
      'openai/gpt-5.4',
      'openai/gpt-5.4-mini',
    ],
    modelNames: {
      'openai/gpt-5.5': 'GPT-5.5',
      'openai/gpt-5.4': 'GPT-5.4',
      'openai/gpt-5.4-mini': 'GPT-5.4 mini',
    },
    hint: 'Add a key from your OpenAI account. Once saved, Counsel can call the current GPT chat models.',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'dashscope',
    label: 'Alibaba Cloud (Qwen)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
    modelsUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
    listAuth: 'bearer',
    chatModelMatchers: ['qwen'],
    modelIds: ['qwen3.7-max', 'qwen3.6-plus', 'qwen3.6-flash'],
    modelNames: {
      'qwen3.7-max': 'Qwen 3.7 Max',
      'qwen3.6-plus': 'Qwen 3.6 Plus',
      'qwen3.6-flash': 'Qwen 3.6 Flash',
    },
    extraBody: { enable_thinking: false },
    hint: 'Use Qwen models through Alibaba Cloud DashScope. Once your key is saved, the picker lists available Qwen models.',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    baseUrl: GOOGLE_OPENAI_COMPAT_BASE_URL,
    modelsUrl: `${GOOGLE_OPENAI_COMPAT_BASE_URL}/models`,
    listAuth: 'bearer',
    chatModelMatchers: ['gemini'],
    modelIds: ['gemini-3.1-pro-preview', 'gemini-3.5-flash'],
    modelNames: {
      'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
      'gemini-3.5-flash': 'Gemini 3.5 Flash',
    },
    hint: 'Use Gemini through Google AI Studio. Once your key is saved, Counsel can call the current Gemini chat models.',
    keyUrl: 'https://aistudio.google.com/apikey',
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
 * stripped (`openai/gpt-5.5` → `gpt-5.5`). Falls back to the input unchanged.
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
  const fallback = provider.modelIds.map((id) => ({
    id,
    name:
      provider.modelNames?.[id] ??
      (provider.modelPrefix ? id.slice(provider.modelPrefix.length) : id),
  }));
  if (!provider.modelsUrl) {
    return fallback;
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
  const curated = new Set(provider.modelIds);
  const seen = new Set<string>();
  const liveById = new Map<string, { id: string; name: string }>();
  for (const entry of body.data ?? []) {
    const bareId = (entry.id ?? '').trim();
    if (!bareId || seen.has(bareId)) continue;
    if (matchers.length > 0 && !matchers.some((m) => bareId.toLowerCase().includes(m))) {
      continue;
    }
    seen.add(bareId);
    const id = provider.modelPrefix ? `${provider.modelPrefix}${bareId}` : bareId;
    if (!curated.has(id)) continue;
    liveById.set(id, {
      id,
      name: (provider.modelNames?.[id] ?? entry.display_name?.trim()) || bareId,
    });
  }
  return provider.modelIds
    .map((id) => liveById.get(id) ?? fallback.find((m) => m.id === id)!)
    .filter(Boolean);
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
