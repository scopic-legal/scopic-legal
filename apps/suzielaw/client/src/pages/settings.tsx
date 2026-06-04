import { useEffect, useMemo, useState } from 'react';
import {
  AppShellContent,
  LocalModelConfigDialog,
  ModelPickerCard,
  useSelectedModel,
  type ModelOption,
} from '@teamsuzie/ui';
import { MODELS, MODEL_PROVIDER_ID } from '../data/models.js';
import {
  OLLAMA_MODEL_ID,
  SELECTED_OLLAMA_MODEL_KEY,
} from '../data/ollama.js';
import { useModelSettings } from '../hooks/use-model-settings.js';
import { useProviderKeys } from '../hooks/use-provider-keys.js';
import { useCloudModels } from '../hooks/use-cloud-models.js';
import { useOllamaModels } from '../hooks/use-ollama-models.js';
import {
  ProviderKeysCard,
  type ProviderDisplay,
} from '../components/provider-keys-card.js';

const SELECTED_MODEL_KEY = 'scopic:selected-model';
const OLLAMA_NOT_RUNNING =
  'Ollama is not running. Install Ollama and start it, then return here.';

interface Props {
  /** Server's configured default model — used as fallback when nothing is in localStorage. */
  defaultModel?: string;
  /** Cloud BYOK providers from `/api/health.cloudProviders`. */
  cloudProviders?: ProviderDisplay[];
}

function OllamaModelSelect({ active }: { active: boolean }) {
  const { models, baseUrl, loading, error } = useOllamaModels(active);
  const [selected, setSelected] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(SELECTED_OLLAMA_MODEL_KEY) ?? '';
  });

  function persistSelection(model: string) {
    setSelected(model);
    if (typeof window === 'undefined') return;
    if (model) {
      window.localStorage.setItem(SELECTED_OLLAMA_MODEL_KEY, model);
    } else {
      window.localStorage.removeItem(SELECTED_OLLAMA_MODEL_KEY);
    }
  }

  useEffect(() => {
    if (!active) return;
    if (models.length > 0 && !models.includes(selected)) {
      persistSelection(models[0]!);
    }
  }, [active, models, selected]);

  if (!active) return null;

  return (
    <div className="lg:col-span-2 border border-foreground/15 bg-background px-4 py-3">
      <label
        htmlFor="ollama-model-select"
        className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/50"
      >
        Ollama model
      </label>
      {baseUrl && (
        <p className="mt-1 font-mono text-[10px] text-foreground/45">
          {baseUrl}
        </p>
      )}
      <select
        id="ollama-model-select"
        value={selected}
        disabled={loading || models.length === 0}
        onChange={(event) => persistSelection(event.target.value)}
        className="mt-2 block w-full border border-foreground/30 bg-background px-3 py-2.5 font-mono text-[13px] text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-saffron-400 disabled:opacity-50"
      >
        {models.length === 0 ? (
          <option value="">{loading ? 'Loading Ollama models...' : 'No models found'}</option>
        ) : (
          models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))
        )}
      </select>
      {error && (
        <p
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.10em] text-destructive"
          title={error}
        >
          {OLLAMA_NOT_RUNNING}
        </p>
      )}
    </div>
  );
}

export function SettingsPage({ defaultModel, cloudProviders = [] }: Props) {
  const [selectedModel, setSelectedModel] = useSelectedModel(SELECTED_MODEL_KEY, defaultModel);
  const modelSettings = useModelSettings();
  const providerKeys = useProviderKeys();
  const [configuringModel, setConfiguringModel] = useState<ModelOption | null>(null);

  // BYOK gate: cloud models are visible once the user has set a key for
  // that provider. The server's configured default stays visible so existing
  // installs keep a working fallback.
  const providerIdsWithKeys = useMemo(
    () => providerKeys.providers.filter((p) => p.hasKey).map((p) => p.providerId),
    [providerKeys.providers],
  );
  const liveModels = useCloudModels(providerIdsWithKeys);

  const models: ModelOption[] = useMemo(() => {
    const byId = new Map(modelSettings.settings.map((s) => [s.modelId, s]));
    const keysByProvider = new Map(
      providerKeys.providers.map((p) => [p.providerId, p]),
    );
    const merged = new Map<string, ModelOption>();
    // Curated shortlist only: current flagship/balanced/fast models per
    // provider, plus local options.
    for (const m of MODELS) {
      const usable =
        m.local ||
        m.id === defaultModel ||
        (MODEL_PROVIDER_ID[m.id]
          ? keysByProvider.get(MODEL_PROVIDER_ID[m.id]!)?.hasKey ?? false
          : false);
      if (usable) merged.set(m.id, m);
    }
    // The server filters live catalogs to the same shortlist. Keep the local
    // row metadata when a seeded id is already present.
    for (const m of liveModels.models) {
      if (!merged.has(m.id)) merged.set(m.id, m);
    }
    return Array.from(merged.values()).map((m) => {
      const setting = byId.get(m.id);
      return setting ? { ...m, resolvedBaseUrl: setting.baseUrl } : m;
    });
  }, [modelSettings.settings, providerKeys.providers, defaultModel, liveModels.models]);

  const configuringSetting = configuringModel
    ? modelSettings.settings.find((s) => s.modelId === configuringModel.id)
    : null;

  return (
    <>
      <div className="border-b border-foreground/15 px-8 pb-6 pt-8">
        <div className="label-mono text-foreground/50">Configuration</div>
        <h1 className="mt-2 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold leading-[1] tracking-[-0.02em] text-foreground">
          Settings.
        </h1>
        <p className="mt-3 font-serif text-[15px] italic text-foreground/65">
          Connect Counsel to an AI provider and pick your model.
        </p>
      </div>
      <AppShellContent className="px-8 pt-6 pb-12">
        <div className="grid gap-4 lg:grid-cols-2">
          {cloudProviders.length > 0 && (
            <ProviderKeysCard providers={cloudProviders} />
          )}

          <ModelPickerCard
            models={models}
            selected={selectedModel}
            onSelect={setSelectedModel}
            title="Pick the model that powers Counsel"
            hint="Changes apply on the next message. Once you add a provider key above, the matching models become available here."
            onConfigure={(model) => setConfiguringModel(model)}
          />

          <OllamaModelSelect active={selectedModel === OLLAMA_MODEL_ID} />
        </div>
      </AppShellContent>

      {configuringModel && (
        <LocalModelConfigDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfiguringModel(null);
          }}
          modelName={configuringModel.name}
          initialBaseUrl={configuringSetting?.baseUrl ?? ''}
          initialApiKey={configuringSetting?.hasApiKey ? '' /* never round-trip */ : ''}
          onSave={async ({ baseUrl, apiKey }) => {
            await modelSettings.update(configuringModel.id, baseUrl, apiKey);
            setConfiguringModel(null);
          }}
          onReset={
            configuringSetting?.isUserOverride
              ? async () => {
                  await modelSettings.reset(configuringModel.id);
                  setConfiguringModel(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
