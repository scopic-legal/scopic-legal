import * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  DocFindBar,
  DocxPreview,
  FileText,
  PdfPreview,
  useSidePanel,
  type DocFindBarHandle,
  type DocxPreviewHandle,
  type PdfPreviewHandle,
} from '@teamsuzie/ui';

export interface OpenDocInput {
  /**
   * Stable doc id within the matter — typically the file_id. Combined
   * with `matterId` to form the side-panel tab id, so re-opening the
   * same doc focuses the existing tab instead of duplicating it.
   */
  fileId: string;
  matterId: string;
  fileName: string;
  mimeType: string;
  /** URL to fetch the doc bytes — usually `/api/files/<matterId>/<fileId>/content`. */
  url: string;
  /** Optional citation quote to highlight on load. */
  quote?: string;
  /** Optional page hint for PDFs. */
  page?: number;
}

interface DocTabState extends OpenDocInput {
  tabId: string;
  /**
   * Strictly-increasing counter that ticks on every `openDoc` for the
   * same tab id. The tab content listens to this to know when to
   * re-fire `jumpTo` for a new citation that landed on an
   * already-mounted preview.
   */
  generation: number;
}

interface DocSidePanelContextValue {
  states: Map<string, DocTabState>;
  openDoc: (input: OpenDocInput) => void;
}

const DocSidePanelContext = createContext<DocSidePanelContextValue | null>(null);

function useDocStates(): Map<string, DocTabState> {
  const ctx = useContext(DocSidePanelContext);
  if (!ctx) throw new Error('DocSidePanelContext missing');
  return ctx.states;
}

/**
 * Scopic-side wrapper around `useSidePanel` for opening document
 * previews as side-panel tabs. The tab id keys on
 * `matter:<matterId>:<fileId>`, so re-clicking a citation for the
 * same doc focuses the existing tab instead of duplicating it; a new
 * quote bumps the tab's `generation` so the live preview re-fires
 * `jumpTo` without unmounting.
 *
 * Mount the provider inside `<SidePanelProvider>` once. Every page
 * that surfaces citations calls `useDocSidePanel().openDoc(...)` from
 * its citation-jump handler.
 */
export function DocSidePanelProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<Map<string, DocTabState>>(new Map());
  const sidePanel = useSidePanel();
  // generationsRef tracks the last issued generation per tab id without
  // bouncing through render — avoids racey writes when multiple
  // citations are clicked in quick succession.
  const generationsRef = useRef<Map<string, number>>(new Map());

  const openDoc = useCallback(
    (input: OpenDocInput) => {
      const tabId = `doc:${input.matterId}:${input.fileId}`;
      const nextGen = (generationsRef.current.get(tabId) ?? 0) + 1;
      generationsRef.current.set(tabId, nextGen);
      const state: DocTabState = { ...input, tabId, generation: nextGen };
      setStates((current) => {
        const next = new Map(current);
        next.set(tabId, state);
        return next;
      });
      sidePanel.openTab({
        id: tabId,
        title: input.fileName,
        icon: FileText,
        // Tiny render shell — content reads its own state from context
        // on every render, so updates land on already-mounted tabs.
        render: () => <DocTabContent tabId={tabId} />,
      });
    },
    [sidePanel],
  );

  const value = useMemo<DocSidePanelContextValue>(
    () => ({ states, openDoc }),
    [states, openDoc],
  );

  return (
    <DocSidePanelContext.Provider value={value}>
      {children}
    </DocSidePanelContext.Provider>
  );
}

/**
 * Imperative entry point for the side-panel doc viewer. Call from a
 * citation-chip jump handler:
 *
 *   const { openDoc } = useDocSidePanel();
 *   openDoc({ matterId, fileId, fileName, mimeType, url, quote });
 */
export function useDocSidePanel(): { openDoc: (input: OpenDocInput) => void } {
  const ctx = useContext(DocSidePanelContext);
  if (!ctx) {
    throw new Error(
      'useDocSidePanel() requires <DocSidePanelProvider> mounted inside <SidePanelProvider>.',
    );
  }
  return { openDoc: ctx.openDoc };
}

function isPdf(mime: string, name: string): boolean {
  return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}
function isDocx(mime: string, name: string): boolean {
  return (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.toLowerCase().endsWith('.docx')
  );
}

interface DocTabContentProps {
  tabId: string;
}

/**
 * Live preview surface for one doc tab. Pulls its own state from
 * `DocSidePanelContext` on every render — that's what lets a fresh
 * `openDoc` for the same tab id deliver a new quote / page to an
 * already-mounted preview.
 */
function DocTabContent({ tabId }: DocTabContentProps) {
  const states = useDocStates();
  const state = states.get(tabId);
  const pdfRef = useRef<PdfPreviewHandle | null>(null);
  const docxRef = useRef<DocxPreviewHandle | null>(null);
  const lastFiredGenerationRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const findBarRef = useRef<DocFindBarHandle | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCount, setFindCount] = useState(0);
  const [findCurrent, setFindCurrent] = useState(0);
  const isDocxState = state ? isDocx(state.mimeType, state.fileName) : false;

  // Cmd-F / Ctrl-F intercept while the side-panel doc tab is hovered or
  // contains focus. Falls back to native browser Find when the rendered
  // tab isn't a DocxPreview (PDF doesn't have findAll yet).
  React.useEffect(() => {
    if (!isDocxState) return;
    function onKeyDown(e: KeyboardEvent) {
      const isFind = (e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F');
      if (!isFind) return;
      const node = containerRef.current;
      if (!node) return;
      // Only intercept when the side panel is actually engaged — pointer
      // over it OR focus inside it. Otherwise let the page-wide Cmd-F
      // through, since users may want to search the chat transcript.
      const active = document.activeElement;
      const focusInside = !!(active && node.contains(active));
      const hoverInside =
        node.matches(':hover') || !!node.querySelector(':hover');
      if (!focusInside && !hoverInside) return;
      e.preventDefault();
      setFindOpen(true);
      window.requestAnimationFrame(() => findBarRef.current?.focus());
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDocxState]);

  // Re-run find on every keystroke. Debounce isn't strictly necessary —
  // findAll is O(N) over text nodes which is fine for typical contracts.
  React.useEffect(() => {
    if (!findOpen || !isDocxState) return;
    const handle = docxRef.current;
    if (!handle) return;
    const { count } = handle.findAll(findQuery);
    setFindCount(count);
    setFindCurrent(count > 0 && findQuery.length > 0 ? 1 : 0);
  }, [findOpen, findQuery, isDocxState, state?.generation]);

  function closeFind() {
    setFindOpen(false);
    setFindQuery('');
    setFindCount(0);
    setFindCurrent(0);
    docxRef.current?.findAll('');
  }
  function nextMatch() {
    if (findCount === 0) return;
    docxRef.current?.findNext();
    setFindCurrent((c) => (c % findCount) + 1);
  }
  function prevMatch() {
    if (findCount === 0) return;
    docxRef.current?.findPrev();
    setFindCurrent((c) => (c <= 1 ? findCount : c - 1));
  }

  // Whenever the generation ticks past what we last fired, re-jump.
  // The PdfPreview/DocxPreview components mount once per tab id and
  // accept multiple jumpTo calls; this hook routes the new citation
  // to the live ref without remounting the document.
  React.useEffect(() => {
    if (!state) return;
    if (state.generation === lastFiredGenerationRef.current) return;
    if (!state.quote && !state.page) return;
    // Defer to next frame so the preview's internal load state has a
    // chance to settle if this fires immediately on first mount.
    const handle = window.requestAnimationFrame(() => {
      pdfRef.current?.jumpTo({ quote: state.quote, page: state.page });
      docxRef.current?.jumpTo({ quote: state.quote, page: state.page });
      lastFiredGenerationRef.current = state.generation;
    });
    return () => window.cancelAnimationFrame(handle);
  }, [state?.generation, state?.quote, state?.page]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Document closed.
      </div>
    );
  }

  if (isPdf(state.mimeType, state.fileName)) {
    return (
      <div ref={containerRef} className="relative h-full">
        <PdfPreview
          ref={pdfRef}
          src={state.url}
        />
      </div>
    );
  }
  if (isDocx(state.mimeType, state.fileName)) {
    return (
      <div ref={containerRef} className="relative h-full">
        <DocxPreview
          ref={docxRef}
          src={state.url}
        />
        {findOpen && (
          <DocFindBar
            ref={findBarRef}
            query={findQuery}
            onQueryChange={setFindQuery}
            count={findCount}
            currentIndex={findCurrent}
            onPrev={prevMatch}
            onNext={nextMatch}
            onClose={closeFind}
          />
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      No preview available for {state.mimeType}.
    </div>
  );
}
