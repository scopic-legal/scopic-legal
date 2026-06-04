import { resolveAgentTarget } from '@teamsuzie/agent-loop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extraBodyForProvider,
  fetchProviderModels,
  providerForModel,
  wireModelIdFor,
} from '../cloud-providers.js';

const defaultQwenAgent = {
  baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
  apiKey: 'demo-key',
  model: 'qwen3.6-plus',
  extraBody: { enable_thinking: false },
};

describe('cloud provider BYOK routing', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('clears inherited Qwen body fields for OpenAI routes', () => {
    const provider = providerForModel('openai/gpt-5.5');
    expect(provider).not.toBeNull();

    const agent = resolveAgentTarget(
      'openai/gpt-5.5',
      {
        'openai/gpt-5.5': {
          baseUrl: provider!.baseUrl,
          apiKey: 'sk-openai',
          model: wireModelIdFor('openai/gpt-5.5'),
          extraBody: extraBodyForProvider(provider!),
        },
      },
      defaultQwenAgent,
    );

    expect(agent.baseUrl).toBe('https://api.openai.com');
    expect(agent.model).toBe('gpt-5.5');
    expect(agent.extraBody).toEqual({});
  });

  it('keeps Dashscope thinking controls on Qwen routes', () => {
    const provider = providerForModel('qwen3.6-plus');
    expect(provider).not.toBeNull();

    expect(extraBodyForProvider(provider!)).toEqual({
      enable_thinking: false,
    });
  });

  it('filters live provider catalogs to the curated picker shortlist', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-3.5-turbo' },
            { id: 'gpt-4-turbo-2024-04-09' },
            { id: 'gpt-5.5' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch;

    const provider = providerForModel('openai/gpt-5.5');
    expect(provider).not.toBeNull();

    const models = await fetchProviderModels(provider!, 'sk-openai');

    expect(models.map((m) => m.id)).toEqual([
      'openai/gpt-5.5',
      'openai/gpt-5.4',
      'openai/gpt-5.4-mini',
    ]);
  });

  it('maps Gemini ids to the Google provider', () => {
    const provider = providerForModel('gemini-3.5-flash');
    expect(provider?.id).toBe('google');
  });
});
