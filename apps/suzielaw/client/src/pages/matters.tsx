import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShellContent,
  Archive,
  Button,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  Input,
  Label,
  LoadingState,
  PendingButton,
  Switch,
  Textarea,
  cn,
  useConfirm,
} from '@teamsuzie/ui';
import { useMatters, type Matter } from '../hooks/use-matters.js';
import { ShareDialog } from '../components/share-dialog.js';

function formatDate(ms: number): string {
  return new Date(ms)
    .toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    })
    .toUpperCase();
}

interface NewMatterDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreate: (input: { name: string; description?: string }) => Promise<void>;
}

function NewMatterDialog({ open, onOpenChange, onCreate }: NewMatterDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: trimmedName,
        description: description.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create matter');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New matter</DialogTitle>
          <DialogDescription>
            Group documents, chats, and reviews together under a single matter.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="matter-name">Name</Label>
            <Input
              id="matter-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme acquisition"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="matter-description">Description (optional)</Label>
            <Textarea
              id="matter-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What's this matter about?"
              rows={3}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <PendingButton
            type="button"
            onClick={() => void handleSubmit()}
            pending={submitting}
            pendingLabel="Creating"
          >
            Create matter
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MatterCardProps {
  matter: Matter;
  onRename: (id: string, name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onUnarchive: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function MatterCard({ matter, onRename, onArchive, onUnarchive, onDelete }: MatterCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(matter.name);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();
  const navigate = useNavigate();

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const navigateToMatter = () => {
    if (editing) return;
    navigate(`/matters/${encodeURIComponent(matter.id)}`);
  };

  async function commitRename() {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === matter.name) {
      setDraftName(matter.name);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(matter.id, trimmed);
    } catch {
      setDraftName(matter.name);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  }

  const isArchived = matter.archivedAt !== null;

  return (
    <Card
      role={editing ? undefined : 'link'}
      tabIndex={editing ? undefined : 0}
      onClick={editing ? undefined : navigateToMatter}
      onKeyDown={
        editing
          ? undefined
          : (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigateToMatter();
              }
            }
      }
      className={cn(
        'flex flex-col transition-all',
        !editing &&
          'cursor-pointer hover:border-foreground/30 hover:shadow-sm focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        isArchived && 'opacity-70',
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              ref={inputRef}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraftName(matter.name);
                  setEditing(false);
                }
              }}
              disabled={busy}
              className="h-7 text-base font-semibold"
            />
          ) : (
            <CardTitle className="truncate text-base">
              <span>{matter.name}</span>
              {isArchived && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Archived
                </span>
              )}
            </CardTitle>
          )}
          {matter.description && (
            <CardDescription className="mt-1 line-clamp-2">
              {matter.description}
            </CardDescription>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Matter actions"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShareOpen(true)}>
              <Users className="size-4" aria-hidden />
              Share
            </DropdownMenuItem>
            {isArchived ? (
              <DropdownMenuItem onSelect={() => void onUnarchive(matter.id)}>
                <Archive className="size-4" aria-hidden />
                Unarchive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void onArchive(matter.id)}>
                <Archive className="size-4" aria-hidden />
                Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={async (e) => {
                e.preventDefault();
                if (
                  await confirm({
                    title: `Delete "${matter.name}"?`,
                    description:
                      'This removes the matter and everything inside it — documents, chats, reviews. There is no undo.',
                    confirmLabel: 'Delete matter',
                    variant: 'destructive',
                  })
                ) {
                  void onDelete(matter.id);
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="flex-1" />
      <CardFooter className="text-xs text-muted-foreground">
        Created {formatDate(matter.createdAt)}
        {matter.updatedAt !== matter.createdAt && (
          <span className="ml-3">Updated {formatDate(matter.updatedAt)}</span>
        )}
      </CardFooter>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        subject={{ type: 'matter', id: matter.id }}
        subjectName={matter.name}
        subjectNoun="matter"
      />
    </Card>
  );
}

export function MattersPage() {
  const {
    matters,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    create,
    update,
    archive,
    unarchive,
    remove,
  } = useMatters();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleRename = async (id: string, name: string) => {
    await update(id, { name });
  };

  const handleCreate = async (input: { name: string; description?: string }) => {
    await create({ name: input.name, description: input.description });
  };

  return (
    <>
      <div className="border-b border-foreground/15 px-8 pb-6 pt-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="label-mono text-foreground/50">Docket</div>
            <h1 className="mt-2 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold leading-[1] tracking-[-0.02em] text-foreground">
              Matters.
            </h1>
            <p className="mt-3 max-w-md font-serif text-[15px] italic text-foreground/65">
              Group documents, chats, and reviews under a matter.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-[0.10em] text-foreground/55">
              <Switch
                checked={includeArchived}
                onCheckedChange={setIncludeArchived}
                aria-label="Show archived matters"
              />
              <span>Show archived</span>
            </label>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="inline-flex h-9 items-center gap-2 border border-foreground bg-foreground px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-background hover:bg-saffron-400 hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden /> New matter
            </button>
          </div>
        </div>
      </div>
      <AppShellContent className="px-8 pt-6 pb-12">
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {loading ? (
          <LoadingState>Loading matters…</LoadingState>
        ) : matters.length === 0 ? (
          <EmptyState>
            <EmptyStateTitle>No matters yet</EmptyStateTitle>
            <EmptyStateDescription>
              Create your first matter to start grouping documents and chats.
            </EmptyStateDescription>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Create your first matter
            </Button>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {matters.map((matter) => (
              <MatterCard
                key={matter.id}
                matter={matter}
                onRename={handleRename}
                onArchive={archive}
                onUnarchive={unarchive}
                onDelete={remove}
              />
            ))}
          </div>
        )}
      </AppShellContent>

      <NewMatterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
      />
    </>
  );
}
