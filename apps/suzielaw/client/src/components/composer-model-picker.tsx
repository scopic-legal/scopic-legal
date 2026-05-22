import type { ModelOption } from '@teamsuzie/ui';
import {
  OLLAMA_MODEL_ID,
  SELECTED_OLLAMA_MODEL_KEY,
  readSelectedOllamaModel,
} from '../data/ollama.js';
import { useOllamaModels } from '../hooks/use-ollama-models.js';

const OLLAMA_VALUE_PREFIX = 'ollama::';

interface Props {
  /** Cloud / default models already filtered to the ones the user can use. */
  models: ModelOption[];
  /** Currently selected model id (the `scopic:selected-model` value). */
  selectedModel: string | undefined;
  /** Server's configured default model id - used when nothing is selected. */
  defaultModelId?: string;
  /** Persist a non-Ollama model selection (writes `scopic:selected-model`). */
  onSelectModel: (id: string | undefined) => void;
  disabled?: boolean;
}

/**
 * Compact in-composer model selector. Mirrors the Settings model picker but
 * lives next to the Files / Workflow buttons so the user can switch models
 * without leaving the chat. Locally-discovered Ollama models are listed
 * inline; picking one stores `ollama` as the selected model plus the Ollama
 * sub-model name in localStorage, which `selectedModelPayload` reads at send.
 */
export function ComposerModelPicker({
  models,
  selectedModel,
  defaultModelId,
  onSelectModel,
  disabled,
}: Props) {
  const { models: ollamaModels } = useOllamaModels();

  const currentValue =
    selectedModel === OLLAMA_MODEL_ID
      ? `${OLLAMA_VALUE_PREFIX}${readSelectedOllamaModel() ?? ''}`
      : selectedModel ?? defaultModelId ?? '';

  const groups = new Map<string, ModelOption[]>();
  for (const m of models) {
    const label = m.provider || 'Cloud';
    const list = groups.get(label) ?? [];
    list.push(m);
    groups.set(label, list);
  }

  function handleChange(value: string) {
    if (value.startsWith(OLLAMA_VALUE_PREFIX)) {
      const name = value.slice(OLLAMA_VALUE_PREFIX.length);
      if (name) window.localStorage.setItem(SELECTED_OLLAMA_MODEL_KEY, name);
      onSelectModel(OLLAMA_MODEL_ID);
      return;
    }
    onSelectModel(value);
  }

  return (
    <label className="inline-flex items-center gap-1.5" title="Model that powers Counsel">
      <span className="sr-only">Model</span>
      <select
        value={currentValue}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        className="h-7 max-w-[180px] truncate border border-foreground/20 bg-background px-2 font-mono text-[10px] uppercase tracking-[0.10em] text-foreground/70 hover:border-foreground/40 hover:text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-saffron-400 disabled:opacity-50"
      >
        {Array.from(groups.entries()).map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        ))}
        {ollamaModels.length > 0 && (
          <optgroup label="Local (Ollama)">
            {ollamaModels.map((name) => (
              <option key={name} value={`${OLLAMA_VALUE_PREFIX}${name}`}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
