export const OLLAMA_PROVIDER_ID = 'ollama';
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

export interface OllamaModelInfo {
  id: string;
  name: string;
  capabilities: string[];
  supportsTools: boolean | null;
}

export function normalizeOpenAICompatibleBaseUrl(value: string | undefined): string | undefined {
  return value?.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function modelNamesFromOllamaTags(data: unknown): string[] {
  const models = (data as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const candidate = entry as { name?: unknown; model?: unknown };
      return typeof candidate.name === 'string'
        ? candidate.name
        : typeof candidate.model === 'string'
          ? candidate.model
          : '';
    })
    .map((name) => name.trim())
    .filter(Boolean);
}

export function modelNamesFromOpenAIModels(data: unknown): string[] {
  const models = (data as { data?: unknown })?.data;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const candidate = entry as { id?: unknown; name?: unknown };
      return typeof candidate.id === 'string'
        ? candidate.id
        : typeof candidate.name === 'string'
          ? candidate.name
          : '';
    })
    .map((name) => name.trim())
    .filter(Boolean);
}

export function uniqueSortedModelNames(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function ollamaModelSupportsTools(capabilities: string[] | null | undefined): boolean | null {
  if (!capabilities) return null;
  return capabilities.map((capability) => capability.toLowerCase()).includes('tools');
}

async function fetchJsonWithOptionalBearer(
  url: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${url} returned ${response.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return response.json();
}

export async function fetchOllamaModelCapabilities(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl) ?? OLLAMA_DEFAULT_BASE_URL;
  const response = await fetchJsonWithOptionalBearer(`${normalized}/api/show`, apiKey, async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    return fetchImpl(url, {
      ...init,
      headers,
      method: 'POST',
      body: JSON.stringify({ model }),
    });
  });
  const capabilities = (response as { capabilities?: unknown })?.capabilities;
  if (!Array.isArray(capabilities)) return null;
  return capabilities.filter((capability): capability is string => typeof capability === 'string');
}

export async function fetchOllamaModels(
  baseUrl: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaModelInfo[]> {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl) ?? OLLAMA_DEFAULT_BASE_URL;
  let names: string[] = [];

  try {
    const native = await fetchJsonWithOptionalBearer(`${normalized}/api/tags`, apiKey, fetchImpl);
    names = modelNamesFromOllamaTags(native);
  } catch {
    // Some local gateways expose only the OpenAI-compatible model list.
  }

  if (names.length === 0) {
    const openai = await fetchJsonWithOptionalBearer(`${normalized}/v1/models`, apiKey, fetchImpl);
    names = modelNamesFromOpenAIModels(openai);
  }

  const uniqueNames = uniqueSortedModelNames(names);
  const models = await Promise.all(
    uniqueNames.map(async (name): Promise<OllamaModelInfo> => {
      try {
        const capabilities = await fetchOllamaModelCapabilities(normalized, apiKey, name, fetchImpl);
        return {
          id: name,
          name,
          capabilities: capabilities ?? [],
          supportsTools: ollamaModelSupportsTools(capabilities),
        };
      } catch {
        return {
          id: name,
          name,
          capabilities: [],
          supportsTools: null,
        };
      }
    }),
  );

  return models;
}

export async function fetchOllamaModelNames(
  baseUrl: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const models = await fetchOllamaModels(baseUrl, apiKey, fetchImpl);
  return models.map((model) => model.name);
}
