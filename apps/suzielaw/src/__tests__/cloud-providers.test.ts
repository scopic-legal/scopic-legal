import { resolveAgentTarget } from '@teamsuzie/agent-loop';
import { describe, expect, it } from 'vitest';
import {
  extraBodyForProvider,
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
});
