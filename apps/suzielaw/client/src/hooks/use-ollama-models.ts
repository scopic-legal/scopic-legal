import { useCallback, useEffect, useState } from 'react';
import { OLLAMA_MODELS_URL } from '../data/ollama.js';

interface OllamaModelsResponse {
  baseUrl?: string;
  models?: Array<{ id?: string; name?: string; model?: string }>;
  message?: string;
}

export function useOllamaModels(active = true) {
  const [models, setModels] = useState<string[]>([]);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(OLLAMA_MODELS_URL, {
        credentials: 'include',
        signal,
      });
      const data = (await response.json().catch(() => ({}))) as OllamaModelsResponse;
      if (!response.ok) {
        throw new Error(data.message || `Ollama model list failed (${response.status})`);
      }
      const names = (data.models ?? [])
        .map((model) => model.name ?? model.model ?? model.id ?? '')
        .map((name) => name.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setModels(names);
      setBaseUrl(data.baseUrl ?? null);
    } catch (err) {
      if (!signal?.aborted) {
        setModels([]);
        setError(err instanceof Error ? err.message : 'Unable to list Ollama models');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [active, refresh]);

  return { models, baseUrl, loading, error, refresh };
}
