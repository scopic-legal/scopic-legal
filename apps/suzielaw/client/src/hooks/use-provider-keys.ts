import { useCallback, useEffect, useState } from 'react';

export interface ProviderKeyPublic {
  providerId: string;
  hasKey: boolean;
  updatedAt: number;
}

interface UseProviderKeys {
  providers: ProviderKeyPublic[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setKey: (providerId: string, apiKey: string) => Promise<void>;
  clearKey: (providerId: string) => Promise<void>;
}

interface UseProviderKeysOptions {
  enabled?: boolean;
}

/**
 * Drives the per-(user, provider) BYOK key UI. Talks to
 * `/api/model-settings/providers`. Keys are write-only — the server
 * never echoes them back, the hook only knows whether one is set.
 */
export function useProviderKeys(options: UseProviderKeysOptions = {}): UseProviderKeys {
  const enabled = options.enabled ?? true;
  const [providers, setProviders] = useState<ProviderKeyPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setProviders([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/model-settings/providers', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = (await res.json()) as { providers: ProviderKeyPublic[] };
      setProviders(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load provider keys');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setKey = useCallback(async (providerId: string, apiKey: string) => {
    const res = await fetch(
      `/api/model-settings/providers/${encodeURIComponent(providerId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Save failed (${res.status})`);
    }
    const data = (await res.json()) as { providers: ProviderKeyPublic[] };
    setProviders(data.providers);
  }, []);

  const clearKey = useCallback(async (providerId: string) => {
    const res = await fetch(
      `/api/model-settings/providers/${encodeURIComponent(providerId)}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Remove failed (${res.status})`);
    }
    const data = (await res.json()) as { providers: ProviderKeyPublic[] };
    setProviders(data.providers);
  }, []);

  return { providers, loading, error, refresh, setKey, clearKey };
}
