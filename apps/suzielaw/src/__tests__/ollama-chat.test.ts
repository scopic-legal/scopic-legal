import { describe, expect, it, vi } from 'vitest';
import { runOllamaChatOnlyTurn } from '../ollama-chat.js';

function streamLines(lines: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    },
  });
}

describe('native Ollama chat-only stream', () => {
  it('streams thinking separately from assistant content', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        streamLines([
          { message: { thinking: 'Checking the contract.' }, done: false },
          { message: { content: 'The SAFE is an investment instrument.' }, done: false },
          { done: true },
        ]),
        { status: 200 },
      ),
    );

    const events = [];
    for await (const event of runOllamaChatOnlyTurn({
      agent: { baseUrl: 'http://localhost:11434/v1', model: 'gemma3:12b' },
      messages: [{ role: 'user', content: 'Summarize this SAFE.' }],
      systemPrompt: 'You are Counsel.',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })) {
      events.push(event);
    }

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'gemma3:12b',
      stream: true,
      messages: [
        { role: 'system', content: 'You are Counsel.' },
        { role: 'user', content: 'Summarize this SAFE.' },
      ],
    });
    expect(events).toEqual([
      { type: 'reasoning', text: 'Checking the contract.' },
      { type: 'chunk', text: 'The SAFE is an investment instrument.' },
      { type: 'done' },
    ]);
  });
});
