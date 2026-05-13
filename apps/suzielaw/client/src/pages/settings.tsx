import { useMemo, useState } from 'react';
import {
  AppShellContent,
  LocalModelConfigDialog,
  ModelPickerCard,
  useSelectedModel,
  type ModelOption,
} from '@teamsuzie/ui';
import { MODELS, MODEL_PROVIDER_ID } from '../data/models.js';
import { useModelSettings } from '../hooks/use-model-settings.js';
import { useProviderKeys } from '../hooks/use-provider-keys.js';
import {
  ProviderKeysCard,
  type ProviderDisplay,
} from '../components/provider-keys-card.js';

const SELECTED_MODEL_KEY = 'suzielaw:selected-model';

interface Props {
  /** Server's configured default model — used as fallback when nothing is in localStorage. */
  defaultModel?: string;
  /** Cloud BYOK providers from `/api/health.cloudProviders`. */
  cloudProviders?: ProviderDisplay[];
}

export function SettingsPage({ defaultModel, cloudProviders = [] }: Props) {
  const [selectedModel, setSelectedModel] = useSelectedModel(SELECTED_MODEL_KEY, defaultModel);
  const modelSettings = useModelSettings();
  const providerKeys = useProviderKeys();
  const [configuringModel, setConfiguringModel] = useState<ModelOption | null>(null);

  // Decorate the static MODELS list with each Local model's effective base
  // URL (env default OR user override). Pulled from /api/model-settings.
  // BYOK gate: a cloud model is visible iff (a) it's the configured
  // default — the demo-budget always covers it — or (b) the user has set
  // a provider key for its provider. Local models are always visible.
  const models: ModelOption[] = useMemo(() => {
    const byId = new Map(modelSettings.settings.map((s) => [s.modelId, s]));
    const keysByProvider = new Map(
      providerKeys.providers.map((p) => [p.providerId, p]),
    );
    return MODELS.filter((m) => {
      if (m.local) return true;
      if (m.id === defaultModel) return true;
      const providerId = MODEL_PROVIDER_ID[m.id];
      if (!providerId) return false;
      return keysByProvider.get(providerId)?.hasKey ?? false;
    }).map((m) => {
      const setting = byId.get(m.id);
      return setting ? { ...m, resolvedBaseUrl: setting.baseUrl } : m;
    });
  }, [modelSettings.settings, providerKeys.providers, defaultModel]);

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
          Model picker and provider keys.
        </p>
      </div>
      <AppShellContent className="px-8 pt-6 pb-12">
        <div className="grid gap-4 lg:grid-cols-2">
          <ModelPickerCard
            models={models}
            selected={selectedModel}
            onSelect={setSelectedModel}
            title="Pick the model that powers Counsel"
            hint="Changes apply on the next message. The demo-budget default is always available; other cloud models appear once you set a provider key below."
            onConfigure={(model) => setConfiguringModel(model)}
          />

          {cloudProviders.length > 0 && (
            <ProviderKeysCard providers={cloudProviders} />
          )}
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
