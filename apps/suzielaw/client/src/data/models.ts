import { DEFAULT_MODELS, type ModelOption } from '@teamsuzie/ui';
import { LOCAL_MODELS } from '@teamsuzie/agent-loop/local-models';
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
 * Real OpenAI model ids the BYOK path can call. Mirrors the server-side
 * `cloud-providers.ts` OpenAI entry — the ids here are sent to the chat
 * backend, which rewrites the `openai/` prefix away before posting to
 * OpenAI's API. Pick whichever your account has access to.
 */
const OPENAI_MODELS: ScopicModelOption[] = [
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    description: 'Fast, broadly available, strong tool use.',
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'OpenAI',
    description: 'Cheaper and faster — good for verifying your key works.',
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    description: 'Latest GPT-4.1 — strong reasoning and long context.',
  },
  {
    id: 'openai/gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    provider: 'OpenAI',
    description: 'Smaller, cheaper GPT-4.1 variant.',
  },
];

const LOCAL_MODEL_OPTIONS: ScopicModelOption[] = LOCAL_MODELS
  .filter((model) => model.id !== OLLAMA_MODEL_ID)
  .map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    description: model.description,
    local: true,
    isLocal: true,
    resolvedBaseUrl: model.defaultBaseUrl,
    installUrl: model.installUrl,
  }));

/**
 * Suzielaw's model picker list. The configured server default (Qwen) is the
 * demo-budget option; the OpenAI / Anthropic models are BYOK — selectable
 * once the user adds the matching provider key in Settings. The chat handler
 * enforces this server-side too. Ollama is always available for local use.
 *
 * The upstream DEFAULT_MODELS ships a placeholder `openai/gpt-5.5` id that
 * isn't a real OpenAI API model — we drop it and substitute the real GPT
 * ids above so a user's OpenAI key actually returns results.
 */
export const MODELS: ModelOption[] = [
  ...DEFAULT_MODELS.filter((m) => m.id !== 'openai/gpt-5.5'),
  ...OPENAI_MODELS,
  ...LOCAL_MODEL_OPTIONS,
  OLLAMA_MODEL,
];

/**
 * Maps a `ModelOption.id` to the cloud provider id it routes through for
 * BYOK. Mirrors the server-side `cloud-providers.ts` registry. Models
 * absent from this map are treated as not-BYOK (typically: locally hosted
 * or the demo-budget default).
 */
export const MODEL_PROVIDER_ID: Record<string, string | undefined> = {
  'anthropic/claude-sonnet-4-6': 'anthropic',
  'openai/gpt-4o': 'openai',
  'openai/gpt-4o-mini': 'openai',
  'openai/gpt-4.1': 'openai',
  'openai/gpt-4.1-mini': 'openai',
  'qwen3.6-plus': 'dashscope',
};
