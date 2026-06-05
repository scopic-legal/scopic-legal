import { useMemo } from 'react';
import type { ModelOption } from '@teamsuzie/ui';
import { MODELS, MODEL_PROVIDER_ID } from '../data/models.js';
import { OLLAMA_MODEL_ID } from '../data/ollama.js';
import { useCloudModels } from './use-cloud-models.js';
import type { ProviderKeyPublic } from './use-provider-keys.js';

/**
 * Models shown in chat composers. Mirrors Settings' lawyer-facing shortlist:
 * seeded current models for keyed providers, plus any live provider results
 * the server has already filtered down to Scopic's curated catalog.
 */
export function useComposerModels(
  providers: ProviderKeyPublic[],
  defaultModel?: string,
): ModelOption[] {
  const providerIdsWithKeys = useMemo(
    () => providers.filter((p) => p.hasKey).map((p) => p.providerId),
    [providers],
  );
  const liveModels = useCloudModels(providerIdsWithKeys);

  return useMemo(() => {
    const keysByProvider = new Map(providers.map((p) => [p.providerId, p]));
    const byId = new Map<string, ModelOption>();
    for (const m of MODELS) {
      if (m.local && m.id === OLLAMA_MODEL_ID) continue;
      const providerId = MODEL_PROVIDER_ID[m.id];
      const usable =
        m.local ||
        m.id === defaultModel ||
        (providerId ? keysByProvider.get(providerId)?.hasKey ?? false : false);
      if (usable) byId.set(m.id, m);
    }
    for (const m of liveModels.models) {
      if (!byId.has(m.id)) byId.set(m.id, m);
    }
    return Array.from(byId.values());
  }, [providers, defaultModel, liveModels.models]);
}
