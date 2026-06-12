import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AppShellContent,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  LayoutGrid,
  Input,
  Label,
  LoadingState,
  MoreHorizontal,
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  PendingButton,
  Plus,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Trash2,
  Upload,
  Users,
  cn,
  humanSize,
  useConfirm,
  useSidePanel,
} from '@teamsuzie/ui';
import { useDocSidePanel } from '../components/document-side-panel.js';
import { FromWorkflowDialog } from '../components/from-workflow-dialog.js';
import {
  CompareVersionsDialog,
  DiffPanel,
  type DocumentDiffResult,
} from '../components/compare-versions.js';
import { ShareDialog } from '../components/share-dialog.js';
import { useMatter, type MatterDocument, type MatterFolder } from '../hooks/use-matter.js';
import { useReviews, type Review } from '../hooks/use-reviews.js';
import { useMatterChats } from '../hooks/use-matter-chats.js';
import { useWorkflows } from '../hooks/use-workflows.js';

const ROOT = '__root__';
const DRAG_MIME = 'application/scopic-matter+json';

interface RedactionSummary {
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
}

interface RedactionReportDocument {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'scanned' | 'error';
  summary: RedactionSummary;
  provider: 'presidio' | 'local' | 'hybrid';
  warning?: string;
  error?: string;
}

interface RedactionReport {
  generatedAt: number;
  documents: RedactionReportDocument[];
  summary: RedactionSummary;
  mode: 'auto' | 'always' | 'off';
  presidio: { configured: boolean };
  skipped: number;
}

interface DragPayload {
  kind: 'doc' | 'folder';
  id: string;
}

function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'move';
}

function readDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed.kind !== 'doc' && parsed.kind !== 'folder') return null;
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function descendantIds(folders: MatterFolder[], rootId: string): Set<string> {
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const f of folders) {
      if (f.parentFolderId === id && !out.has(f.id)) {
        out.add(f.id);
        stack.push(f.id);
      }
    }
  }
  return out;
}

interface FolderTreeProps {
  folders: MatterFolder[];
  documents: MatterDocument[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onRequestRename: (folder: MatterFolder) => void;
  onRequestDelete: (folder: MatterFolder) => void;
  onDropOnFolder: (folderId: string | null, payload: DragPayload) => void;
}

function FolderTree({
  folders,
  documents,
  selectedKey,
  onSelect,
  onRequestRename,
  onRequestDelete,
  onDropOnFolder,
}: FolderTreeProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, MatterFolder[]>();
    for (const f of folders) {
      const arr = map.get(f.parentFolderId) ?? [];
      arr.push(f);
      map.set(f.parentFolderId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    return map;
  }, [folders]);

  const handleDragStart = (folder: MatterFolder) => (e: React.DragEvent) => {
    setDragPayload(e, { kind: 'folder', id: folder.id });
  };

  // For folder drop targets we have to be picky: don't accept drops onto
  // self or descendants (server would reject them as cycles, and previewing
  // an invalid drop is worse UX than just refusing).
  const isInvalidFolderDrop = (
    payload: DragPayload | null,
    targetFolderId: string | null,
  ): boolean => {
    if (!payload) return true;
    if (payload.kind !== 'folder') return false;
    if (targetFolderId === null) return false;
    if (payload.id === targetFolderId) return true;
    return descendantIds(folders, payload.id).has(targetFolderId);
  };

  const acceptDragOver = (targetKey: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverKey !== targetKey) setDragOverKey(targetKey);
  };

  const handleDragLeave = () => setDragOverKey(null);

  const handleDrop = (folderId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverKey(null);
    const payload = readDragPayload(e);
    if (!payload) return;
    if (isInvalidFolderDrop(payload, folderId)) return;
    onDropOnFolder(folderId, payload);
  };

  const renderNode = (folder: MatterFolder, depth: number) => {
    const children = childrenByParent.get(folder.id) ?? [];
    const isSelected = selectedKey === folder.id;
    const isDragOver = dragOverKey === folder.id;
    return (
      <li key={folder.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded transition-colors',
            isSelected && 'bg-accent',
            isDragOver && 'outline outline-2 outline-primary/60 bg-primary/5',
          )}
          draggable
          onDragStart={handleDragStart(folder)}
          onDragOver={acceptDragOver(folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop(folder.id)}
        >
          <button
            type="button"
            onClick={() => onSelect(folder.id)}
            className={cn(
              'flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors',
              isSelected
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{folder.name}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={`Actions for ${folder.name}`}
              >
                <MoreHorizontal className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onRequestRename(folder)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onRequestDelete(folder)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {children.length > 0 && (
          <ul>{children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  const roots = childrenByParent.get(null) ?? [];
  const isRootDragOver = dragOverKey === ROOT;
  void documents;

  return (
    <ul className="space-y-0.5">
      <li>
        <div
          className={cn(
            'rounded transition-colors',
            isRootDragOver && 'outline outline-2 outline-primary/60 bg-primary/5',
          )}
          onDragOver={acceptDragOver(ROOT)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop(null)}
        >
          <button
            type="button"
            onClick={() => onSelect(ROOT)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors',
              selectedKey === ROOT
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>All documents</span>
          </button>
        </div>
      </li>
      {roots.map((f) => renderNode(f, 0))}
    </ul>
  );
}

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  parentFolderId: string | null;
  parentName: string;
  onCreate: (name: string) => Promise<void>;
}

function NewFolderDialog({ open, onOpenChange, parentName, onCreate }: NewFolderDialogProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onCreate(trimmed);
      setName('');
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
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Inside {parentName}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <PendingButton
            type="button"
            onClick={() => void submit()}
            pending={busy}
            pendingLabel="Creating"
          >
            Create folder
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RenameFolderDialogProps {
  folder: MatterFolder | null;
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void>;
}

function RenameFolderDialog({ folder, onClose, onRename }: RenameFolderDialogProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = folder !== null;

  // Re-seed the input every time a different folder is targeted.
  useMemo(() => {
    if (folder) {
      setName(folder.name);
      setErr(null);
    }
  }, [folder]);

  async function submit() {
    if (!folder) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Name is required');
      return;
    }
    if (trimmed === folder.name) {
      onClose();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onRename(folder.id, trimmed);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rename-folder">Name</Label>
          <Input
            id="rename-folder"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteFolderDialogProps {
  folder: MatterFolder | null;
  contents: { docCount: number; subfolderCount: number };
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

function DeleteFolderDialog({ folder, contents, onClose, onConfirm }: DeleteFolderDialogProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = folder !== null;
  const { docCount, subfolderCount } = contents;
  const isEmpty = docCount === 0 && subfolderCount === 0;

  async function submit() {
    if (!folder) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(folder.id);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{folder?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {isEmpty
              ? 'This folder is empty.'
              : `Contains ${docCount} document${docCount === 1 ? '' : 's'} and ${subfolderCount} subfolder${subfolderCount === 1 ? '' : 's'}. Documents move to the matter root; subfolders are deleted.`}
          </DialogDescription>
        </DialogHeader>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function entityLabel(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function topEntityTypes(summary: RedactionSummary, limit = 6): Array<[string, number]> {
  return Object.entries(summary.byType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

interface RedactionReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: RedactionReport | null;
  loading: boolean;
  error: string | null;
  onScan: () => Promise<void>;
}

function RedactionReportDialog({
  open,
  onOpenChange,
  report,
  loading,
  error,
  onScan,
}: RedactionReportDialogProps) {
  const topTypes = report ? topEntityTypes(report.summary, 8) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Context privacy scan</DialogTitle>
          <DialogDescription>
            Sensitive spans found across this matter.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!report && !loading ? (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
            No scan yet.
          </div>
        ) : null}

        {loading ? (
          <LoadingState variant="block">Scanning matter context...</LoadingState>
        ) : report ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-xs text-muted-foreground">Sensitive spans</div>
                <div className="mt-1 text-2xl font-semibold">{report.summary.total}</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-xs text-muted-foreground">Documents scanned</div>
                <div className="mt-1 text-2xl font-semibold">{report.documents.length}</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-xs text-muted-foreground">Recognizer</div>
                <div className="mt-1 text-sm font-medium">
                  {report.presidio.configured ? 'Presidio + local' : 'Local legal policy'}
                </div>
              </div>
            </div>

            {topTypes.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Entity mix
                </div>
                <div className="flex flex-wrap gap-2">
                  {topTypes.map(([type, count]) => (
                    <Badge key={type} variant="outline">
                      {entityLabel(type)} {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-[320px] overflow-y-auto rounded-md border border-border">
              <ul className="divide-y divide-border">
                {report.documents.map((doc) => {
                  const docTypes = topEntityTypes(doc.summary, 4);
                  return (
                    <li key={doc.fileId} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{doc.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {doc.status === 'scanned'
                              ? `${doc.summary.total} span${doc.summary.total === 1 ? '' : 's'}`
                              : doc.error ?? 'scan failed'}
                          </div>
                        </div>
                        <Badge variant={doc.status === 'scanned' ? 'outline' : 'destructive'}>
                          {doc.provider}
                        </Badge>
                      </div>
                      {docTypes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {docTypes.map(([type, count]) => (
                            <span
                              key={type}
                              className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {entityLabel(type)} {count}
                            </span>
                          ))}
                        </div>
                      )}
                      {doc.warning && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {doc.warning}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={loading}>
              Close
            </Button>
          </DialogClose>
          <PendingButton
            type="button"
            onClick={() => void onScan()}
            pending={loading}
            pendingLabel="Scanning"
          >
            <EyeOff className="size-4" aria-hidden />
            Scan context
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function ChatsSection({ matterId }: { matterId: string }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const chats = useMatterChats(matterId);
  const [creating, setCreating] = useState(false);

  async function startNewChat() {
    setCreating(true);
    try {
      const chat = await chats.create();
      navigate(
        `/matters/${encodeURIComponent(matterId)}/chats/${encodeURIComponent(chat.id)}`,
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Chats</h2>
        <PendingButton
          size="sm"
          variant="outline"
          onClick={() => void startNewChat()}
          pending={creating}
          pendingLabel="Starting"
        >
          <Plus className="size-4" aria-hidden />
          New chat
        </PendingButton>
      </div>
      {chats.error && <p className="text-xs text-destructive">{chats.error}</p>}
      {chats.loading ? (
        <LoadingState>Loading chats…</LoadingState>
      ) : chats.chats.length === 0 ? (
        <EmptyState>
          <EmptyStateTitle>No chats yet</EmptyStateTitle>
          <EmptyStateDescription>
            Start a chat anchored to this matter. Counsel sees every doc in
            the matter automatically.
          </EmptyStateDescription>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {chats.chats.map((chat) => (
            <li
              key={chat.id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40"
            >
              <Link
                to={`/matters/${encodeURIComponent(matterId)}/chats/${encodeURIComponent(chat.id)}`}
                className="flex-1 min-w-0"
              >
                <div className="truncate text-sm font-medium text-foreground">
                  {chat.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  Updated {formatRelative(chat.updatedAt)}
                </div>
              </Link>
              <Button
                variant="outline"
                size="icon"
                className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete ${chat.name}`}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete chat "${chat.name}"?`,
                      description: 'The conversation history for this chat will be removed.',
                      confirmLabel: 'Delete chat',
                      variant: 'destructive',
                    })
                  ) {
                    void chats.remove(chat.id);
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface NewReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; description?: string }) => Promise<Review>;
  onCreated: (review: Review) => void;
}

function NewReviewDialog({ open, onOpenChange, onCreate, onCreated }: NewReviewDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setErr(null);
    }
  }, [open]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await onCreate({
        name: trimmed,
        description: description.trim() || undefined,
      });
      onCreated(created);
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
          <DialogTitle>New review</DialogTitle>
          <DialogDescription>
            Tabular review of multiple documents — one row per document, one
            column per question.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="review-name">Name</Label>
            <Input
              id="review-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Diligence Q&A"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-description">Description (optional)</Label>
            <Textarea
              id="review-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>Cancel</Button>
          </DialogClose>
          <PendingButton
            onClick={() => void submit()}
            pending={busy}
            pendingLabel="Creating"
          >
            Create review
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewsSection({
  matterId,
  documents,
}: {
  matterId: string;
  documents: MatterDocument[];
}) {
  const navigate = useNavigate();
  const reviews = useReviews(matterId);
  const wf = useWorkflows();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fromWorkflowOpen, setFromWorkflowOpen] = useState(false);
  const [fromWorkflowError, setFromWorkflowError] = useState<string | null>(null);

  async function createFromWorkflow(input: {
    workflowId: string;
    externalDocIds: string[];
  }) {
    setFromWorkflowError(null);
    const res = await fetch(
      `/api/matters/${encodeURIComponent(matterId)}/reviews/from-workflow`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Failed (${res.status})`);
    }
    const data = (await res.json()) as {
      item: { review: { id: string } } | null;
    };
    if (!data.item) throw new Error('Server returned no review');
    await reviews.refresh();
    navigate(
      `/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(data.item.review.id)}`,
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Reviews</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFromWorkflowOpen(true)}
            disabled={documents.length === 0}
            title={
              documents.length === 0
                ? 'Upload documents to this matter first'
                : 'Create a populated review from a workflow template'
            }
          >
            <LayoutGrid className="size-4" aria-hidden />
            From workflow
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New review
          </Button>
        </div>
      </div>
      {fromWorkflowError && (
        <p className="mb-2 text-xs text-destructive">{fromWorkflowError}</p>
      )}
      {reviews.error && <p className="text-xs text-destructive">{reviews.error}</p>}
      {reviews.loading ? (
        <LoadingState>Loading reviews…</LoadingState>
      ) : reviews.reviews.length === 0 ? (
        <EmptyState>
          <EmptyStateTitle>No reviews yet</EmptyStateTitle>
          <EmptyStateDescription>
            Create a review to ask the same questions across multiple
            documents.
          </EmptyStateDescription>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {reviews.reviews.map((review) => (
            <li
              key={review.id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40"
            >
              <Link
                to={`/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(review.id)}`}
                className="flex-1 min-w-0"
              >
                <div className="truncate text-sm font-medium text-foreground">
                  {review.name}
                </div>
                {review.description && (
                  <div className="truncate text-xs text-muted-foreground">
                    {review.description}
                  </div>
                )}
              </Link>
              <Button
                variant="outline"
                size="icon"
                className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete ${review.name}`}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete review "${review.name}"?`,
                      description:
                        'All columns and answers in this review will be removed. The underlying matter documents are kept.',
                      confirmLabel: 'Delete review',
                      variant: 'destructive',
                    })
                  ) {
                    void reviews.remove(review.id);
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <NewReviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={reviews.create}
        onCreated={(review) =>
          navigate(
            `/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(review.id)}`,
          )
        }
      />
      <FromWorkflowDialog
        open={fromWorkflowOpen}
        onOpenChange={setFromWorkflowOpen}
        workflows={wf.workflows}
        workflowsLoading={wf.loading}
        documents={documents}
        onSubmit={async (input) => {
          try {
            await createFromWorkflow(input);
          } catch (err) {
            setFromWorkflowError(
              err instanceof Error ? err.message : 'Failed to create review',
            );
            throw err;
          }
        }}
      />
    </section>
  );
}

export function MatterDetailPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const confirm = useConfirm();
  const {
    matter,
    folders,
    documents,
    loading,
    error,
    createFolder,
    renameFolder,
    deleteFolder,
    uploadDocument,
    moveDocument,
    moveFolder,
    removeDocument,
  } = useMatter(matterId);

  const [selectedKey, setSelectedKey] = useState<string>(ROOT);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<MatterFolder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MatterFolder | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { openDoc: openDocInPanel } = useDocSidePanel();
  const sidePanel = useSidePanel();
  const [compareOpen, setCompareOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [redactionOpen, setRedactionOpen] = useState(false);
  const [redactionReport, setRedactionReport] = useState<RedactionReport | null>(null);
  const [redactionLoading, setRedactionLoading] = useState(false);
  const [redactionError, setRedactionError] = useState<string | null>(null);

  async function runRedactionScan() {
    if (!matterId) return;
    setRedactionLoading(true);
    setRedactionError(null);
    try {
      const res = await fetch(
        `/api/matters/${encodeURIComponent(matterId)}/redaction/report`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Scan failed (${res.status})`);
      }
      const report = (await res.json()) as RedactionReport;
      setRedactionReport(report);
    } catch (err) {
      setRedactionError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setRedactionLoading(false);
    }
  }

  async function runCompare(input: { leftFileId: string; rightFileId: string }) {
    if (!matterId) return;
    const res = await fetch(
      `/api/matters/${encodeURIComponent(matterId)}/diff`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Compare failed (${res.status})`);
    }
    const result = (await res.json()) as DocumentDiffResult;
    sidePanel.openTab({
      id: `compare:${matterId}:${input.leftFileId}:${input.rightFileId}`,
      title: `${result.left.name} vs ${result.right.name}`,
      icon: GitCompareArrows,
      render: () => (
        <DiffPanel
          result={result}
          matterId={matterId}
          leftFileId={input.leftFileId}
          rightFileId={input.rightFileId}
        />
      ),
    });
  }

  const currentFolderId = selectedKey === ROOT ? null : selectedKey;
  const currentFolder = currentFolderId
    ? folders.find((f) => f.id === currentFolderId) ?? null
    : null;

  // Show docs at root when "All documents" is selected, otherwise filter to
  // the selected folder. (Subfolder contents stay scoped to their own row.)
  const visibleDocs =
    selectedKey === ROOT
      ? documents
      : documents.filter((d) => d.folderId === currentFolderId);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadDocument(file, currentFolderId);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const deleteContents = useMemo(() => {
    if (!deleteTarget) return { docCount: 0, subfolderCount: 0 };
    const descendants = descendantIds(folders, deleteTarget.id);
    const allFolderIds = new Set<string>([deleteTarget.id, ...descendants]);
    const docCount = documents.filter(
      (d) => d.folderId !== null && allFolderIds.has(d.folderId),
    ).length;
    return { docCount, subfolderCount: descendants.size };
  }, [deleteTarget, folders, documents]);

  function handleDropOnFolder(folderId: string | null, payload: DragPayload) {
    if (payload.kind === 'doc') {
      void moveDocument(payload.id, folderId);
    } else if (payload.kind === 'folder') {
      void moveFolder(payload.id, folderId);
    }
  }

  function openDoc(doc: MatterDocument) {
    if (!matterId) return;
    openDocInPanel({
      matterId,
      fileId: doc.externalDocId,
      fileName: doc.name,
      mimeType: doc.mimeType ?? 'application/octet-stream',
      url: `/api/files/${encodeURIComponent(matterId)}/${encodeURIComponent(
        doc.externalDocId,
      )}/content`,
    });
  }

  if (!matterId) {
    return (
      <>
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Matter</PageHeaderTitle>
          </PageHeaderContent>
        </PageHeader>
        <AppShellContent className="px-6 pt-6 pb-12">
          <p className="text-sm text-destructive">Missing matter id.</p>
        </AppShellContent>
      </>
    );
  }

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <Link
            to="/matters"
            className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← All matters
          </Link>
          <PageHeaderTitle>{matter?.name ?? 'Matter'}</PageHeaderTitle>
          {matter?.description && (
            <PageHeaderDescription>{matter.description}</PageHeaderDescription>
          )}
        </PageHeaderContent>
        <PageHeaderActions>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <Button
            variant="outline"
            onClick={() => setShareOpen(true)}
            disabled={!matter}
            title="Share this matter with a colleague"
          >
            <Users className="size-4" aria-hidden />
            Share
          </Button>
          <Button
            variant="outline"
            onClick={() => setCompareOpen(true)}
            disabled={!matter || documents.length < 2}
            title={
              documents.length < 2
                ? 'Upload at least two documents to compare'
                : 'Compare two versions paragraph-by-paragraph'
            }
          >
            <GitCompareArrows className="size-4" aria-hidden />
            Compare versions
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setRedactionOpen(true);
              if (!redactionReport && !redactionLoading) {
                void runRedactionScan();
              }
            }}
            disabled={!matter || documents.length === 0}
            title={
              documents.length === 0
                ? 'Upload documents to scan context'
                : 'Scan matter context for sensitive entities'
            }
          >
            <EyeOff className="size-4" aria-hidden />
            Privacy scan
          </Button>
          <Button
            variant="outline"
            onClick={() => setFolderDialogOpen(true)}
            disabled={!matter}
          >
            <FolderPlus className="size-4" aria-hidden />
            New folder
          </Button>
          <PendingButton
            onClick={() => fileInputRef.current?.click()}
            disabled={!matter}
            pending={uploading}
            pendingLabel="Uploading"
          >
            <Upload className="size-4" aria-hidden />
            Upload documents
          </PendingButton>
        </PageHeaderActions>
      </PageHeader>
      <AppShellContent className="px-6 pt-6 pb-12">
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {uploadError && <p className="mb-4 text-sm text-destructive">{uploadError}</p>}

        {loading ? (
          <LoadingState variant="block">Loading matter…</LoadingState>
        ) : !matter ? (
          <p className="text-sm text-muted-foreground">Matter not found.</p>
        ) : (
          <Tabs defaultValue="documents" className="space-y-6">
            <TabsList>
              <TabsTrigger value="documents">
                Documents
                {documents.length > 0 && (
                  <span className="ml-1.5 text-muted-foreground">
                    {documents.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="chats">Chats</TabsTrigger>
              <TabsTrigger value="reviews">Reviews</TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <div
                className={cn(
                  'gap-6',
                  folders.length > 0
                    ? 'grid lg:grid-cols-[220px_minmax(0,1fr)]'
                    : '',
                )}
              >
                {folders.length > 0 && (
                  <aside className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Folders
                    </div>
                    <FolderTree
                      folders={folders}
                      documents={documents}
                      selectedKey={selectedKey}
                      onSelect={setSelectedKey}
                      onRequestRename={(folder) => setRenameTarget(folder)}
                      onRequestDelete={(folder) => setDeleteTarget(folder)}
                      onDropOnFolder={handleDropOnFolder}
                    />
                  </aside>
                )}

                <section>
                  {folders.length > 0 && (
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="text-sm font-semibold tracking-tight">
                        {selectedKey === ROOT
                          ? 'All documents'
                          : currentFolder?.name ?? 'Folder'}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        {visibleDocs.length} doc
                        {visibleDocs.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                  {visibleDocs.length === 0 ? (
                    <EmptyState>
                      <EmptyStateTitle>No documents here yet</EmptyStateTitle>
                      <EmptyStateDescription>
                        Upload PDFs, DOCX, or other files to this matter.
                      </EmptyStateDescription>
                      <Button
                        className="mt-4"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        <Upload className="size-4" aria-hidden />
                        Upload documents
                      </Button>
                    </EmptyState>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border bg-card">
                      {visibleDocs.map((doc) => (
                        <li
                          key={doc.id}
                          draggable
                          onDragStart={(e) => setDragPayload(e, { kind: 'doc', id: doc.id })}
                          className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 cursor-grab active:cursor-grabbing"
                        >
                          <button
                            type="button"
                            onClick={() => openDoc(doc)}
                            className="flex flex-1 items-center gap-3 text-left"
                          >
                            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-foreground">
                                {doc.name}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {doc.mimeType ?? 'unknown'}
                                {typeof doc.size === 'number' &&
                                  ` · ${humanSize(doc.size)}`}
                                {' · added '}
                                {formatDate(doc.addedAt)}
                              </div>
                            </div>
                          </button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: `Remove "${doc.name}"?`,
                                  description:
                                    'The document is removed from this matter and any review rows or chat history that referenced it. The original upload is also deleted.',
                                  confirmLabel: 'Remove document',
                                  variant: 'destructive',
                                })
                              ) {
                                void removeDocument(doc.id);
                              }
                            }}
                            aria-label={`Remove ${doc.name}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </TabsContent>

            <TabsContent value="chats">
              <ChatsSection matterId={matter.id} />
            </TabsContent>

            <TabsContent value="reviews">
              <ReviewsSection matterId={matter.id} documents={documents} />
            </TabsContent>
          </Tabs>
        )}
      </AppShellContent>

      <NewFolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        parentFolderId={currentFolderId}
        parentName={
          selectedKey === ROOT
            ? matter?.name ?? 'matter root'
            : currentFolder?.name ?? 'folder'
        }
        onCreate={async (name) => {
          await createFolder(name, currentFolderId);
        }}
      />

      <RenameFolderDialog
        folder={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={renameFolder}
      />

      <DeleteFolderDialog
        folder={deleteTarget}
        contents={deleteContents}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async (id) => {
          await deleteFolder(id);
          // If the user was viewing the folder we just nuked, jump to root.
          if (selectedKey === id) setSelectedKey(ROOT);
        }}
      />

      <CompareVersionsDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        documents={documents}
        onSubmit={runCompare}
      />

      <RedactionReportDialog
        open={redactionOpen}
        onOpenChange={setRedactionOpen}
        report={redactionReport}
        loading={redactionLoading}
        error={redactionError}
        onScan={runRedactionScan}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        subject={matter ? { type: 'matter', id: matter.id } : null}
        subjectName={matter?.name ?? ''}
        subjectNoun="matter"
      />
    </>
  );
}
