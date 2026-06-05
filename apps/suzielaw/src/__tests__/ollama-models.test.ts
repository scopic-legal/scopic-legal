import { describe, expect, it, vi } from 'vitest';
import {
  fetchOllamaModels,
  modelNamesFromOllamaTags,
  modelNamesFromOpenAIModels,
  ollamaModelSupportsTools,
} from '../ollama-models.js';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Ollama model discovery', () => {
  it('dedupes tag results and marks models without the tools capability', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/api/tags')) {
        return json({
          models: [
            { name: 'phi3:latest' },
            { model: 'llama3.1:latest' },
            { name: 'phi3:latest' },
          ],
        });
      }
      if (href.endsWith('/api/show')) {
        const model = JSON.parse(
          (fetchMock.mock.calls.at(-1)?.[1]?.body as string) ?? '{}',
        ).model;
        return json({
          capabilities:
            model === 'llama3.1:latest'
              ? ['completion', 'tools']
              : ['completion'],
        });
      }
      return json({}, 404);
    });

    const models = await fetchOllamaModels(
      'http://localhost:11434/v1',
      undefined,
      fetchMock as unknown as typeof fetch,
    );

    expect(models).toEqual([
      {
        id: 'llama3.1:latest',
        name: 'llama3.1:latest',
        capabilities: ['completion', 'tools'],
        supportsTools: true,
      },
      {
        id: 'phi3:latest',
        name: 'phi3:latest',
        capabilities: ['completion'],
        supportsTools: false,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/tags');
  });

  it('falls back to OpenAI-compatible /v1/models and keeps unknown capabilities non-fatal', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/api/tags')) return json({ error: 'missing' }, 404);
      if (href.endsWith('/v1/models')) {
        return json({ data: [{ id: 'custom-local:latest' }] });
      }
      if (href.endsWith('/api/show')) return json({ error: 'missing' }, 404);
      return json({}, 404);
    });

    await expect(
      fetchOllamaModels('http://local.test', undefined, fetchMock as unknown as typeof fetch),
    ).resolves.toEqual([
      {
        id: 'custom-local:latest',
        name: 'custom-local:latest',
        capabilities: [],
        supportsTools: null,
      },
    ]);
  });
});

describe('Ollama model parsing', () => {
  it('parses model names from native and OpenAI-compatible responses', () => {
    expect(
      modelNamesFromOllamaTags({
        models: [{ name: 'mistral:latest' }, { model: 'qwen:7b' }, { name: ' ' }],
      }),
    ).toEqual(['mistral:latest', 'qwen:7b']);

    expect(
      modelNamesFromOpenAIModels({
        data: [{ id: 'llama3.2' }, { name: 'gemma3' }, { id: '' }],
      }),
    ).toEqual(['llama3.2', 'gemma3']);
  });

  it('treats missing capabilities as unknown rather than supported', () => {
    expect(ollamaModelSupportsTools(['completion', 'tools'])).toBe(true);
    expect(ollamaModelSupportsTools(['completion'])).toBe(false);
    expect(ollamaModelSupportsTools(null)).toBeNull();
  });
});
