import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShellContent,
  cn,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  EyeOff,
  History,
  LoadingState,
  Pagination,
  Pencil,
  Plus,
  RowActions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Trash2,
  Users,
  useConfirm,
} from '@teamsuzie/ui';
import { WorkflowFormDialog } from '../components/workflow-form-dialog.js';
import { ShareDialog } from '../components/share-dialog.js';
import { WorkflowHistoryDialog } from '../components/workflow-history-dialog.js';
import { PRACTICE_AREAS, practiceAreaLabel } from '../data/practice-areas.js';
import { useWorkflows, type Workflow } from '../hooks/use-workflows.js';

const ALL = 'all';
const PAGE_SIZE = 24;

function escapeCsvField(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replaceAll('"', '""') + '"';
  }
  return value;
}

function buildCsv(workflows: Workflow[]): string {
  const header = ['source', 'id', 'name', 'description', 'practice_areas', 'prompt'];
  const lines = [header.join(',')];
  for (const w of workflows) {
    lines.push(
      [
        w.source,
        w.id,
        w.name,
        w.description,
        w.practiceAreas.join('|'),
        w.prompt,
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LibraryPage() {
  const [areaFilter, setAreaFilter] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [sharing, setSharing] = useState<Workflow | null>(null);
  const [historyFor, setHistoryFor] = useState<Workflow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const navigate = useNavigate();
  const wf = useWorkflows();
  const confirm = useConfirm();

  // Reset to page 1 when the filter changes — staying on page 5 of an empty
  // result set is jarring.
  useEffect(() => {
    setPage(1);
  }, [areaFilter]);

  const matches = (areas: string[]) => areaFilter === ALL || areas.includes(areaFilter);
  const filteredWorkflows = useMemo(() => {
    return wf.workflows
      .filter((w) => matches(w.practiceAreas))
      // Sort: user-owned first (the user's own work goes top of list),
      // then system, both alphabetical within their group.
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === 'user' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [wf.workflows, areaFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredWorkflows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedWorkflows = filteredWorkflows.slice(pageStart, pageStart + PAGE_SIZE);

  const userCount = wf.workflows.filter((w) => w.source === 'user').length;
  const systemCount = wf.workflows.filter((w) => w.source === 'system').length;

  function openInAssistant(workflow: Workflow) {
    navigate('/', {
      state: {
        prefill: workflow.prompt,
        label: workflow.name,
        workflowId: workflow.id,
      },
    });
  }

  async function handleDelete(workflow: Workflow) {
    if (
      !(await confirm({
        title: `Delete "${workflow.name}"?`,
        description: 'The workflow will be removed from your library. There is no undo.',
        confirmLabel: 'Delete workflow',
        variant: 'destructive',
      }))
    ) {
      return;
    }
    setActionError(null);
    try {
      await wf.remove(workflow.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleHide(workflow: Workflow) {
    setActionError(null);
    try {
      await wf.hide(workflow.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Hide failed');
    }
  }

  function handleExport() {
    const csv = buildCsv(wf.workflows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`scopic-workflows-${stamp}.csv`, csv);
  }

  return (
    <>
      {/* Custom Bauhaus header replaces the generic PageHeader so we can use
          display type and decorative rules. */}
      <div className="border-b border-foreground/15 px-8 pb-6 pt-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="label-mono text-foreground/50">Catalog</div>
            <h1 className="mt-2 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold leading-[1] tracking-[-0.02em] text-foreground">
              Library.
            </h1>
            <p className="mt-3 max-w-md font-serif text-[15px] italic text-foreground/65">
              <span className="not-italic font-mono uppercase tracking-[0.10em] text-foreground/45">
                {systemCount.toString().padStart(3, '0')}
              </span>{' '}
              built-in workflows ·{' '}
              <span className="not-italic font-mono uppercase tracking-[0.10em] text-foreground/45">
                {userCount.toString().padStart(3, '0')}
              </span>{' '}
              saved.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={wf.workflows.length === 0}
              className="inline-flex h-9 items-center border border-foreground/30 bg-transparent px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground hover:bg-foreground/[0.04] disabled:opacity-40"
            >
              Export ↓
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-9 items-center gap-2 border border-foreground bg-foreground px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-background hover:bg-saffron-400 hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden /> Create workflow
            </button>
          </div>
        </div>
      </div>

      <AppShellContent className="px-8 pt-6 pb-12">
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-foreground/10 pb-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/55">
              Workflows
            </div>
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger
                className="h-9 w-60 rounded-none border-foreground/30 bg-transparent font-mono text-[10px] uppercase tracking-[0.10em]"
                aria-label="Filter by practice area"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All practice areas</SelectItem>
                {PRACTICE_AREAS.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

            {(wf.error || actionError) && (
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.10em] text-destructive">
                {wf.error || actionError}
              </p>
            )}
            {wf.loading ? (
              <LoadingState>Loading library…</LoadingState>
            ) : filteredWorkflows.length === 0 ? (
              <EmptyState>
                <EmptyStateTitle>No workflows in this practice area</EmptyStateTitle>
                <EmptyStateDescription>
                  Pick a different filter, or create one from the top-right.
                </EmptyStateDescription>
              </EmptyState>
            ) : (
              <>
                {/* Workflow grid — hairline-bordered tiles. The leading
                    "INDEX / TOTAL" mono caption gives the bauhaus engineering
                    feel; the practice-area chip uses saffron when filtered. */}
                <div className="grid auto-rows-fr gap-px bg-foreground/15 sm:grid-cols-2 lg:grid-cols-3">
                  {pagedWorkflows.map((workflow, idx) => {
                    const isUser = workflow.source === 'user';
                    const absoluteIndex = pageStart + idx + 1;
                    return (
                      <div key={workflow.id} className="group relative h-full bg-background">
                        <button
                          type="button"
                          onClick={() => openInAssistant(workflow)}
                          className="flex h-full w-full flex-col items-start gap-2 px-5 py-5 text-left transition-colors hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-saffron-400"
                        >
                          <div className="flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40">
                            <span>
                              {String(absoluteIndex).padStart(3, '0')} /{' '}
                              {String(filteredWorkflows.length).padStart(3, '0')}
                            </span>
                            {isUser && (
                              <span className="bg-foreground px-1.5 py-0.5 text-background">
                                Saved
                              </span>
                            )}
                          </div>
                          <div className="font-display text-[15px] leading-tight tracking-tight text-foreground">
                            {workflow.name}
                          </div>
                          <div className="line-clamp-3 text-[13px] leading-relaxed text-foreground/65">
                            {workflow.description}
                          </div>
                          <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                            {workflow.practiceAreas.map((id) => (
                              <span
                                key={id}
                                className={cn(
                                  'inline-flex items-center font-mono text-[9px] uppercase tracking-[0.10em]',
                                  'border-l-2 pl-1.5',
                                  areaFilter === id
                                    ? 'border-saffron-400 text-foreground'
                                    : 'border-foreground/25 text-foreground/55',
                                )}
                              >
                                {practiceAreaLabel(id)}
                              </span>
                            ))}
                          </div>
                          <span
                            aria-hidden
                            className="absolute bottom-3 right-4 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/0 transition-colors group-hover:text-saffron-600"
                          >
                            Open →
                          </span>
                        </button>
                        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100">
                          <span onClick={(e) => e.stopPropagation()}>
                            <RowActions
                              triggerLabel={`Actions for ${workflow.name}`}
                              actions={
                                isUser
                                  ? [
                                      {
                                        id: 'edit',
                                        label: 'Edit',
                                        icon: Pencil,
                                        onSelect: () => setEditing(workflow),
                                      },
                                      {
                                        id: 'history',
                                        label: 'History',
                                        icon: History,
                                        onSelect: () => setHistoryFor(workflow),
                                      },
                                      {
                                        id: 'share',
                                        label: 'Share',
                                        icon: Users,
                                        onSelect: () => setSharing(workflow),
                                      },
                                      {
                                        id: 'delete',
                                        label: 'Delete',
                                        icon: Trash2,
                                        destructive: true,
                                        separatorBefore: true,
                                        onSelect: () => void handleDelete(workflow),
                                      },
                                    ]
                                  : [
                                      {
                                        id: 'hide',
                                        label: 'Hide from library',
                                        icon: EyeOff,
                                        onSelect: () => void handleHide(workflow),
                                      },
                                    ]
                              }
                            />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div>
                      Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredWorkflows.length)} of{' '}
                      {filteredWorkflows.length}
                    </div>
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setPage}
                      size="sm"
                    />
                  </div>
                )}
              </>
            )}
      </AppShellContent>

      <WorkflowFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          await wf.create(input);
        }}
      />
      <WorkflowFormDialog
        mode="edit"
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        initial={editing}
        onUpdate={async (id, patch) => {
          await wf.update(id, patch);
          setEditing(null);
        }}
      />
      <ShareDialog
        open={sharing !== null}
        onOpenChange={(open) => {
          if (!open) setSharing(null);
        }}
        subject={sharing ? { type: 'workflow', id: sharing.id } : null}
        subjectName={sharing?.name ?? ''}
        subjectNoun="workflow"
      />
      <WorkflowHistoryDialog
        open={historyFor !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null);
        }}
        workflow={historyFor}
        onRestored={() => {
          // The list cache holds the pre-restore name/prompt — refresh to
          // pick up the post-restore live row.
          void wf.refresh();
        }}
      />
    </>
  );
}
