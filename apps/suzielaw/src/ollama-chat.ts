import type { AgentTarget, ChatMessage } from '@teamsuzie/agent-loop';
import { OLLAMA_DEFAULT_BASE_URL, normalizeOpenAICompatibleBaseUrl } from './ollama-models.js';

export type OllamaChatOnlyEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'chunk'; text: string }
  | { type: 'done' };

interface RunOllamaChatOnlyOptions {
  agent: AgentTarget;
  messages: ChatMessage[];
  systemPrompt?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface OllamaChatChunk {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    reasoning?: string;
    reasoning_content?: string;
  };
  thinking?: string;
  reasoning?: string;
  reasoning_content?: string;
  response?: string;
  done?: boolean;
}

interface ThinkTagState {
  inThinking: boolean;
  buffer: string;
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

function toOllamaMessages(messages: ChatMessage[], systemPrompt?: string): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (systemPrompt?.trim()) out.push({ role: 'system', content: systemPrompt });
  for (const message of messages) {
    if (message.role === 'tool' || message.content == null) continue;
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') continue;
    out.push({ role: message.role, content: message.content });
  }
  return out;
}

function chunkReasoning(chunk: OllamaChatChunk): string {
  return (
    chunk.message?.thinking ??
    chunk.message?.reasoning ??
    chunk.message?.reasoning_content ??
    chunk.thinking ??
    chunk.reasoning ??
    chunk.reasoning_content ??
    ''
  );
}

function chunkContent(chunk: OllamaChatChunk): string {
  return chunk.message?.content ?? chunk.response ?? '';
}

function shouldRequestThinking(model: string, extraBody: Record<string, unknown> | undefined): boolean {
  if (extraBody && Object.prototype.hasOwnProperty.call(extraBody, 'think')) return false;
  return /(^|[:/ -])(?:gemma\d*|qwen|deepseek-r1|gpt-oss)(?=$|[:/ -])/i.test(model);
}

function bodyForRequest(agent: AgentTarget, messages: ChatMessage[], systemPrompt: string | undefined, think: boolean) {
  return {
    ...(agent.extraBody ?? {}),
    ...(think ? { think: true } : {}),
    model: agent.model,
    messages: toOllamaMessages(messages, systemPrompt),
    stream: true,
  };
}

function partialTagSuffixLength(text: string, tag: string): number {
  const lower = text.toLowerCase();
  const lowerTag = tag.toLowerCase();
  const max = Math.min(lower.length, lowerTag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (lower.endsWith(lowerTag.slice(0, length))) return length;
  }
  return 0;
}

function splitThinkTaggedContent(
  state: ThinkTagState,
  text: string,
  flush = false,
): Array<{ type: 'reasoning' | 'chunk'; text: string }> {
  const events: Array<{ type: 'reasoning' | 'chunk'; text: string }> = [];
  state.buffer += text;

  while (state.buffer) {
    const tag = state.inThinking ? THINK_CLOSE : THINK_OPEN;
    const index = state.buffer.toLowerCase().indexOf(tag);
    if (index >= 0) {
      const before = state.buffer.slice(0, index);
      if (before) {
        events.push({ type: state.inThinking ? 'reasoning' : 'chunk', text: before });
      }
      state.buffer = state.buffer.slice(index + tag.length);
      state.inThinking = !state.inThinking;
      continue;
    }

    const keep = flush ? 0 : partialTagSuffixLength(state.buffer, tag);
    const emit = state.buffer.slice(0, state.buffer.length - keep);
    if (emit) {
      events.push({ type: state.inThinking ? 'reasoning' : 'chunk', text: emit });
    }
    state.buffer = state.buffer.slice(state.buffer.length - keep);
    break;
  }

  return events;
}

async function postOllamaChat(
  baseUrl: string,
  headers: Record<string, string>,
  agent: AgentTarget,
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  think: boolean,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return fetchImpl(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyForRequest(agent, messages, systemPrompt, think)),
    signal: signal ?? AbortSignal.timeout(180_000),
  });
}

export async function* runOllamaChatOnlyTurn({
  agent,
  messages,
  systemPrompt,
  fetchImpl = fetch,
  signal,
}: RunOllamaChatOnlyOptions): AsyncGenerator<OllamaChatOnlyEvent, void, unknown> {
  const baseUrl = normalizeOpenAICompatibleBaseUrl(agent.baseUrl) ?? OLLAMA_DEFAULT_BASE_URL;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent.apiKey) headers.Authorization = `Bearer ${agent.apiKey}`;
  const requestThinking = shouldRequestThinking(agent.model, agent.extraBody);

  let response = await postOllamaChat(
    baseUrl,
    headers,
    agent,
    messages,
    systemPrompt,
    requestThinking,
    fetchImpl,
    signal,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (requestThinking && /think|thinking/i.test(text)) {
      response = await postOllamaChat(baseUrl, headers, agent, messages, systemPrompt, false, fetchImpl, signal);
    }
    if (!response.ok) {
      const retryText = response === undefined ? text : await response.text().catch(() => text);
      throw new Error(`Ollama returned ${response.status}: ${retryText.slice(0, 200)}`);
    }
  }
  if (!response.body) throw new Error('Ollama returned no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const thinkTags: ThinkTagState = { inThinking: false, buffer: '' };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const data = line.trim();
        if (!data) continue;
        let chunk: OllamaChatChunk;
        try {
          chunk = JSON.parse(data) as OllamaChatChunk;
        } catch {
          continue;
        }

        const reasoning = chunkReasoning(chunk);
        if (reasoning) yield { type: 'reasoning', text: reasoning };

        const content = chunkContent(chunk);
        if (content) {
          for (const event of splitThinkTaggedContent(thinkTags, content)) {
            yield event;
          }
        }

        if (chunk.done) {
          for (const event of splitThinkTaggedContent(thinkTags, '', true)) {
            yield event;
          }
          yield { type: 'done' };
          return;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
        const reasoning = chunkReasoning(chunk);
        if (reasoning) yield { type: 'reasoning', text: reasoning };
        const content = chunkContent(chunk);
        if (content) {
          for (const event of splitThinkTaggedContent(thinkTags, content)) {
            yield event;
          }
        }
      } catch {
        // Ignore a partial trailing JSON fragment.
      }
    }

    for (const event of splitThinkTaggedContent(thinkTags, '', true)) {
      yield event;
    }
    yield { type: 'done' };
  } finally {
    reader.releaseLock();
  }
}
