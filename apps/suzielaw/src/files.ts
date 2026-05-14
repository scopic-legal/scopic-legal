import { citationProtocolFragment } from '@teamsuzie/citations';
import type { WorkspacesStore } from '@teamsuzie/workspaces';
import type { WorkspaceRag } from '@teamsuzie/kb';
import { Router, json as expressJson, type Request, type Response } from 'express';
import multer from 'multer';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** Per-bucket file record. Memory-cached, optionally disk-backed. */
export interface FileRecord {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  bytes: Buffer;
  createdAt: number;
}

/** Public-safe view of a file (no bytes). */
export interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface FileMetaSidecar {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

/**
 * Memory-cached file store with optional disk persistence so matter docs
 * survive `tsx watch` reloads. Writes bytes to `<dataDir>/<bucket>/<id>.bin`
 * and metadata to `<id>.meta.json`. Loads everything on construction.
 *
 * `sessionId` is the bucket key — for chat session uploads it's the chat
 * session id; for matter docs it's the matter id. The store doesn't care.
 *
 * Pass `dataDir: null` to opt out of persistence (e.g. for tests).
 */
export interface InMemoryFileStoreOptions {
  /** Directory to persist file bytes + metadata. `null` disables disk I/O. */
  dataDir?: string | null;
}

export class InMemoryFileStore {
  private bySession: Map<string, Map<string, FileRecord>> = new Map();
  private readonly dataDir: string | null;

  constructor(opts: InMemoryFileStoreOptions = {}) {
    this.dataDir = opts.dataDir === undefined ? './data/files' : opts.dataDir;
    if (this.dataDir) this.loadFromDisk(this.dataDir);
  }

  put(record: FileRecord): void {
    let sess = this.bySession.get(record.sessionId);
    if (!sess) {
      sess = new Map();
      this.bySession.set(record.sessionId, sess);
    }
    sess.set(record.id, record);
    if (this.dataDir) this.writeToDisk(this.dataDir, record);
  }

  get(sessionId: string, fileId: string): FileRecord | undefined {
    return this.bySession.get(sessionId)?.get(fileId);
  }

  getMany(sessionId: string, fileIds: string[]): FileRecord[] {
    const sess = this.bySession.get(sessionId);
    if (!sess) return [];
    const out: FileRecord[] = [];
    for (const id of fileIds) {
      const rec = sess.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  copyMany(fromSessionId: string, toSessionId: string, fileIds: string[]): FileMetadata[] {
    const copied: FileMetadata[] = [];
    for (const rec of this.getMany(fromSessionId, fileIds)) {
      const next: FileRecord = {
        ...rec,
        sessionId: toSessionId,
        bytes: Buffer.from(rec.bytes),
      };
      this.put(next);
      copied.push({
        id: next.id,
        name: next.name,
        mimeType: next.mimeType,
        size: next.size,
      });
    }
    return copied;
  }

  delete(sessionId: string, fileId: string): boolean {
    const removed = this.bySession.get(sessionId)?.delete(fileId) ?? false;
    if (removed && this.dataDir) {
      this.removeFromDisk(this.dataDir, sessionId, fileId);
    }
    return removed;
  }

  clearSession(sessionId: string): void {
    this.bySession.delete(sessionId);
    if (this.dataDir) this.removeBucketFromDisk(this.dataDir, sessionId);
  }

  /**
   * Drop every bucket — used by the admin "reset everything" path. Returns
   * the number of file records that were in memory at the time of the call.
   */
  clearAll(): number {
    let count = 0;
    for (const sess of this.bySession.values()) count += sess.size;
    this.bySession.clear();
    if (this.dataDir && existsSync(this.dataDir)) {
      rmSync(this.dataDir, { recursive: true, force: true });
    }
    return count;
  }

  // --- disk persistence ------------------------------------------------

  private loadFromDisk(dataDir: string): void {
    if (!existsSync(dataDir)) return;
    let buckets: string[];
    try {
      buckets = readdirSync(dataDir);
    } catch {
      return;
    }
    for (const bucketDir of buckets) {
      const bucketPath = path.join(dataDir, bucketDir);
      const sessionId = decodeURIComponent(bucketDir);
      let entries: string[];
      try {
        entries = readdirSync(bucketPath);
      } catch {
        continue;
      }
      const sess = new Map<string, FileRecord>();
      for (const entry of entries) {
        if (!entry.endsWith('.meta.json')) continue;
        const metaPath = path.join(bucketPath, entry);
        const dataPath = metaPath.replace(/\.meta\.json$/, '.bin');
        if (!existsSync(dataPath)) continue;
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as FileMetaSidecar;
          const bytes = readFileSync(dataPath);
          sess.set(meta.id, { ...meta, bytes });
        } catch {
          // Skip corrupt sidecars; they'll be overwritten on next put.
        }
      }
      if (sess.size > 0) this.bySession.set(sessionId, sess);
    }
  }

  private writeToDisk(dataDir: string, record: FileRecord): void {
    const bucketPath = path.join(dataDir, encodeURIComponent(record.sessionId));
    mkdirSync(bucketPath, { recursive: true });
    const safeId = encodeURIComponent(record.id);
    writeFileSync(path.join(bucketPath, `${safeId}.bin`), record.bytes);
    const meta: FileMetaSidecar = {
      id: record.id,
      sessionId: record.sessionId,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt,
    };
    writeFileSync(
      path.join(bucketPath, `${safeId}.meta.json`),
      JSON.stringify(meta),
    );
  }

  private removeFromDisk(dataDir: string, sessionId: string, fileId: string): void {
    const bucketPath = path.join(dataDir, encodeURIComponent(sessionId));
    const safeId = encodeURIComponent(fileId);
    rmSync(path.join(bucketPath, `${safeId}.bin`), { force: true });
    rmSync(path.join(bucketPath, `${safeId}.meta.json`), { force: true });
  }

  private removeBucketFromDisk(dataDir: string, sessionId: string): void {
    const bucketPath = path.join(dataDir, encodeURIComponent(sessionId));
    rmSync(bucketPath, { recursive: true, force: true });
  }
}

function generateId(): string {
  return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  '.csv',
  '.docx',
  '.epub',
  '.htm',
  '.html',
  '.json',
  '.md',
  '.markdown',
  '.pdf',
  '.pptx',
  '.txt',
  '.xlsx',
]);

function validateSupportedUpload(file: Express.Multer.File): string | null {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (SUPPORTED_UPLOAD_EXTENSIONS.has(ext)) return null;
  return `Unsupported file type${ext ? ` "${ext}"` : ''}. Upload PDF, DOCX, PPTX, XLSX, HTML, EPUB, Markdown, text, CSV, or JSON.`;
}

const TEXT_LIKE_MIME_PATTERNS: RegExp[] = [
  /^text\//i,
  /^application\/json\b/i,
  /^application\/(?:x-)?yaml\b/i,
  /^application\/(?:xml|x-xml)\b/i,
  /^application\/(?:javascript|typescript|x-javascript|x-typescript)\b/i,
  /^application\/(?:csv)\b/i,
];

function looksLikeText(mimeType: string): boolean {
  return TEXT_LIKE_MIME_PATTERNS.some((re) => re.test(mimeType));
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Build the attachment context block to prepend to a user message. Text-like
 * files are included verbatim; binaries are surfaced as metadata only so the
 * model knows they exist but doesn't hallucinate contents.
 *
 * Returns an empty string if there are no attachments.
 */
export function buildAttachmentContext(records: FileRecord[]): string {
  if (records.length === 0) return '';
  const lines: string[] = ['[Attachments]'];
  for (const rec of records) {
    if (looksLikeText(rec.mimeType)) {
      const text = rec.bytes.toString('utf-8');
      lines.push(`- file_id: ${rec.id} — ${rec.name} (${rec.mimeType}, ${humanSize(rec.size)}):`);
      lines.push('"""');
      lines.push(text);
      lines.push('"""');
    } else {
      lines.push(
        `- file_id: ${rec.id} — ${rec.name} (${rec.mimeType}, ${humanSize(rec.size)}) — binary. Pass file_id to convert_to_markdown to read it.`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Build the citation protocol fragment for the current turn's attachments.
 * Uses each file's `id` as the doc handle the model should emit; the file
 * name surfaces as the human-readable label in the protocol's handle list.
 *
 * Returns an empty string when there are no attachments — no docs to cite.
 */
export function buildCitationProtocolBlock(records: FileRecord[]): string {
  if (records.length === 0) return '';
  return citationProtocolFragment({
    docs: records.map((rec) => ({ handle: rec.id, label: rec.name })),
  });
}

export interface FileRouterOptions {
  store: InMemoryFileStore;
  maxUploadBytes: number;
}

export function createFilesRouter({ store, maxUploadBytes }: FileRouterOptions): Router {
  const router: Router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
  });

  router.post('/files', upload.single('file'), (req: Request, res: Response) => {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required (form field)' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file is required (multipart field "file")' });
      return;
    }
    const unsupportedReason = validateSupportedUpload(file);
    if (unsupportedReason) {
      res.status(415).json({ error: unsupportedReason });
      return;
    }
    const record: FileRecord = {
      id: generateId(),
      sessionId,
      name: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      bytes: file.buffer,
      createdAt: Date.now(),
    };
    store.put(record);
    const metadata: FileMetadata = {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
    };
    res.status(201).json({ item: metadata });
  });

  router.post('/files/promote', expressJson(), (req: Request, res: Response) => {
    const fromSessionId = String(req.body?.fromSessionId || '').trim();
    const toSessionId = String(req.body?.toSessionId || '').trim();
    const fileIds = Array.isArray(req.body?.fileIds)
      ? (req.body.fileIds as unknown[]).map(String).filter(Boolean)
      : [];
    if (!fromSessionId || !toSessionId) {
      res.status(400).json({ error: 'fromSessionId and toSessionId are required' });
      return;
    }
    if (fileIds.length === 0) {
      res.json({ items: [] });
      return;
    }
    res.json({ items: store.copyMany(fromSessionId, toSessionId, fileIds) });
  });

  router.get('/files/:sessionId/:id', (req, res) => {
    const rec = store.get(req.params.sessionId, req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      item: {
        id: rec.id,
        name: rec.name,
        mimeType: rec.mimeType,
        size: rec.size,
      } satisfies FileMetadata,
    });
  });

  router.get('/files/:sessionId/:id/content', (req, res) => {
    const rec = store.get(req.params.sessionId, req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // PDFs and images render inline in browsers; everything else (DOCX,
    // XLSX, PPTX, ...) does not, so an `inline` disposition causes the
    // SPA to navigate-then-fail when a markdown link in chat is clicked.
    // Default to `attachment`, opt into `inline` for known-renderable
    // types and when an `?inline=1` query param is set (the side-panel
    // previews fetch programmatically so they ignore the header
    // entirely either way).
    const isInlineRenderable =
      rec.mimeType === 'application/pdf' ||
      rec.mimeType.startsWith('image/') ||
      rec.mimeType.startsWith('text/');
    const wantInline = req.query.inline === '1' || isInlineRenderable;
    res.setHeader('Content-Type', rec.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${wantInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(rec.name)}"`,
    );
    res.send(rec.bytes);
  });

  router.delete('/files/:sessionId/:id', (req, res) => {
    const removed = store.delete(req.params.sessionId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}

export interface MatterUploadsRouterOptions {
  fileStore: InMemoryFileStore;
  workspaces: WorkspacesStore;
  maxUploadBytes: number;
  /** Optional: if set, every uploaded matter doc is also indexed into the
   *  KB so cell runs (and later matter chats) can do RAG against it. */
  rag?: WorkspaceRag;
  /** Optional: if set, every uploaded matter doc records a `source: 'upload'`
   *  version in the document-version chain so later proposals can branch
   *  from a known root version. */
  documentVersions?: import('@teamsuzie/document-versions').DocumentVersionsStore;
}

/**
 * Bridges multipart upload → InMemoryFileStore (bucket = matter id) →
 * `workspace_documents` row. The download URL is the existing
 * `/api/files/:bucket/:fileId/content` endpoint, with the matter id as the
 * bucket — so matter docs are served by the same plumbing as chat-session
 * uploads, just under a different bucket key.
 *
 * When `rag` is configured, the file is also chunked + embedded + stored
 * in the KB after the upload completes (synchronously — slow uploads but
 * simpler than the eventual-consistency story).
 */
export function createMatterUploadsRouter({
  fileStore,
  workspaces,
  maxUploadBytes,
  rag,
  documentVersions,
}: MatterUploadsRouterOptions): Router {
  const router: Router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
  });

  router.post(
    '/:matterId/documents/upload',
    upload.single('file'),
    async (req, res) => {
      const matterId = String(req.params.matterId ?? '');
      if (!workspaces.getWorkspace(matterId)) {
        res.status(404).json({ error: 'matter not found' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'file is required (multipart field "file")' });
        return;
      }
      const unsupportedReason = validateSupportedUpload(file);
      if (unsupportedReason) {
        res.status(415).json({ error: unsupportedReason });
        return;
      }
      const folderInput = req.body?.folderId;
      const folderId =
        typeof folderInput === 'string' && folderInput.length > 0
          ? folderInput
          : null;

      const fileId = generateId();
      const record: FileRecord = {
        id: fileId,
        sessionId: matterId,
        name: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        bytes: file.buffer,
        createdAt: Date.now(),
      };
      fileStore.put(record);

      const doc = workspaces.addDocument({
        workspaceId: matterId,
        folderId,
        externalDocId: fileId,
        name: record.name,
        mimeType: record.mimeType,
        size: record.size,
      });

      // Record the upload as the root of this document's version chain.
      // The logical document id is the upload's fileId — every later
      // proposal/accept/reject points back at this via parent_id.
      if (documentVersions) {
        try {
          documentVersions.addVersion({
            externalDocId: fileId,
            source: 'upload',
            storageId: fileId,
            byteSize: record.size,
            notes: record.name,
          });
        } catch (err) {
          console.warn(
            `[document-versions] addVersion(upload) failed for ${record.name}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Index for RAG (best-effort). Logs and continues on failure so the
      // upload UX isn't blocked by an embeddings outage.
      if (rag) {
        const startedAt = Date.now();
        try {
          const result = await rag.indexFile(matterId, record);
          const elapsed = Date.now() - startedAt;
          if (result.ok) {
            console.log(
              `[matter-rag] indexed ${record.name} → ${result.chunkCount} chunk(s) in ${elapsed}ms`,
            );
          } else {
            console.warn(
              `[matter-rag] skipped ${record.name} (${elapsed}ms): ${result.reason}`,
            );
          }
        } catch (err) {
          console.warn(
            `[matter-rag] indexFile failed for ${record.name}:`,
            err instanceof Error ? err.message : err,
          );
        }
      } else {
        console.log(
          `[matter-rag] no rag adapter configured — skipping index for ${record.name}`,
        );
      }

      res.status(201).json({ item: doc });
    },
  );

  return router;
}
