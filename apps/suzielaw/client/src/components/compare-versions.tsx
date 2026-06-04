import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  GitCompareArrows,
  PendingButton,
  cn,
} from '@teamsuzie/ui';
import type { MatterDocument } from '../hooks/use-matter.js';

export interface DocumentDiffResult {
  left: { name: string; paragraphs: number };
  right: { name: string; paragraphs: number };
  stats: {
    unchanged: number;
    modified: number;
    deleted: number;
    inserted: number;
    moved: number;
  };
  events: Array<{
    kind: 'unchanged' | 'deleted' | 'inserted' | 'modified';
    text?: string;
    leftText?: string;
    rightText?: string;
  }>;
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: MatterDocument[];
  onSubmit: (input: { leftFileId: string; rightFileId: string }) => Promise<void>;
}

/**
 * Two-doc picker for the matter-detail "Compare versions" surface.
 * The matter's own documents are the only eligible candidates; the user
 * picks one for the left (before) side and a different one for the right
 * (after) side. Submit hits POST /api/matters/:matterId/diff and the host
 * opens the result in a side-panel tab.
 */
export function CompareVersionsDialog({
  open,
  onOpenChange,
  documents,
  onSubmit,
}: DialogProps) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeftId(null);
    setRightId(null);
    setError(null);
    setSubmitting(false);
  }, [open]);

  const ordered = useMemo(
    () =>
      [...documents].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
    [documents],
  );

  const canSubmit =
    !submitting && leftId !== null && rightId !== null && leftId !== rightId;

  async function handleSubmit() {
    if (!canSubmit || !leftId || !rightId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ leftFileId: leftId, rightFileId: rightId });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compare failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription>
            Pick two documents from this matter. The diff highlights
            inserted, deleted, and modified paragraphs side-by-side.
          </DialogDescription>
        </DialogHeader>
        {ordered.length < 2 ? (
          <EmptyState>
            <EmptyStateTitle>Not enough documents</EmptyStateTitle>
            <EmptyStateDescription>
              Upload at least two documents to this matter before comparing.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <DocColumn
              title="Left (before)"
              ordered={ordered}
              selectedId={leftId}
              onSelect={setLeftId}
              disabledId={rightId}
            />
            <DocColumn
              title="Right (after)"
              ordered={ordered}
              selectedId={rightId}
              onSelect={setRightId}
              disabledId={leftId}
            />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <PendingButton
            onClick={handleSubmit}
            disabled={!canSubmit}
            pending={submitting}
            pendingLabel="Comparing"
          >
            <GitCompareArrows className="size-4" aria-hidden />
            Compare
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocColumn({
  title,
  ordered,
  selectedId,
  onSelect,
  disabledId,
}: {
  title: string;
  ordered: MatterDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabledId: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
        {ordered.map((doc) => {
          const isSelected = doc.externalDocId === selectedId;
          const isDisabled = doc.externalDocId === disabledId;
          return (
            <li key={doc.externalDocId}>
              <button
                type="button"
                onClick={() => onSelect(doc.externalDocId)}
                disabled={isDisabled}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-accent/40',
                  isDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                )}
              >
                <span className="truncate">{doc.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Side-panel rendering of a finished diff. Builds the matter-scoped
 * `/api/matters/:id/diff/download` URL when matter + file ids are known.
 */
export function DiffPanel({
  result,
  matterId,
  leftFileId,
  rightFileId,
}: {
  result: DocumentDiffResult;
  matterId?: string;
  leftFileId?: string;
  rightFileId?: string;
}) {
  const downloadHref =
    matterId && leftFileId && rightFileId
      ? `/api/matters/${encodeURIComponent(matterId)}/diff/download?leftFileId=${encodeURIComponent(leftFileId)}&rightFileId=${encodeURIComponent(rightFileId)}`
      : undefined;
  const changeEvents = result.events.filter((event) => event.kind !== 'unchanged');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            {result.left.name} → {result.right.name}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {result.stats.modified} modified · {result.stats.inserted} inserted ·{' '}
            {result.stats.deleted} deleted
          </div>
        </div>
        {downloadHref && (
          <a
            href={downloadHref}
            className="border border-foreground/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.10em] hover:border-foreground"
          >
            Download DOCX
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          {changeEvents.map((event, index) => (
            <div key={index} className="border border-border bg-card p-3 text-sm">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {event.kind}
              </div>
              {event.kind === 'modified' ? (
                <div className="space-y-2">
                  <p className="text-destructive line-through">{event.leftText}</p>
                  <p className="text-foreground">{event.rightText}</p>
                </div>
              ) : (
                <p className={event.kind === 'deleted' ? 'text-destructive line-through' : 'text-foreground'}>
                  {event.text}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
