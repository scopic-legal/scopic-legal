import { useNavigate } from 'react-router-dom';
import {
  AppShellContent,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  LoadingState,
  Trash2,
  useConfirm,
} from '@teamsuzie/ui';
import { useAssistantChats } from '../hooks/use-assistant-chats.js';

function formatDate(ms: number): string {
  return new Date(ms)
    .toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .toUpperCase();
}

export function HistoryPage() {
  const { chats, loading, error, remove } = useAssistantChats();
  const navigate = useNavigate();
  const confirm = useConfirm();

  async function handleDelete(chatId: string, name: string) {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      description: 'This removes the chat and all of its messages. There is no undo.',
      confirmLabel: 'Delete chat',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await remove(chatId);
    } catch {
      // useConfirm doesn't surface this, but the hook's local state is already
      // unchanged on failure — the user can retry.
    }
  }

  return (
    <>
      <div className="border-b border-foreground/15 px-8 pb-6 pt-8">
        <div className="label-mono text-foreground/50">Archive</div>
        <h1 className="mt-2 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold leading-[1] tracking-[-0.02em] text-foreground">
          History.
        </h1>
        <p className="mt-3 font-serif text-[15px] italic text-foreground/65">
          Recent assistant conversations.
        </p>
      </div>
      <AppShellContent className="px-8 pt-6 pb-12">
        {loading ? (
          <LoadingState>Loading chats…</LoadingState>
        ) : error ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-destructive">
            {error}
          </p>
        ) : chats.length === 0 ? (
          <EmptyState>
            <EmptyStateTitle>No conversations yet</EmptyStateTitle>
            <EmptyStateDescription>
              Start a new chat from the Assistant page — it'll show up here.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <ul className="border-t border-foreground/15">
            {chats.map((chat, idx) => (
              <li
                key={chat.id}
                className="group flex items-center justify-between gap-3 border-b border-foreground/10 px-2 py-4 transition-colors hover:bg-foreground/[0.025]"
              >
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/c/${encodeURIComponent(chat.id)}`)
                  }
                  className="flex min-w-0 flex-1 items-baseline gap-4 text-left"
                >
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40">
                    {String(idx + 1).padStart(3, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-display text-[14px] tracking-tight text-foreground">
                    {chat.name || 'New chat'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.10em] text-foreground/45">
                    {formatDate(chat.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(chat.id, chat.name)}
                  aria-label={`Delete ${chat.name}`}
                  className="ml-3 inline-flex size-7 items-center justify-center text-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </AppShellContent>
    </>
  );
}
