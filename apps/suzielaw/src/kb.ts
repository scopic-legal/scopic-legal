import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { KnowledgeBaseStore, createOpenAIEmbedder } from '@teamsuzie/kb';
import { convertToMarkdown } from '@teamsuzie/document-conversion';
import { db } from './db.js';
import { config } from './config.js';
import { getSessionUser } from './auth.js';

/**
 * Boot a KnowledgeBaseStore using the app's existing SQLite db + the
 * configured OpenAI-compatible embeddings endpoint. Returns null when KB is
 * disabled in config — callers should treat null as "no KB available".
 */
export function buildKbStore(): KnowledgeBaseStore {
  const embedder = createOpenAIEmbedder({
    baseUrl: config.kb.embeddingBaseUrl,
    apiKey: config.kb.embeddingApiKey,
    model: config.kb.embeddingModel,
    dim: config.kb.embeddingDim,
  });
  return new KnowledgeBaseStore({
    db,
    embedder,
    // Tighter chunks than the upstream default (3200/4800). Matter docs
    // are typically heading-organized contracts; smaller chunks mean
    // top-K retrieval actually focuses the model's context instead of
    // returning most of the doc. ~250 tokens per chunk, 800 token max.
    chunker: { targetSize: 1000, overlap: 150, maxSize: 1600 },
  });
}

const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|yaml|x-markdown|markdown))/i;

interface IngestOptions {
  store: KnowledgeBaseStore;
  /** markitdown-agent base URL for non-DOCX/non-text binaries. Empty = those
   *  uploads will be rejected. */
  markitdownBaseUrl: string;
}

/**
 * Convert a binary upload to markdown using whichever path fits the mime
 * type, then insert into the KB. Text-like uploads pass through as-is;
 * everything else routes via `@teamsuzie/document-conversion` (DOCX uses
 * mammoth in-process, anything else goes to markitdown-agent).
 */
async function ingestFile(opts: IngestOptions, file: Express.Multer.File, ownerId?: string): Promise<{ id: string; chunkCount: number }> {
  let markdown: string;

  if (TEXT_MIME.test(file.mimetype)) {
    markdown = file.buffer.toString('utf-8');
  } else {
    const isDocx =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.originalname.toLowerCase().endsWith('.docx');
    if (!opts.markitdownBaseUrl && !isDocx) {
      throw new Error(`Unsupported file type: ${file.mimetype}. Configure SUZIELAW_MARKITDOWN_AGENT_BASE_URL to ingest non-DOCX binaries.`);
    }
    const result = await convertToMarkdown(file.buffer, {
      mime: file.mimetype,
      filename: file.originalname,
      markitdownAgentBaseUrl: opts.markitdownBaseUrl,
    });
    markdown = result.markdown;
  }

  if (!markdown.trim()) throw new Error('Uploaded file converted to empty markdown — nothing to index.');

  const inserted = await opts.store.insert({
    name: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    markdown,
    ...(ownerId ? { ownerId } : {}),
  });
  return { id: inserted.id, chunkCount: inserted.chunkCount };
}

export interface CreateKbRouterOptions {
  store: KnowledgeBaseStore;
  markitdownBaseUrl: string;
  maxUploadBytes: number;
}

export function createKbRouter(opts: CreateKbRouterOptions): Router {
  const router: Router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxUploadBytes },
  });

  router.get('/documents', (req, res) => {
    const ownerId = getSessionUser(req)?.email;
    const docs = opts.store.list(ownerId ?? null);
    const stats = opts.store.count(ownerId ?? null);
    res.json({ documents: docs, stats });
  });

  router.post('/documents', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }
    try {
      const ownerId = getSessionUser(req)?.email;
      const result = await ingestFile(
        { store: opts.store, markitdownBaseUrl: opts.markitdownBaseUrl },
        req.file,
        ownerId,
      );
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'ingest_failed' });
    }
  });

  router.delete('/documents/:id', (req, res) => {
    const ok = opts.store.delete(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/search', async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      res.status(400).json({ error: 'query_required' });
      return;
    }
    const topK = Math.min(20, Math.max(1, parseInt(String(req.body?.top_k ?? 5), 10) || 5));
    try {
      const ownerId = getSessionUser(req)?.email ?? null;
      const hits = await opts.store.search(query, { topK, ownerId });
      res.json({ query, hits });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'search_failed' });
    }
  });

  return router;
}
