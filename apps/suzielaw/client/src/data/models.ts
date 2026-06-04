import type { ModelOption } from '@teamsuzie/ui';
import { OLLAMA_BASE_URL, OLLAMA_MODEL_ID } from './ollama.js';

type ScopicModelOption = ModelOption & {
  label?: string;
  baseUrl?: string;
  isLocal?: boolean;
};

const ANTHROPIC_MODELS: ScopicModelOption[] = [
  {
    id: 'anthropic/claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'Anthropic',
    description: 'Highest-capability Claude option for complex legal analysis.',
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    description: 'Balanced Claude option for drafting, review, and day-to-day work.',
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    description: 'Fast Claude option for lighter tasks.',
  },
];

const OPENAI_MODELS: ScopicModelOption[] = [
  {
    id: 'openai/gpt-5.5',
    name: 'GPT-5.5',
    provider: 'OpenAI',
    description: 'Latest GPT option for high-quality legal drafting and analysis.',
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    provider: 'OpenAI',
    description: 'Balanced GPT option for everyday legal workflows.',
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    provider: 'OpenAI',
    description: 'Fast GPT option for lower-stakes or high-volume tasks.',
  },
];

const GOOGLE_MODELS: ScopicModelOption[] = [
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    description: 'Advanced Gemini option for complex prompts and long-context work.',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'Google',
    description: 'Fast Gemini option for everyday work.',
  },
];

const QWEN_MODELS: ScopicModelOption[] = [
  {
    id: 'qwen3.7-max',
    name: 'Qwen 3.7 Max',
    provider: 'Alibaba Cloud',
    description: 'Highest-capability Qwen option through DashScope.',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen 3.6 Plus',
    provider: 'Alibaba Cloud',
    description: 'Balanced Qwen option through DashScope.',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen 3.6 Flash',
    provider: 'Alibaba Cloud',
    description: 'Fast Qwen option through DashScope.',
  },
];

export const OLLAMA_MODEL: ScopicModelOption = {
  id: OLLAMA_MODEL_ID,
  name: 'Ollama (Local)',
  label: 'Ollama (Local)',
  provider: 'Ollama',
  description: 'Use a model running locally in Ollama.',
  local: true,
  isLocal: true,
  baseUrl: OLLAMA_BASE_URL,
  resolvedBaseUrl: OLLAMA_BASE_URL,
  installUrl: 'https://ollama.com/download',
};

/**
 * Lawyer-facing shortlist. Keep this deliberately small: current flagship,
 * balanced, and fast models per supported cloud provider. Provider catalogs
 * include dated snapshots, legacy models, audio/search/embedding models, and
 * preview variants that make Settings hard to scan.
 */
export const MODELS: ModelOption[] = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
  ...QWEN_MODELS,
  OLLAMA_MODEL,
];

/**
 * Maps a `ModelOption.id` to the cloud provider id it routes through for
 * BYOK. Mirrors the server-side `cloud-providers.ts` registry. Models absent
 * from this map are treated as local/non-BYOK options.
 */
export const MODEL_PROVIDER_ID: Record<string, string | undefined> = {
  'anthropic/claude-opus-4-8': 'anthropic',
  'anthropic/claude-sonnet-4-6': 'anthropic',
  'anthropic/claude-haiku-4-5': 'anthropic',
  'openai/gpt-5.5': 'openai',
  'openai/gpt-5.4': 'openai',
  'openai/gpt-5.4-mini': 'openai',
  'gemini-3.1-pro-preview': 'google',
  'gemini-3.5-flash': 'google',
  'qwen3.7-max': 'dashscope',
  'qwen3.6-plus': 'dashscope',
  'qwen3.6-flash': 'dashscope',
};
