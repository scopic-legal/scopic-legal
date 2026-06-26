import type { DatabaseInstance } from '@teamsuzie/db-sqlite';
import type { KbSearchHit, KnowledgeBaseStore } from '@teamsuzie/kb';
import type { FileRecord } from './files.js';
import { convertFileToMarkdown } from './document-tools.js';
import type { OpenAiPdfFallbackOptions } from './document-conversion.js';

export type { KbSearchHit } from '@teamsuzie/kb';

export interface WorkspaceRagOptions {
  db: DatabaseInstance;
  kb: KnowledgeBaseStore;
  markitdownBaseUrl: string;
  openAiPdfFallback?: OpenAiPdfFallbackOptions;
}

export class WorkspaceRag {
  private readonly db: DatabaseInstance;
  private readonly kb: KnowledgeBaseStore;
  private readonly markitdownBaseUrl: string;
  private readonly openAiPdfFallback?: OpenAiPdfFallbackOptions;

  constructor(opts: WorkspaceRagOptions) {
    this.db = opts.db;
    this.kb = opts.kb;
    this.markitdownBaseUrl = opts.markitdownBaseUrl;
    this.openAiPdfFallback = opts.openAiPdfFallback;
  }

  async indexFile(
    workspaceId: string,
    record: FileRecord,
  ): Promise<{ ok: true; kbDocId: string; chunkCount: number } | { ok: false; reason: string }> {
    const markdown = await convertFileToMarkdown(record, {
      markitdownBaseUrl: this.markitdownBaseUrl,
      openAiPdfFallback: this.openAiPdfFallback,
    });
    if (!markdown.trim()) {
      return { ok: false, reason: 'converted markdown was empty' };
    }

    this.removeFile(workspaceId, record.id);
    const doc = await this.kb.insert({
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      markdown,
      ownerId: ownerIdFor(workspaceId),
    });
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workspace_doc_index (workspace_id, file_id, kb_doc_id, indexed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(workspaceId, record.id, doc.id, Date.now());
    return { ok: true, kbDocId: doc.id, chunkCount: doc.chunkCount };
  }

  hasIndex(workspaceId: string, fileId: string): boolean {
    const row = this.db
      .prepare<[string, string], { kb_doc_id: string }>(
        `SELECT kb_doc_id FROM workspace_doc_index WHERE workspace_id = ? AND file_id = ?`,
      )
      .get(workspaceId, fileId);
    return !!row?.kb_doc_id;
  }

  async searchInDoc(
    workspaceId: string,
    fileId: string,
    query: string,
    topK: number,
  ): Promise<KbSearchHit[]> {
    const row = this.db
      .prepare<[string, string], { kb_doc_id: string }>(
        `SELECT kb_doc_id FROM workspace_doc_index WHERE workspace_id = ? AND file_id = ?`,
      )
      .get(workspaceId, fileId);
    if (!row) return [];
    return this.kb.searchHybrid(query, {
      topK,
      ownerId: ownerIdFor(workspaceId),
      documentIds: [row.kb_doc_id],
    });
  }

  removeFile(workspaceId: string, fileId: string): void {
    const row = this.db
      .prepare<[string, string], { kb_doc_id: string }>(
        `SELECT kb_doc_id FROM workspace_doc_index WHERE workspace_id = ? AND file_id = ?`,
      )
      .get(workspaceId, fileId);
    this.db
      .prepare(`DELETE FROM workspace_doc_index WHERE workspace_id = ? AND file_id = ?`)
      .run(workspaceId, fileId);
    if (row?.kb_doc_id) this.kb.delete(row.kb_doc_id);
  }

  removeWorkspace(workspaceId: string): void {
    const rows = this.db
      .prepare<[string], { kb_doc_id: string }>(
        `SELECT kb_doc_id FROM workspace_doc_index WHERE workspace_id = ?`,
      )
      .all(workspaceId);
    this.db.prepare(`DELETE FROM workspace_doc_index WHERE workspace_id = ?`).run(workspaceId);
    for (const row of rows) this.kb.delete(row.kb_doc_id);
  }
}

export async function rewriteQueryAsHypothetical(
  prompt: string,
  format: string,
  opts: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    extraBody?: Record<string, unknown>;
    fetchImpl?: typeof fetch;
  },
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const response = await fetchImpl(`${opts.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        {
          role: 'system',
          content:
            'Rewrite a review-column instruction as one short hypothetical answer sentence for retrieval. Return only the sentence.',
        },
        {
          role: 'user',
          content: `Column format: ${format}\nInstruction: ${prompt}`,
        },
      ],
      temperature: 0,
      max_tokens: 80,
      ...(opts.extraBody ?? {}),
    }),
  });
  if (!response.ok) throw new Error(`HyDE rewrite failed (${response.status})`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || prompt;
}

function ownerIdFor(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}
