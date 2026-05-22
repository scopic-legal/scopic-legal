export const OLLAMA_MODEL_ID = 'ollama';
export const OLLAMA_PROVIDER_ID = 'ollama';
export const OLLAMA_BASE_URL = 'http://localhost:11434';
export const OLLAMA_MODELS_URL = '/api/local-models/ollama/models';
export const SELECTED_OLLAMA_MODEL_KEY = 'scopic:ollama-model';

export function readSelectedOllamaModel(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(SELECTED_OLLAMA_MODEL_KEY) || undefined;
}

export function selectedModelPayload(selectedModel?: string): {
  model?: string;
  modelProvider?: string;
} {
  if (selectedModel !== OLLAMA_MODEL_ID) {
    return { model: selectedModel };
  }

  const ollamaModel = readSelectedOllamaModel();
  return ollamaModel
    ? { model: ollamaModel, modelProvider: OLLAMA_PROVIDER_ID }
    : { model: OLLAMA_MODEL_ID, modelProvider: OLLAMA_PROVIDER_ID };
}
