import { DEFAULT_MODELS, type ModelOption } from '@teamsuzie/ui';
import { OLLAMA_BASE_URL, OLLAMA_MODEL_ID } from './ollama.js';

type ScopicModelOption = ModelOption & {
  label?: string;
  baseUrl?: string;
  isLocal?: boolean;
};

export const OLLAMA_MODEL: ScopicModelOption = {
  id: OLLAMA_MODEL_ID,
  name: 'Ollama (Local)',
  label: 'Ollama (Local)',
  provider: 'ollama',
  description: 'Use a model running locally in Ollama.',
  local: true,
  isLocal: true,
  baseUrl: OLLAMA_BASE_URL,
  resolvedBaseUrl: OLLAMA_BASE_URL,
  installUrl: 'https://ollama.com/download',
};

/**
 * Suzielaw's model picker list. Qwen 3.6-Plus is the demo-budget default;
 * the rest are BYOK-only — selectable when the user has set their own
 * provider key in Settings, otherwise rendered disabled with a "needs
 * key" hint. The chat handler enforces this server-side too.
 */
export const MODELS: ModelOption[] = [...DEFAULT_MODELS, OLLAMA_MODEL];

/**
 * Maps a `ModelOption.id` to the cloud provider id it routes through for
 * BYOK. Mirrors the server-side `cloud-providers.ts` registry. Models
 * absent from this map are treated as not-BYOK (typically: locally hosted
 * or the demo-budget default).
 */
export const MODEL_PROVIDER_ID: Record<string, string | undefined> = {
  'anthropic/claude-sonnet-4-6': 'anthropic',
  'openai/gpt-5.5': 'openai',
  'qwen3.6-plus': 'dashscope',
};
