import { useEffect, useState } from 'react';
import { PersonaEditor, useSelectedPersona } from '@teamsuzie/ui';

// Avatars are served from `client/public/avatars/{female,male}/<n>.webp` —
// matching the upstream admin layout. The numeric ranges below are the
// counts present in the public folder; if you add or remove files, update
// these.
const FEMALE_AVATAR_COUNT = 215;
const MALE_AVATAR_COUNT = 214;

const AVAILABLE_AVATARS: string[] = [
  ...Array.from({ length: FEMALE_AVATAR_COUNT }, (_, i) => `/avatars/female/${i + 1}.webp`),
  ...Array.from({ length: MALE_AVATAR_COUNT }, (_, i) => `/avatars/male/${i + 1}.webp`),
];

interface ToolEntry {
  name: string;
  description?: string;
}

interface HealthResponse {
  tools?: ToolEntry[];
}

export function PersonasPage() {
  // Same key as App.tsx so the sidebar's "Default Counsel" / picker selection
  // stays in sync with whatever the user activates from this page.
  const [selectedPersonaId, setSelectedPersonaId] = useSelectedPersona(
    'scopic:selected-persona',
  );
  const [tools, setTools] = useState<ToolEntry[]>([]);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then((d) => setTools(d.tools ?? []))
      .catch(() => undefined);
  }, []);

  return (
    <PersonaEditor
      availableAvatars={AVAILABLE_AVATARS}
      availableTools={tools}
      selectedPersonaId={selectedPersonaId}
      onSelect={setSelectedPersonaId}
    />
  );
}
