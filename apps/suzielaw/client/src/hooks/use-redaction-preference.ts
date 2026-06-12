import { useEffect, useState } from 'react';

const REDACTION_ENABLED_KEY = 'scopic:redaction-enabled';

export function useRedactionPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(REDACTION_ENABLED_KEY) !== 'false';
  });

  useEffect(() => {
    window.localStorage.setItem(REDACTION_ENABLED_KEY, enabled ? 'true' : 'false');
  }, [enabled]);

  return [enabled, setEnabledState];
}

export function redactionModePayload(enabled: boolean): { redactionMode: 'auto' | 'off' } {
  return { redactionMode: enabled ? 'auto' : 'off' };
}
