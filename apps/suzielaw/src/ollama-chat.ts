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

  const response = await fetchImpl(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(agent.extraBody ?? {}),
      model: agent.model,
      messages: toOllamaMessages(messages, systemPrompt),
      stream: true,
    }),
    signal: signal ?? AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama returned ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.body) throw new Error('Ollama returned no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        if (content) yield { type: 'chunk', text: content };

        if (chunk.done) {
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
        if (content) yield { type: 'chunk', text: content };
      } catch {
        // Ignore a partial trailing JSON fragment.
      }
    }

    yield { type: 'done' };
  } finally {
    reader.releaseLock();
  }
}
