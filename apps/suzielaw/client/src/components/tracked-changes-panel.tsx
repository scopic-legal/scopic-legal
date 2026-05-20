import { useEffect, useMemo, useState } from 'react';

export interface RedlineRevision {
  id: number;
  type?: string;
  author?: string;
  date?: string;
}

export interface RedlineParagraph {
  id: string;
  text: string;
  revisions?: RedlineRevision[];
}

export interface ProposeEditsResult {
  applied_count?: number;
  total_count?: number;
  errors?: Array<{ index?: number; status?: string; reason?: string }>;
  revisions?: RedlineRevision[];
  download_file_id: string;
  download_session_id: string;
  download_filename?: string;
  download_url?: string;
}

interface Props {
  result: ProposeEditsResult;
  chatId: string;
  downloadHref: string;
  onLoadRedline: (
    sessionId: string,
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<{ paragraphs: RedlineParagraph[] }>;
  onResolve: (
    sessionId: string,
    fileId: string,
    body: { accept?: number[]; reject?: number[] },
  ) => Promise<{ paragraphs?: RedlineParagraph[] }>;
}

export function TrackedChangesPanel({
  result,
  downloadHref,
  onLoadRedline,
  onResolve,
}: Props) {
  const [paragraphs, setParagraphs] = useState<RedlineParagraph[]>([]);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void onLoadRedline(
      result.download_session_id,
      result.download_file_id,
      controller.signal,
    )
      .then((data) => setParagraphs(data.paragraphs))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load redline');
        }
      });
    return () => controller.abort();
  }, [onLoadRedline, result.download_file_id, result.download_session_id]);

  const revisionIds = useMemo(() => {
    const ids = new Set<number>();
    for (const revision of result.revisions ?? []) ids.add(revision.id);
    for (const paragraph of paragraphs) {
      for (const revision of paragraph.revisions ?? []) ids.add(revision.id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [paragraphs, result.revisions]);

  async function resolve(kind: 'accept' | 'reject') {
    if (revisionIds.length === 0) return;
    setBusy(kind);
    setError(null);
    try {
      const response = await onResolve(result.download_session_id, result.download_file_id, {
        [kind]: revisionIds,
      });
      if (response.paragraphs) setParagraphs(response.paragraphs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve revisions');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border border-foreground/15 bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/50">
            Tracked changes
          </div>
          <div className="mt-1 text-foreground">
            {result.applied_count ?? revisionIds.length} proposed edit
            {(result.applied_count ?? revisionIds.length) === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={downloadHref}
            className="border border-foreground/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.10em] hover:border-foreground"
          >
            Download DOCX
          </a>
          <button
            type="button"
            disabled={revisionIds.length === 0 || busy !== null}
            onClick={() => void resolve('accept')}
            className="border border-foreground/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.10em] hover:border-foreground disabled:opacity-50"
          >
            {busy === 'accept' ? 'Accepting...' : 'Accept all'}
          </button>
          <button
            type="button"
            disabled={revisionIds.length === 0 || busy !== null}
            onClick={() => void resolve('reject')}
            className="border border-foreground/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.10em] hover:border-foreground disabled:opacity-50"
          >
            {busy === 'reject' ? 'Rejecting...' : 'Reject all'}
          </button>
        </div>
      </div>
      {result.errors && result.errors.length > 0 && (
        <div className="mt-2 text-destructive">
          {result.errors.length} edit{result.errors.length === 1 ? '' : 's'} could not be applied.
        </div>
      )}
      {error && <div className="mt-2 text-destructive">{error}</div>}
      {paragraphs.length > 0 && (
        <div className="mt-3 max-h-48 overflow-auto border-t border-foreground/10 pt-2">
          {paragraphs.slice(0, 8).map((paragraph) => (
            <p key={paragraph.id} className="mb-2 text-foreground/75">
              {paragraph.text || ' '}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
