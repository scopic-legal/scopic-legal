import type { RedlineParagraph } from '@teamsuzie/ui';

/**
 * Shared redline endpoint adapters for the chat pages. Each one wraps
 * the suzielaw server route (`/api/files/:session/:file/...`) and
 * normalizes the response into the upstream `@teamsuzie/ui`
 * `RedlinePanelContent` / `TrackedChangesPanel` contracts (kinds in
 * `'equal' | 'insert' | 'delete'` naming).
 *
 * Wire compatibility: the server emits the upstream kinds directly
 * (the extraction lives in `@teamsuzie/docx`), so no kind translation
 * is required here.
 */

export interface ResolveBody {
  accept?: number[];
  reject?: number[];
}

export interface ResolveResponse {
  ok: boolean;
  accepted: number[];
  rejected: number[];
  changed: number;
  version_id?: string;
  paragraphs?: RedlineParagraph[];
}

export async function resolveRevisions(
  sessionId: string,
  fileId: string,
  body: ResolveBody,
): Promise<ResolveResponse> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/revisions/resolve`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ResolveResponse;
}

export async function loadRedline(
  sessionId: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<{ paragraphs: RedlineParagraph[] }> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/redline-view`,
    { credentials: 'include', signal, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { paragraphs: RedlineParagraph[] };
}

export function redlineDownloadHref(
  sessionId: string,
  fileId: string,
): string {
  return `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/content`;
}
