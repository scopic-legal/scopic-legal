import {
  prepareDocumentForPrompt,
  type PreparedDocument,
} from '@teamsuzie/citations';
import {
  runCellWithFormat,
  type LlmStream,
  type RunCellAdapter,
} from '@teamsuzie/grid-review';
import type { Request } from 'express';
import {
  rewriteQueryAsHypothetical,
  type KbSearchHit,
  type WorkspaceRag,
} from './rag.js';

import type { CellChatMessage } from '@teamsuzie/grid-review';
import type { InMemoryFileStore } from './files.js';
import { convertFileToMarkdown } from './document-tools.js';
import { createTokenMeteredFetch, type TokenBudgetStore } from '@teamsuzie/hosted-demo';
import { getSessionUser } from './auth.js';

export interface BuildReviewRunAdapterOptions {
  fileStore: InMemoryFileStore;
  rag: WorkspaceRag;
  markitdownBaseUrl: string;
  agentBaseUrl: string;
  agentApiKey: string | undefined;
  /** Heavy model used for the cell answer (the streaming completion). */
  model: string;
  /**
   * Lighter model used for HyDE — we just need a one-sentence
   * hypothetical answer to embed, so the cheap model is fine.
   */
  hydeModel: string;
  /**
   * Provider-specific request body knobs merged into both the HyDE
   * rewrite call and the cell-completion call. On Dashscope this carries
   * `{"enable_thinking": false}` — without it Qwen3 spends its full
   * thinking budget on what should be sub-second calls.
   */
  extraBody?: Record<string, unknown>;
  /** Top-K chunks retrieved per cell run. Defaults to 6. */
  topK?: number;
  tokenBudget?: TokenBudgetStore;
  fallbackTokensPerCall?: number;
}

/**
 * Adapter wired into `createReviewsRouter`. RAG-driven: for each cell run
 * we embed the column's prompt and pull the top-K most relevant chunks
 * for that row's document. The retrieved chunks become the model's
 * context, not the full doc.
 *
 * Falls back to the legacy "convert whole doc to markdown" path when the
 * doc isn't yet indexed (e.g. uploaded before RAG was wired in).
 */
export function buildReviewRunAdapter(
  opts: BuildReviewRunAdapterOptions,
): RunCellAdapter {
  const topK = opts.topK ?? 6;

  return async function* runReviewCell({ request, workspaceId, document, column, signal }) {
    const ownerEmail = request ? getSessionUser(request as Request)?.email : null;
    const meteredFetch =
      opts.tokenBudget && ownerEmail
        ? createTokenMeteredFetch({
            budget: opts.tokenBudget,
            ownerEmail,
            source: 'review-cell',
            model: opts.model,
            enabled: true,
            fallbackTokens: opts.fallbackTokensPerCall ?? 0,
          })
        : fetch;
    const llm = makeStreamCompletion({
      baseUrl: opts.agentBaseUrl,
      apiKey: opts.agentApiKey,
      model: opts.model,
      extraBody: opts.extraBody,
      fetchImpl: meteredFetch,
    });
    const hydeFetch =
      opts.tokenBudget && ownerEmail
        ? createTokenMeteredFetch({
            budget: opts.tokenBudget,
            ownerEmail,
            source: 'review-hyde',
            model: opts.hydeModel,
            enabled: true,
            fallbackTokens: opts.fallbackTokensPerCall ?? 0,
          })
        : fetch;
    // Resolve the document context. Two paths: RAG (preferred — indexed
    // chunks for the prompt) and full-text fallback (slow, used when the
    // doc isn't indexed).
    let prepared: PreparedDocument;
    try {
      if (opts.rag.hasIndex(workspaceId, document.externalDocId)) {
        // HyDE: rewrite the column prompt as a hypothetical answer
        // before embedding. Question embeddings ("what is the
        // governing law?") tend to land in a different region of the
        // semantic space than the source-text answers we're trying to
        // retrieve; a one-sentence fake answer ("This agreement is
        // governed by the laws of [State].") embeds much closer to
        // the real passage. If the rewrite call fails, fall back to
        // the raw prompt — cell run continues either way.
        let retrievalQuery = column.prompt;
        try {
          retrievalQuery = await rewriteQueryAsHypothetical(
            column.prompt,
            column.format,
            {
              baseUrl: opts.agentBaseUrl,
              apiKey: opts.agentApiKey,
              model: opts.hydeModel,
              extraBody: opts.extraBody,
              fetchImpl: hydeFetch,
            },
          );
        } catch (err) {
          console.warn(
            '[reviews] HyDE rewrite failed, falling back to raw prompt:',
            err instanceof Error ? err.message : err,
          );
        }

        const hits = await opts.rag.searchInDoc(
          workspaceId,
          document.externalDocId,
          retrievalQuery,
          topK,
        );
        if (hits.length === 0) {
          yield {
            type: 'retrieved',
            summary: `No relevant passages retrieved from ${document.name}`,
            chunkCount: 0,
            chunks: [],
            retrievalQuery,
          };
          prepared = synthesizePrepared(document.externalDocId, []);
        } else {
          yield {
            type: 'retrieved',
            summary: `Retrieved ${hits.length} passage${hits.length === 1 ? '' : 's'} from ${document.name}`,
            chunkCount: hits.length,
            chunks: hits.map((h) => ({
              content: h.chunk.content,
              distance: h.distance,
            })),
            retrievalQuery,
          };
          prepared = synthesizePrepared(document.externalDocId, hits);
        }
      } else {
        // Legacy full-doc fallback.
        const record = opts.fileStore.get(workspaceId, document.externalDocId);
        if (!record) {
          yield {
            type: 'error',
            error: new Error(
              `document not found in matter (file_id ${document.externalDocId})`,
            ),
          };
          return;
        }
        yield {
          type: 'retrieved',
          summary: `Indexing not ready — using full document ${document.name}`,
        };
        const markdown = await convertFileToMarkdown(record, {
          markitdownBaseUrl: opts.markitdownBaseUrl,
        });
        prepared = prepareDocumentForPrompt(markdown, [], {
          handle: document.externalDocId,
        });
      }
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
      return;
    }

    for await (const event of runCellWithFormat({
      document: prepared,
      documentLabel: document.name,
      column: { prompt: column.prompt },
      format: column.format,
      llm,
      signal,
    })) {
      if (event.type === 'token') {
        yield { type: 'token', text: event.text };
      } else if (event.type === 'retry') {
        // Surface retry as a small token-level note so the streaming view
        // doesn't go silent, then keep going.
        yield { type: 'token', text: `\n\n[retrying — ${event.reason}]\n\n` };
      } else if (event.type === 'done') {
        const finalText = event.formatted ?? event.text;
        yield {
          type: 'done',
          text: finalText,
          citations: event.citations,
          warnings: event.warnings,
        };
      } else if (event.type === 'error') {
        yield event;
      }
    }
  };
}

/**
 * Build a `PreparedDocument` whose `marked` content is the retrieved
 * chunks, each labeled "[Excerpt N]" so the model treats them as a
 * partial view of the source. We bypass `prepareDocumentForPrompt`'s page
 * markers because retrieved chunks aren't pages.
 */
function synthesizePrepared(handle: string, hits: KbSearchHit[]): PreparedDocument {
  if (hits.length === 0) {
    const empty =
      'No relevant passages were retrieved from this document for the question.\n' +
      'If the answer requires content not shown here, say so plainly.';
    return { handle, marked: empty, text: empty, pageBreaks: [] };
  }
  const sections: string[] = [
    'The following passages were retrieved from the source document as most relevant to the question. They are excerpts, not the full document — quote verbatim from these passages only.',
    '',
  ];
  for (let i = 0; i < hits.length; i++) {
    sections.push(`[Excerpt ${i + 1}]`);
    sections.push(hits[i]!.chunk.content.trim());
    sections.push('');
  }
  const marked = sections.join('\n');
  return { handle, marked, text: marked, pageBreaks: [] };
}

interface StreamCompletionOptions {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  /** Merged into the request body — used for Qwen's enable_thinking flag etc. */
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

/**
 * Minimal OpenAI-compatible streaming chat-completion call. Skips
 * agent-loop's tool machinery — cell runs are plain completions.
 */
function makeStreamCompletion(opts: StreamCompletionOptions): LlmStream {
  return async function* ({ messages, signal }) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    const response = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: messages as CellChatMessage[],
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.extraBody ?? {}),
      }),
      signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `chat completions returned ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const line = event
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as OpenAiChunk;
          const text = chunk.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text.length > 0) {
            yield text;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  };
}
