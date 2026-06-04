import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AppShellContent,
  Button,
  ColumnHeaderEditor,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Download,
  LoadingState,
  MessageSquare,
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  PendingButton,
  Plus,
  ReviewGrid,
  useConfirm,
} from '@teamsuzie/ui';
// Import from the /browser entry — the package's main entry pulls in
// ReviewsStore + createReviewsRouter, which transitively need node:fs and
// express. The browser entry exposes only the bundle-safe pieces.
import {
  ColumnPresetRegistry,
  type ColumnPreset,
  type ReviewColumn,
} from '@teamsuzie/grid-review/browser';
import { useDocSidePanel } from '../components/document-side-panel.js';
import { useMatter, type MatterDocument } from '../hooks/use-matter.js';
import { useReview, type CellFormat } from '../hooks/use-review.js';
import { useReviewChats } from '../hooks/use-review-chats.js';
import { selectedModelPayload } from '../data/ollama.js';

/**
 * Column preset registry — kept (empty) so a future host can plug
 * synchronous fast-path presets in without re-threading props. The
 * primary autofill mechanism is now the async `draftFromTitle` callback,
 * which asks the simple model for a starter prompt + format whenever
 * the user blurs the title input. The hand-written legal preset pack
 * from `data/legal-presets.ts` is no longer registered.
 */
const columnPresets = new ColumnPresetRegistry();
const SELECTED_MODEL_KEY = 'scopic:selected-model';

function selectedReviewModelPayload(): {
  model?: string;
  modelProvider?: string;
} {
  if (typeof window === 'undefined') return {};
  return selectedModelPayload(window.localStorage.getItem(SELECTED_MODEL_KEY) || undefined);
}

function pageHintFromLocator(locator: string | undefined): number | undefined {
  if (!locator) return undefined;
  const m = locator.match(/\bp\.?\s*(\d+)\b/i) ?? locator.match(/\bpage\s+(\d+)\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function draftColumnPromptFromServer({
  title,
  formatHint,
  formatDirty,
  signal,
}: {
  title: string;
  formatHint: CellFormat;
  formatDirty: boolean;
  signal: AbortSignal;
}): Promise<{ prompt: string; format: CellFormat } | null> {
  const response = await fetch('/api/reviews/column/draft-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      title,
      formatHint,
      // The server uses this to decide whether the hint is binding (the
      // user explicitly picked the format) or just a soft suggestion
      // (the form default). The editor independently enforces this on
      // the response side too.
      formatLocked: formatDirty,
      ...selectedReviewModelPayload(),
    }),
    signal,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Draft failed (${response.status})`);
  }
  const data = (await response.json()) as {
    ok?: boolean;
    prompt?: string;
    format?: CellFormat;
    error?: string;
  };
  if (!data.ok || !data.prompt || !data.format) {
    throw new Error(data.error || 'Draft response missing fields');
  }
  return { prompt: data.prompt, format: data.format };
}

interface ColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial: { title: string; prompt: string; format: CellFormat };
  onSubmit: (input: {
    title: string;
    prompt: string;
    format: CellFormat;
  }) => Promise<void>;
}

function ColumnDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
}: ColumnDialogProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset error every time the dialog opens.
  useMemo(() => {
    if (open) setErr(null);
  }, [open]);

  const findPreset = (title: string): ColumnPreset | null =>
    columnPresets.match(title);

  async function handleSubmit(value: {
    title: string;
    prompt: string;
    format: CellFormat;
  }) {
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(value);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Add column' : 'Edit column'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'One question to ask of every document in this review.'
              : 'Adjust the title, prompt, or format for this column.'}
          </DialogDescription>
        </DialogHeader>
        {/*
          Re-mount the editor whenever `initial` changes so it re-seeds
          its internal state. (Editor only reads `initial` once on mount.)
        */}
        <ColumnHeaderEditor
          key={`${mode}-${initial.title}-${initial.prompt}`}
          mode={mode}
          initial={initial}
          findPreset={findPreset}
          draftFromTitle={draftColumnPromptFromServer}
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          busy={busy}
          error={err}
          submitLabel={mode === 'create' ? 'Add column' : 'Save changes'}
        />
      </DialogContent>
    </Dialog>
  );
}

interface AddDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: MatterDocument[];
  alreadyInReview: Set<string>;
  onAdd: (docs: MatterDocument[]) => Promise<void>;
}

function AddDocumentsDialog({
  open,
  onOpenChange,
  candidates,
  alreadyInReview,
  onAdd,
}: AddDocumentsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset on open.
  useMemo(() => {
    if (open) {
      setSelected(new Set());
      setErr(null);
    }
  }, [open]);

  const eligible = candidates.filter((d) => !alreadyInReview.has(d.externalDocId));

  async function submit() {
    if (selected.size === 0) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const picked = candidates.filter((d) => selected.has(d.id));
      await onAdd(picked);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add documents</DialogTitle>
          <DialogDescription>
            Pick from this matter's documents. Each becomes a row in the review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 max-h-[40vh] overflow-y-auto">
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No more documents to add.
            </p>
          ) : (
            eligible.map((doc) => (
              <label
                key={doc.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(doc.id)}
                  onChange={(e) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(doc.id);
                      else next.delete(doc.id);
                      return next;
                    });
                  }}
                />
                <span className="flex-1 truncate text-sm">
                  {doc.name || 'Untitled'}
                </span>
              </label>
            ))
          )}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => void submit()}
            disabled={busy || selected.size === 0}
          >
            {busy ? 'Adding…' : `Add ${selected.size || ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunStatusLine({
  progress,
  runningCellId,
  snapshot,
}: {
  progress: { current: number; total: number };
  runningCellId: { columnId: string; rowId: string; retrievedSummary?: string } | null;
  snapshot: {
    columns: Array<{ id: string; title: string }>;
    documents: Array<{ id: string; name: string }>;
  } | null;
}) {
  const col = runningCellId
    ? snapshot?.columns.find((c) => c.id === runningCellId.columnId)
    : null;
  const doc = runningCellId
    ? snapshot?.documents.find((d) => d.id === runningCellId.rowId)
    : null;
  const summary = runningCellId?.retrievedSummary;
  return (
    <span>
      Running {Math.min(progress.current + 1, progress.total)}/{progress.total}
      {col && doc ? (
        <>
          {' — '}
          <span className="font-medium text-foreground">{col.title}</span>
          {' on '}
          <span className="font-medium text-foreground">{doc.name}</span>
        </>
      ) : null}
      {summary ? <span className="ml-2 text-xs">· {summary}</span> : null}
    </span>
  );
}

export function ReviewDetailPage() {
  const params = useParams<{ matterId: string; reviewId: string }>();
  const matterId = params.matterId;
  const reviewId = params.reviewId;

  const navigate = useNavigate();
  const matter = useMatter(matterId);
  const review = useReview(matterId, reviewId);
  const reviewChats = useReviewChats(matterId, reviewId);
  const [colDialogMode, setColDialogMode] = useState<
    | { kind: 'closed' }
    | { kind: 'create' }
    | { kind: 'edit'; column: ReviewColumn }
  >({ kind: 'closed' });
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const { openDoc } = useDocSidePanel();
  const [openingChat, setOpeningChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const confirm = useConfirm();

  /**
   * Open the latest review-scoped chat, or create a new one if none
   * exist. We don't ship a chat list on this page yet — the action is
   * "ask follow-ups about this review", and a single landing chat
   * handles that. Multiple chats are created via the "New chat"
   * button on the review-chat page.
   */
  async function openOrCreateReviewChat() {
    if (!matterId || !reviewId || openingChat) return;
    setOpeningChat(true);
    setChatError(null);
    try {
      const existing = reviewChats.chats[0];
      const chat = existing ?? (await reviewChats.create());
      navigate(
        `/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}/chats/${encodeURIComponent(chat.id)}`,
      );
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to open chat');
    } finally {
      setOpeningChat(false);
    }
  }

  const docLabels = useMemo(() => {
    const out: Record<string, string> = {};
    // Citations key on the file_id (the doc handle in the citation
    // protocol), not on the workspace_documents row uuid.
    for (const d of matter.documents) out[d.externalDocId] = d.name;
    return out;
  }, [matter.documents]);

  // Review rows store file_ids (matter_doc.externalDocId), so dedupe the
  // matter-doc picker against the same key.
  const alreadyInReview = useMemo(
    () => new Set((review.snapshot?.documents ?? []).map((d) => d.externalDocId)),
    [review.snapshot],
  );

  const pendingCount = useMemo(() => {
    if (!review.snapshot) return 0;
    const cellByKey = new Map(
      review.snapshot.cells.map((c) => [
        `${c.columnId}::${c.reviewDocumentId}`,
        c,
      ]),
    );
    let n = 0;
    for (const doc of review.snapshot.documents) {
      for (const col of review.snapshot.columns) {
        const cell = cellByKey.get(`${col.id}::${doc.id}`);
        if (!cell || cell.status === 'pending' || cell.status === 'error') n++;
      }
    }
    return n;
  }, [review.snapshot]);

  function handleCitationJump(citation: { doc: string; quote: string; locator?: string }) {
    if (!matterId) return;
    // Citation handles are file_ids — match against externalDocId, not
    // the workspace_documents row uuid.
    const att = matter.documents.find((d) => d.externalDocId === citation.doc);
    if (!att) {
      console.warn(
        `[review-detail] no matter document found for citation handle "${citation.doc}"`,
      );
      return;
    }
    openDoc({
      matterId,
      fileId: att.externalDocId,
      fileName: att.name,
      mimeType: att.mimeType ?? 'application/octet-stream',
      url: `/api/files/${encodeURIComponent(matterId)}/${encodeURIComponent(att.externalDocId)}/content`,
      quote: citation.quote,
      page: pageHintFromLocator(citation.locator),
    });
  }

  if (!matterId || !reviewId) {
    return (
      <AppShellContent>
        <p className="p-6 text-sm text-destructive">Missing matter or review id.</p>
      </AppShellContent>
    );
  }

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <Link
            to={`/matters/${encodeURIComponent(matterId)}`}
            className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← {matter.matter?.name ?? 'Matter'}
          </Link>
          <PageHeaderTitle>
            {review.snapshot?.review.name ?? 'Review'}
          </PageHeaderTitle>
          {review.running && review.runProgress ? (
            <PageHeaderDescription>
              <RunStatusLine
                progress={review.runProgress}
                runningCellId={review.runningCell}
                snapshot={review.snapshot}
              />
            </PageHeaderDescription>
          ) : (
            review.snapshot?.review.description && (
              <PageHeaderDescription>
                {review.snapshot.review.description}
              </PageHeaderDescription>
            )
          )}
        </PageHeaderContent>
        <PageHeaderActions>
          <PendingButton
            variant="outline"
            onClick={() => void openOrCreateReviewChat()}
            disabled={!review.snapshot}
            title="Ask follow-up questions about this review"
            pending={openingChat}
            pendingLabel="Opening"
          >
            <MessageSquare className="size-4" aria-hidden />
            {reviewChats.chats.length > 0 ? 'Open chat' : 'Chat'}
          </PendingButton>
          <Button
            variant="outline"
            disabled={!review.snapshot}
            asChild
            title="Download the review as Excel — citations attach as cell comments"
          >
            <a
              href={
                matterId && reviewId
                  ? `/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}/export.xlsx`
                  : '#'
              }
              // Force a download instead of opening the binary inline if
              // the browser tries to be clever about it.
              download
            >
              <Download className="size-4" aria-hidden />
              Export
            </a>
          </Button>
          <Button
            variant="outline"
            onClick={() => setDocDialogOpen(true)}
            disabled={!review.snapshot}
          >
            <Plus className="size-4" aria-hidden />
            Add documents
          </Button>
          <Button
            variant="outline"
            onClick={() => setColDialogMode({ kind: 'create' })}
            disabled={!review.snapshot}
          >
            <Plus className="size-4" aria-hidden />
            Add column
          </Button>
          <Button
            onClick={() => void review.runPending()}
            disabled={!review.snapshot || review.running || pendingCount === 0}
          >
            {review.running
              ? 'Running…'
              : pendingCount === 0
                ? 'All cells run'
                : `Run pending (${pendingCount})`}
          </Button>
        </PageHeaderActions>
      </PageHeader>
      <AppShellContent className="px-6 pt-6 pb-12">
        {chatError && <p className="mb-4 text-sm text-destructive">{chatError}</p>}
        {review.error && <p className="mb-4 text-sm text-destructive">{review.error}</p>}
        {review.loading ? (
          <LoadingState>Loading review…</LoadingState>
        ) : !review.snapshot ? (
          <p className="text-sm text-muted-foreground">Review not found.</p>
        ) : (
          <ReviewGrid
            snapshot={review.snapshot}
            docLabels={docLabels}
            busy={review.running}
            runningCell={review.runningCell}
            onCitationJump={handleCitationJump}
            onColumnClick={(col) => setColDialogMode({ kind: 'edit', column: col })}
            onColumnRemove={async (col) => {
              if (
                await confirm({
                  title: `Remove column "${col.title}"?`,
                  description: 'All cells in this column will be deleted across every row in the review.',
                  confirmLabel: 'Remove column',
                  variant: 'destructive',
                })
              ) {
                void review.removeColumn(col.id);
              }
            }}
            onRowRemove={async (doc) => {
              if (
                await confirm({
                  title: `Remove "${doc.name}" from this review?`,
                  description: 'All cells for this row will be deleted. The matter document itself is kept.',
                  confirmLabel: 'Remove row',
                  variant: 'destructive',
                })
              ) {
                void review.removeDocument(doc.id);
              }
            }}
            onCellRegenerate={(col, doc) => review.regenerateCell(col.id, doc.id)}
            onRowRun={(doc) => review.runRow(doc.id)}
            onRowRegenerate={(doc) => review.regenerateRow(doc.id)}
            onColumnRun={(col) => review.runColumn(col.id)}
            onColumnRegenerate={(col) => review.regenerateColumn(col.id)}
          />
        )}
      </AppShellContent>

      <ColumnDialog
        open={colDialogMode.kind !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setColDialogMode({ kind: 'closed' });
        }}
        mode={colDialogMode.kind === 'edit' ? 'edit' : 'create'}
        initial={
          colDialogMode.kind === 'edit'
            ? {
                title: colDialogMode.column.title,
                prompt: colDialogMode.column.prompt,
                format: colDialogMode.column.format,
              }
            : { title: '', prompt: '', format: 'short_text' }
        }
        onSubmit={async (value) => {
          if (colDialogMode.kind === 'edit') {
            await review.updateColumn(colDialogMode.column.id, value);
          } else {
            await review.addColumn(value);
          }
        }}
      />

      <AddDocumentsDialog
        open={docDialogOpen}
        onOpenChange={setDocDialogOpen}
        candidates={matter.documents}
        alreadyInReview={alreadyInReview}
        onAdd={async (docs) => {
          for (const d of docs) {
            // The adapter looks up bytes in InMemoryFileStore via the
            // file_id (workspace_documents.external_doc_id), not the
            // workspace_documents row id — pass the file_id directly.
            await review.addDocument({
              externalDocId: d.externalDocId,
              name: d.name,
              mimeType: d.mimeType,
            });
          }
        }}
      />
    </>
  );
}
