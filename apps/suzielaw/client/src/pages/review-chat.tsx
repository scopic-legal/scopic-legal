import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AppShellContent,
  Button,
  CitedMarkdownMessage,
  LoadingState,
  MarkdownMessage,
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  PendingButton,
  Plus,
  Send,
  Sparkles,
  Square,
  ToolUseStatus,
  cn,
  useAutoResizeTextarea,
  useSelectedModel,
  type ToolEvent,
} from '@teamsuzie/ui';
import { parseResponse, SENTINEL_OPEN, type Citation } from '@teamsuzie/citations';
import type { ChatMessage as PersistedChatMessage } from '@teamsuzie/chats';
import { useDocSidePanel } from '../components/document-side-panel.js';
import { useReview } from '../hooks/use-review.js';
import { useReviewChats } from '../hooks/use-review-chats.js';
import { useChatComposer } from '../hooks/use-chat-composer.js';
import { WorkflowPickerDialog } from '../components/workflow-picker-dialog.js';
import { selectedModelPayload } from '../data/ollama.js';
import {
  TrackedChangesPanel,
  type ProposeEditsResult,
} from '../components/tracked-changes-panel.js';
import {
  loadRedline,
  redlineDownloadHref,
  resolveRevisions,
} from '../lib/redline-api.js';

const SELECTED_MODEL_KEY = 'scopic:selected-model';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
  parsed?: { text: string; citations: Citation[] };
}

function pageHintFromLocator(locator: string | undefined): number | undefined {
  if (!locator) return undefined;
  const m = locator.match(/\bp\.?\s*(\d+)\b/i) ?? locator.match(/\bpage\s+(\d+)\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function hydratePersisted(messages: PersistedChatMessage[]): UiMessage[] {
  return messages.map((m) => {
    const base: UiMessage = { id: m.id, role: m.role, content: m.content };
    if (m.toolEvents) {
      try {
        base.toolEvents = JSON.parse(m.toolEvents) as ToolEvent[];
      } catch {
        // ignore
      }
    }
    if (m.role === 'assistant') {
      let citations: Citation[] = [];
      if (m.citations) {
        try {
          const parsed = JSON.parse(m.citations) as Citation[];
          if (Array.isArray(parsed)) citations = parsed;
        } catch {
          // ignore
        }
      }
      base.parsed = { text: m.content, citations };
    }
    return base;
  });
}

interface MessageItemProps {
  message: UiMessage;
  agentName: string;
  isActive: boolean;
  onJump: (citation: Citation) => void;
  docLabels: Record<string, string>;
  chatId: string;
}

function proposeEditsResults(message: UiMessage): ProposeEditsResult[] {
  if (!message.toolEvents) return [];
  const out: ProposeEditsResult[] = [];
  for (const e of message.toolEvents) {
    if (e.name !== 'propose_document_edits') continue;
    if (e.status !== 'done') continue;
    const result = e.result as ProposeEditsResult | undefined;
    if (result && typeof result === 'object' && 'download_file_id' in result) {
      out.push(result);
    }
  }
  return out;
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      role="status"
      aria-label="Assistant is typing"
    >
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

function MessageItem({ message, agentName, isActive, onJump, docLabels, chatId }: MessageItemProps) {
  const isUser = message.role === 'user';
  const hasToolEvents = !!message.toolEvents && message.toolEvents.length > 0;
  const showTyping =
    !isUser && isActive && message.content.length === 0 && !hasToolEvents;
  const proposeResults = isUser ? [] : proposeEditsResults(message);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  const liveText = message.parsed
    ? null
    : message.content.split(SENTINEL_OPEN)[0] ?? '';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">
        {agentName}
      </div>
      {showTyping ? (
        <div className="text-sm leading-relaxed">
          <TypingDots />
        </div>
      ) : message.parsed ? (
        <CitedMarkdownMessage
          content={message.parsed.text}
          citations={message.parsed.citations}
          docLabels={docLabels}
          onJump={onJump}
        />
      ) : (
        liveText && liveText.length > 0 && <MarkdownMessage content={liveText} />
      )}
      {isActive && hasToolEvents && <ToolUseStatus events={message.toolEvents!} />}
      {proposeResults.map((result) => (
        <TrackedChangesPanel
          key={`${message.id}:${result.download_file_id}`}
          result={result}
          chatId={chatId}
          onResolve={resolveRevisions}
          onLoadRedline={loadRedline}
          downloadHref={redlineDownloadHref(
            result.download_session_id,
            result.download_file_id,
          )}
        />
      ))}
    </div>
  );
}

/**
 * Persistent chat scoped to a review. Same surface as `MatterChatPage`
 * but anchored to a review's row set instead of the matter's full doc
 * list — the server attaches only the review's documents to each turn.
 *
 * Mirrors the matter-chat page deliberately rather than abstracting:
 * the two scopes share UI but diverge in URL plumbing, doc resolution,
 * and breadcrumb chrome, and the abstraction would obscure more than
 * it'd save. Refactor to a shared component if a third scope shows up.
 */
export function ReviewChatPage() {
  const params = useParams<{ matterId: string; reviewId: string; chatId: string }>();
  const matterId = params.matterId;
  const reviewId = params.reviewId;
  const chatId = params.chatId;

  const navigate = useNavigate();
  const review = useReview(matterId, reviewId);
  const reviewChats = useReviewChats(matterId, reviewId);
  const [creatingNewChat, setCreatingNewChat] = useState(false);
  const [chatName, setChatName] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Workflow picker state. Same one-shot pattern as assistant.tsx.
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(
    null,
  );
  const [pendingWorkflowLabel, setPendingWorkflowLabel] = useState<string | null>(
    null,
  );
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const { openDoc } = useDocSidePanel();
  const [selectedModel] = useSelectedModel(SELECTED_MODEL_KEY);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set while a /api/chat fetch is in flight so the user can stop it. The
  // server's res.on('close') aborts the upstream LLM call when the socket
  // goes away, and the partial assistant turn is persisted server-side.
  const abortRef = useRef<AbortController | null>(null);
  useAutoResizeTextarea(textareaRef, input, { minHeight: 64, maxHeight: 320 });

  const reviewDocs = review.snapshot?.documents ?? [];
  const reviewName = review.snapshot?.review.name ?? 'Review';

  const docLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of reviewDocs) out[d.externalDocId] = d.name;
    return out;
  }, [reviewDocs]);

  const chatsApiBase =
    matterId && reviewId
      ? `/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}/chats`
      : null;

  // Load chat metadata + history on mount.
  useEffect(() => {
    if (!chatsApiBase || !chatId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [chatRes, msgRes] = await Promise.all([
          fetch(`${chatsApiBase}/${encodeURIComponent(chatId)}`, {
            credentials: 'include',
          }),
          fetch(`${chatsApiBase}/${encodeURIComponent(chatId)}/messages`, {
            credentials: 'include',
          }),
        ]);
        if (cancelled) return;
        if (!chatRes.ok) throw new Error(`Failed (${chatRes.status})`);
        const chatData = (await chatRes.json()) as { item: { id: string; name: string } };
        setChatName(chatData.item.name);
        if (msgRes.ok) {
          const msgData = (await msgRes.json()) as { items: PersistedChatMessage[] };
          setMessages(hydratePersisted(msgData.items));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chat');
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatsApiBase, chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function startNewChat() {
    if (!matterId || !reviewId || creatingNewChat) return;
    setCreatingNewChat(true);
    try {
      const chat = await reviewChats.create();
      navigate(
        `/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}/chats/${encodeURIComponent(chat.id)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new chat');
    } finally {
      setCreatingNewChat(false);
    }
  }

  function handleCitationJump(citation: Citation) {
    if (!matterId) return;
    const att = reviewDocs.find((d) => d.externalDocId === citation.doc);
    if (!att) {
      setError(`No review document found for citation handle "${citation.doc}"`);
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

  async function sendMessage(textArg: string) {
    const text = textArg.trim();
    if (!text || !matterId || !reviewId || !chatId) return;

    const userMsg: UiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const historyForServer = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [
      ...current,
      userMsg,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    const sentWorkflowId = pendingWorkflowId;
    setPendingWorkflowId(null);
    setPendingWorkflowLabel(null);
    setStatus('sending');
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const modelPayload = selectedModelPayload(selectedModel);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          chatId,
          sessionId: chatId,
          message: text,
          history: historyForServer,
          attachmentIds: [],
          ...modelPayload,
          workflowId: sentWorkflowId ?? undefined,
        }),
        signal: ac.signal,
      });
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamFinished = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          const line = event.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6)) as
            | { type: 'chunk'; text: string }
            | { type: 'tool_call'; id: string; name: string; args: unknown }
            | { type: 'tool_result'; id: string; name: string; result: unknown }
            | { type: 'tool_error'; id: string; name: string; error: string }
            | { type: 'done' }
            | { type: 'error'; message: string };

          if (payload.type === 'chunk') {
            setMessages((cur) =>
              cur.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + payload.text } : m,
              ),
            );
          } else if (payload.type === 'tool_call') {
            setMessages((cur) =>
              cur.map((m) => {
                if (m.id !== assistantId) return m;
                const events = m.toolEvents ?? [];
                return {
                  ...m,
                  toolEvents: [
                    ...events,
                    {
                      id: payload.id,
                      name: payload.name,
                      args: payload.args,
                      status: 'running' as const,
                    },
                  ],
                };
              }),
            );
          } else if (payload.type === 'tool_result') {
            setMessages((cur) =>
              cur.map((m) => {
                if (m.id !== assistantId) return m;
                const events = (m.toolEvents ?? []).map((e) =>
                  e.id === payload.id
                    ? { ...e, result: payload.result, status: 'done' as const }
                    : e,
                );
                return { ...m, toolEvents: events };
              }),
            );
          } else if (payload.type === 'tool_error') {
            setMessages((cur) =>
              cur.map((m) => {
                if (m.id !== assistantId) return m;
                const events = (m.toolEvents ?? []).map((e) =>
                  e.id === payload.id
                    ? { ...e, error: payload.error, status: 'error' as const }
                    : e,
                );
                return { ...m, toolEvents: events };
              }),
            );
          } else if (payload.type === 'error') {
            setError(payload.message);
          } else if (payload.type === 'done') {
            setMessages((cur) =>
              cur.map((m) => {
                if (m.id !== assistantId || m.content.length === 0) return m;
                const { text, citations } = parseResponse(m.content);
                return { ...m, parsed: { text, citations } };
              }),
            );
            setStatus('idle');
            streamFinished = true;
          }
        }
        if (streamFinished) {
          reader.cancel().catch(() => undefined);
          break;
        }
      }

      // Pick up any auto-titled name set on the server.
      if (chatsApiBase) {
        try {
          const r = await fetch(`${chatsApiBase}/${encodeURIComponent(chatId)}`, {
            credentials: 'include',
          });
          if (r.ok) {
            const d = (await r.json()) as { item: { name: string } };
            setChatName(d.item.name);
          }
        } catch {
          // best-effort; ignore
        }
      }
    } catch (err) {
      // User-initiated stop: signal aborted via stopStreaming(). The partial
      // assistant text is already in `messages`, so just bail without
      // surfacing an error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        // intentional no-op
      } else {
        setError(err instanceof Error ? err.message : 'Chat failed');
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setStatus('idle');
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  const isStreaming = status === 'sending';
  const { handleKeyDown, handleSubmit, handleStop, canSend } = useChatComposer({
    isStreaming,
    onSend: (text) => {
      void sendMessage(text);
    },
    onStop: stopStreaming,
    text: input,
    setText: setInput,
  });

  if (!matterId || !reviewId || !chatId) {
    return (
      <>
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Chat</PageHeaderTitle>
          </PageHeaderContent>
        </PageHeader>
        <AppShellContent className="px-6 pt-6 pb-12">
          <p className="text-sm text-destructive">Missing matter, review, or chat id.</p>
        </AppShellContent>
      </>
    );
  }

  const reviewBackPath = `/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}`;

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <Link
            to={reviewBackPath}
            className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← {reviewName}
          </Link>
          <PageHeaderTitle>{chatName ?? 'Chat'}</PageHeaderTitle>
          <PageHeaderDescription>
            Scoped to <span className="font-medium">{reviewName}</span> — only the review's {reviewDocs.length} document
            {reviewDocs.length === 1 ? '' : 's'} are in context.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <PendingButton
            variant="outline"
            size="sm"
            onClick={() => void startNewChat()}
            disabled={status === 'sending'}
            pending={creatingNewChat}
            pendingLabel="Starting"
          >
            <Plus className="size-4" aria-hidden />
            New chat
          </PendingButton>
        </PageHeaderActions>
      </PageHeader>
      <AppShellContent className="flex flex-col px-0 pt-0 pb-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
          {!historyLoaded ? (
            <LoadingState>Loading chat…</LoadingState>
          ) : messages.length === 0 ? (
            <div className="mx-auto max-w-2xl text-center text-sm text-muted-foreground">
              <p>
                Ask follow-up questions across this review's {reviewDocs.length} document
                {reviewDocs.length === 1 ? '' : 's'}. Answers cite the doc and clause they came from.
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-6">
              {messages.map((m, idx) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  agentName="Counsel"
                  isActive={isStreaming && idx === messages.length - 1}
                  onJump={handleCitationJump}
                  docLabels={docLabels}
                  chatId={chatId ?? ''}
                />
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
        <div className="border-t border-border bg-background px-5 py-4">
          <div className="mx-auto w-full max-w-3xl">
            {pendingWorkflowLabel && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                <span>Workflow:</span>
                <span className="font-medium text-foreground">{pendingWorkflowLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    setInput('');
                    setPendingWorkflowId(null);
                    setPendingWorkflowLabel(null);
                  }}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear workflow"
                >
                  ×
                </button>
              </div>
            )}
            <div
              className={cn(
                'rounded-2xl border border-border bg-card shadow-sm transition-all',
                'focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-foreground/30',
              )}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask about ${reviewName}`}
                className="block w-full min-h-16 resize-none border-0 bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setWorkflowPickerOpen(true)}
                    disabled={isStreaming}
                    className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                    aria-label="Run a workflow"
                  >
                    <Sparkles className="size-4" aria-hidden />
                    <span className="text-xs">Workflow</span>
                  </Button>
                  <p className="hidden text-xs text-muted-foreground sm:inline">
                    Enter sends · Shift+Enter newline
                  </p>
                </div>
                {isStreaming ? (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={handleStop}
                    className="h-8 rounded-full px-4"
                    aria-label="Stop streaming"
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleSubmit()}
                    disabled={!canSend}
                    className="h-8 rounded-full px-4"
                  >
                    <Send className="size-4" aria-hidden />
                    Send
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppShellContent>
      <WorkflowPickerDialog
        open={workflowPickerOpen}
        onOpenChange={setWorkflowPickerOpen}
        onSelect={(workflow) => {
          setInput(workflow.prompt);
          setPendingWorkflowId(workflow.id);
          setPendingWorkflowLabel(workflow.name);
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        }}
      />
    </>
  );
}
