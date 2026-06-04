import { useCallback, useEffect, useState } from 'react';
import type {
  CellFormat,
  ReviewColumn,
  ReviewDocument,
  ReviewSnapshot,
} from '@teamsuzie/grid-review/browser';
import { selectedModelPayload } from '../data/ollama.js';

export type { CellFormat, ReviewColumn, ReviewDocument, ReviewSnapshot };

const SELECTED_MODEL_KEY = 'scopic:selected-model';

function selectedReviewModelPayload(): {
  model?: string;
  modelProvider?: string;
} {
  if (typeof window === 'undefined') return {};
  return selectedModelPayload(window.localStorage.getItem(SELECTED_MODEL_KEY) || undefined);
}

export interface AddColumnInput {
  title: string;
  prompt: string;
  format: CellFormat;
}

export interface AddDocumentInput {
  externalDocId: string;
  name: string;
  mimeType?: string | null;
}

export interface RunningCell {
  columnId: string;
  rowId: string;
  /** Live token stream — server's persisted cell catches up via cell_done's refresh. */
  partialText: string;
  /** Brief description from the most recent retrieved event for this cell. */
  retrievedSummary?: string;
  /** Verbatim retrieved chunks fed to the model, in relevance order. */
  retrievedChunks?: Array<{ content: string; distance?: number }>;
  /**
   * The actual query embedded for retrieval. May differ from the column
   * prompt when query rewriting (e.g. HyDE) is used; surfaced for debugging.
   */
  retrievalQuery?: string;
}

export interface RunProgress {
  current: number;
  total: number;
}

interface UseReviewResult {
  snapshot: ReviewSnapshot | null;
  loading: boolean;
  running: boolean;
  error: string | null;
  /** Active cell during a run, plus its in-flight content. Null when idle. */
  runningCell: RunningCell | null;
  /** {current, total} during a run. Null when idle. */
  runProgress: RunProgress | null;
  refresh: () => Promise<void>;
  addColumn: (input: AddColumnInput) => Promise<void>;
  updateColumn: (columnId: string, patch: Partial<AddColumnInput>) => Promise<void>;
  removeColumn: (columnId: string) => Promise<void>;
  addDocument: (input: AddDocumentInput) => Promise<void>;
  removeDocument: (rowId: string) => Promise<void>;
  runPending: () => Promise<void>;
  regenerateCell: (columnId: string, reviewDocumentId: string) => Promise<void>;
  /** Run pending/error cells in a row (one HTTP request per cell, sequential). */
  runRow: (reviewDocumentId: string) => Promise<void>;
  /** Run pending/error cells in a column. */
  runColumn: (columnId: string) => Promise<void>;
  /** Re-run every cell in a row regardless of current status. */
  regenerateRow: (reviewDocumentId: string) => Promise<void>;
  /** Re-run every cell in a column regardless of current status. */
  regenerateColumn: (columnId: string) => Promise<void>;
}

type SseEvent =
  | { type: 'start'; total?: number; columnId?: string; rowId?: string }
  | {
      type: 'cell_start';
      columnId: string;
      rowId: string;
    }
  | {
      type: 'cell_token';
      columnId: string;
      rowId: string;
      text: string;
    }
  | {
      type: 'cell_retrieved';
      columnId: string;
      rowId: string;
      summary: string;
      chunkCount?: number;
      chunks?: Array<{ content: string; distance?: number }>;
      retrievalQuery?: string;
    }
  | {
      type: 'cell_done';
      columnId: string;
      rowId: string;
      cellId: string | null;
      status: string;
    }
  | { type: 'done'; columnId?: string; rowId?: string; cellId?: string | null; status?: string };

/**
 * Loads a review snapshot and exposes mutations + run-pending /
 * regenerate-cell flows that drive UI directly from the server's SSE
 * stream — token-by-token, with retrieval summaries surfaced inline.
 *
 * No polling: snapshot refreshes on `cell_done` (canonical citations land
 * then) and once on stream close. Tokens flow into `runningCell.partialText`.
 */
export function useReview(
  matterId: string | undefined,
  reviewId: string | undefined,
): UseReviewResult {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningCell, setRunningCell] = useState<RunningCell | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);

  const baseUrl = matterId && reviewId
    ? `/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}`
    : null;

  const refresh = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const response = await fetch(baseUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to load review (${response.status})`);
      const data = (await response.json()) as { snapshot: ReviewSnapshot };
      setSnapshot(data.snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const addColumn = useCallback(
    async (input: AddColumnInput) => {
      if (!baseUrl) return;
      const response = await fetch(`${baseUrl}/columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed (${response.status})`);
      }
      await refresh();
    },
    [baseUrl, refresh],
  );

  const updateColumn = useCallback(
    async (columnId: string, patch: Partial<AddColumnInput>) => {
      if (!baseUrl) return;
      const response = await fetch(
        `${baseUrl}/columns/${encodeURIComponent(columnId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(patch),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed (${response.status})`);
      }
      await refresh();
    },
    [baseUrl, refresh],
  );

  const removeColumn = useCallback(
    async (columnId: string) => {
      if (!baseUrl) return;
      const response = await fetch(
        `${baseUrl}/columns/${encodeURIComponent(columnId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed (${response.status})`);
      }
      await refresh();
    },
    [baseUrl, refresh],
  );

  const addDocument = useCallback(
    async (input: AddDocumentInput) => {
      if (!baseUrl) return;
      const response = await fetch(`${baseUrl}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed (${response.status})`);
      }
      await refresh();
    },
    [baseUrl, refresh],
  );

  const removeDocument = useCallback(
    async (rowId: string) => {
      if (!baseUrl) return;
      const response = await fetch(
        `${baseUrl}/documents/${encodeURIComponent(rowId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed (${response.status})`);
      }
      await refresh();
    },
    [baseUrl, refresh],
  );

  /** Drain an SSE response, updating runningCell / runProgress / snapshot in real time. */
  const drainSse = useCallback(
    async (response: Response, kind: 'pending' | 'single') => {
      if (!response.body) throw new Error('No response body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = 0;
      let total: number | null = kind === 'single' ? 1 : null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const block of events) {
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let payload: SseEvent;
          try {
            payload = JSON.parse(line.slice(6)) as SseEvent;
          } catch {
            continue;
          }
          if (payload.type === 'start') {
            if (typeof payload.total === 'number') {
              total = payload.total;
              setRunProgress({ current: 0, total });
            } else if (kind === 'single') {
              setRunProgress({ current: 0, total: 1 });
              setRunningCell({
                columnId: payload.columnId ?? '',
                rowId: payload.rowId ?? '',
                partialText: '',
              });
            }
          } else if (payload.type === 'cell_start') {
            setRunningCell({
              columnId: payload.columnId,
              rowId: payload.rowId,
              partialText: '',
            });
            setRunProgress((p) =>
              p ? { ...p, current: completed } : p,
            );
          } else if (payload.type === 'cell_token') {
            setRunningCell((c) =>
              c &&
              c.columnId === payload.columnId &&
              c.rowId === payload.rowId
                ? { ...c, partialText: c.partialText + payload.text }
                : c,
            );
          } else if (payload.type === 'cell_retrieved') {
            setRunningCell((c) =>
              c &&
              c.columnId === payload.columnId &&
              c.rowId === payload.rowId
                ? {
                    ...c,
                    retrievedSummary: payload.summary,
                    retrievedChunks: payload.chunks,
                    retrievalQuery: payload.retrievalQuery,
                  }
                : {
                    columnId: payload.columnId,
                    rowId: payload.rowId,
                    partialText: '',
                    retrievedSummary: payload.summary,
                    retrievedChunks: payload.chunks,
                    retrievalQuery: payload.retrievalQuery,
                  },
            );
          } else if (payload.type === 'cell_done') {
            completed += 1;
            setRunProgress((p) =>
              p ? { ...p, current: completed } : p,
            );
            // Refresh the snapshot so the canonical cell value + parsed
            // citations land. We do this without awaiting so the next
            // cell can start streaming immediately.
            void refresh();
          } else if (payload.type === 'done') {
            // Final event from the run endpoint.
          }
        }
      }
    },
    [refresh],
  );

  const runPending = useCallback(async () => {
    if (!baseUrl || running) return;
    setRunning(true);
    setError(null);
    setRunningCell(null);
    setRunProgress(null);
    try {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(selectedReviewModelPayload()),
      });
      await drainSse(response, 'pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      await refresh();
      setRunning(false);
      setRunningCell(null);
      setRunProgress(null);
    }
  }, [baseUrl, drainSse, refresh, running]);

  /** Run a single cell via the SSE endpoint. Caller manages running state. */
  const runOneCell = useCallback(
    async (columnId: string, reviewDocumentId: string) => {
      if (!baseUrl) return;
      setRunningCell({ columnId, rowId: reviewDocumentId, partialText: '' });
      const response = await fetch(`${baseUrl}/cells/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          columnId,
          reviewDocumentId,
          ...selectedReviewModelPayload(),
        }),
      });
      await drainSse(response, 'single');
    },
    [baseUrl, drainSse],
  );

  const regenerateCell = useCallback(
    async (columnId: string, reviewDocumentId: string) => {
      if (!baseUrl || running) return;
      setRunning(true);
      setError(null);
      setRunProgress({ current: 0, total: 1 });
      try {
        await runOneCell(columnId, reviewDocumentId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Regenerate failed');
      } finally {
        await refresh();
        setRunning(false);
        setRunningCell(null);
        setRunProgress(null);
      }
    },
    [baseUrl, runOneCell, refresh, running],
  );

  /**
   * Sequential fan-out over a list of (columnId, reviewDocumentId) pairs.
   * Mirrors the server `/run` endpoint's progress + running-cell semantics
   * so the UI lights up the same way regardless of which path is in flight.
   */
  const runMany = useCallback(
    async (
      pairs: Array<{ columnId: string; reviewDocumentId: string }>,
      label: string,
    ) => {
      if (!baseUrl || running || pairs.length === 0) return;
      setRunning(true);
      setError(null);
      setRunProgress({ current: 0, total: pairs.length });
      try {
        for (let i = 0; i < pairs.length; i++) {
          const { columnId, reviewDocumentId } = pairs[i]!;
          setRunProgress({ current: i, total: pairs.length });
          try {
            await runOneCell(columnId, reviewDocumentId);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : `${label} failed`,
            );
            // Continue with the rest — partial progress beats aborting on
            // one bad cell. The error flag surfaces in the host UI.
          }
        }
      } finally {
        await refresh();
        setRunning(false);
        setRunningCell(null);
        setRunProgress(null);
      }
    },
    [baseUrl, runOneCell, refresh, running],
  );

  const cellsForDoc = useCallback(
    (reviewDocumentId: string, mode: 'pending' | 'all') => {
      if (!snapshot) return [];
      const cellByKey = new Map(
        snapshot.cells.map((c) => [`${c.columnId}::${c.reviewDocumentId}`, c]),
      );
      const pairs: Array<{ columnId: string; reviewDocumentId: string }> = [];
      for (const col of snapshot.columns) {
        const existing = cellByKey.get(`${col.id}::${reviewDocumentId}`);
        if (
          mode === 'all' ||
          !existing ||
          existing.status === 'pending' ||
          existing.status === 'error'
        ) {
          pairs.push({ columnId: col.id, reviewDocumentId });
        }
      }
      return pairs;
    },
    [snapshot],
  );

  const cellsForColumn = useCallback(
    (columnId: string, mode: 'pending' | 'all') => {
      if (!snapshot) return [];
      const cellByKey = new Map(
        snapshot.cells.map((c) => [`${c.columnId}::${c.reviewDocumentId}`, c]),
      );
      const pairs: Array<{ columnId: string; reviewDocumentId: string }> = [];
      for (const doc of snapshot.documents) {
        const existing = cellByKey.get(`${columnId}::${doc.id}`);
        if (
          mode === 'all' ||
          !existing ||
          existing.status === 'pending' ||
          existing.status === 'error'
        ) {
          pairs.push({ columnId, reviewDocumentId: doc.id });
        }
      }
      return pairs;
    },
    [snapshot],
  );

  const runRow = useCallback(
    async (reviewDocumentId: string) =>
      runMany(cellsForDoc(reviewDocumentId, 'pending'), 'Run row'),
    [runMany, cellsForDoc],
  );
  const regenerateRow = useCallback(
    async (reviewDocumentId: string) =>
      runMany(cellsForDoc(reviewDocumentId, 'all'), 'Regenerate row'),
    [runMany, cellsForDoc],
  );
  const runColumn = useCallback(
    async (columnId: string) =>
      runMany(cellsForColumn(columnId, 'pending'), 'Run column'),
    [runMany, cellsForColumn],
  );
  const regenerateColumn = useCallback(
    async (columnId: string) =>
      runMany(cellsForColumn(columnId, 'all'), 'Regenerate column'),
    [runMany, cellsForColumn],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    snapshot,
    loading,
    running,
    error,
    runningCell,
    runProgress,
    refresh,
    addColumn,
    updateColumn,
    removeColumn,
    addDocument,
    removeDocument,
    runPending,
    regenerateCell,
    runRow,
    runColumn,
    regenerateRow,
    regenerateColumn,
  };
}
