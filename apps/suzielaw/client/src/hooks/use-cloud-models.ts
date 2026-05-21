import { useEffect, useState } from 'react';
import type { ModelOption } from '@teamsuzie/ui';

interface CloudModelsResult {
  /** Live models across the requested providers, as picker options. */
  models: ModelOption[];
  loading: boolean;
}

/** Display labels for the optgroup headers; falls back to the raw id. */
const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  dashscope: 'Qwen (Alibaba)',
};

/**
 * Fetches the live model catalog for each cloud provider the user has a key
 * for (server endpoint `/api/cloud-models/:providerId`, which queries the
 * provider's own `/v1/models` with the saved key). This keeps the picker in
 * sync with whatever models the account can actually call — including models
 * released after this code shipped — instead of a hard-coded list.
 */
export function useCloudModels(providerIds: string[]): CloudModelsResult {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  // Stable dependency so the effect only re-runs when the set changes.
  const key = providerIds.slice().sort().join(',');

  useEffect(() => {
    if (!key) {
      setModels([]);
      return;
    }
    const ids = key.split(',');
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const collected: ModelOption[] = [];
      await Promise.all(
        ids.map(async (providerId) => {
          try {
            const response = await fetch(
              `/api/cloud-models/${encodeURIComponent(providerId)}`,
              { credentials: 'include' },
            );
            if (!response.ok) return;
            const data = (await response.json()) as {
              models?: Array<{ id: string; name: string }>;
            };
            const label = PROVIDER_LABELS[providerId] ?? providerId;
            for (const m of data.models ?? []) {
              collected.push({ id: m.id, name: m.name, provider: label });
            }
          } catch {
            // Provider unreachable — skip; curated seeds still cover it.
          }
        }),
      );
      if (!cancelled) {
        setModels(collected);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { models, loading };
}
