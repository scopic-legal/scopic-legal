import type { FileRecord } from './files.js';
import { convertFileToMarkdown } from './document-tools.js';

export type RedactionMode = 'auto' | 'always' | 'off';
export type RedactionSource = 'presidio' | 'local';

export interface RedactionFinding {
  entityType: string;
  start: number;
  end: number;
  score: number;
  source: RedactionSource;
}

export interface RedactionSummary {
  total: number;
  byType: Record<string, number>;
  bySource: Record<RedactionSource, number>;
}

export interface RedactionAnalysis {
  findings: RedactionFinding[];
  summary: RedactionSummary;
  provider: 'presidio' | 'local' | 'hybrid';
  warning?: string;
}

export interface RedactionResult extends RedactionAnalysis {
  text: string;
}

export interface RedactionServiceOptions {
  analyzerUrl?: string;
  scoreThreshold: number;
  enabledEntities?: string[];
  fetchImpl?: typeof fetch;
}

export interface RedactionScanDocument {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'scanned' | 'error';
  summary: RedactionSummary;
  provider: RedactionAnalysis['provider'];
  warning?: string;
  error?: string;
}

export interface RedactionScanReport {
  generatedAt: number;
  documents: RedactionScanDocument[];
  summary: RedactionSummary;
}

export type RedactTextFn = (text: string) => Promise<RedactionResult>;

interface PresidioRecognizerResult {
  entity_type?: string;
  start?: number;
  end?: number;
  score?: number;
}

const DEFAULT_ENTITY_ALLOWLIST = new Set([
  'PERSON',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'US_SSN',
  'US_DRIVER_LICENSE',
  'PASSPORT',
  'CREDIT_CARD',
  'IBAN_CODE',
  'IP_ADDRESS',
  'LOCATION',
  'DATE_TIME',
  'NRP',
  'MEDICAL_LICENSE',
  'CRYPTO',
  'US_BANK_NUMBER',
  'US_ITIN',
  'US_PASSPORT',
  'US_EIN',
  'UK_NHS',
  'AU_ABN',
  'AU_ACN',
  'CASE_NUMBER',
  'DOCKET_NUMBER',
  'CLIENT_MATTER_ID',
  'BANK_ROUTING_NUMBER',
  'ACCOUNT_NUMBER',
  'ADDRESS',
  'DOB',
]);

const PRESIDIO_SUPPORTED_ENTITIES = new Set([
  'PERSON',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'US_SSN',
  'US_DRIVER_LICENSE',
  'PASSPORT',
  'CREDIT_CARD',
  'IBAN_CODE',
  'IP_ADDRESS',
  'LOCATION',
  'DATE_TIME',
  'NRP',
  'MEDICAL_LICENSE',
  'CRYPTO',
  'US_BANK_NUMBER',
  'US_ITIN',
  'US_PASSPORT',
  'UK_NHS',
  'AU_ABN',
  'AU_ACN',
]);

const ENTITY_LABELS: Record<string, string> = {
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  US_SSN: 'SSN',
  US_DRIVER_LICENSE: 'DRIVER LICENSE',
  CREDIT_CARD: 'CARD',
  IBAN_CODE: 'IBAN',
  IP_ADDRESS: 'IP',
  DATE_TIME: 'DATE',
  US_BANK_NUMBER: 'BANK NUMBER',
  BANK_ROUTING_NUMBER: 'ROUTING NUMBER',
  ACCOUNT_NUMBER: 'ACCOUNT NUMBER',
  CLIENT_MATTER_ID: 'MATTER ID',
  CASE_NUMBER: 'CASE NUMBER',
  DOCKET_NUMBER: 'DOCKET NUMBER',
  DOB: 'DOB',
};

const LOCAL_RECOGNIZERS: Array<{
  entityType: string;
  pattern: RegExp;
  score: number;
  context?: RegExp;
  validate?: (match: string) => boolean;
}> = [
  {
    entityType: 'EMAIL_ADDRESS',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    score: 0.96,
  },
  {
    entityType: 'PHONE_NUMBER',
    pattern: /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
    score: 0.84,
  },
  {
    entityType: 'US_SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    score: 0.98,
  },
  {
    entityType: 'CREDIT_CARD',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    score: 0.9,
    validate: looksLikeCreditCard,
  },
  {
    entityType: 'BANK_ROUTING_NUMBER',
    pattern: /\b\d{9}\b/g,
    score: 0.76,
    context: /\b(routing|aba|wire|ach|bank)\b/i,
  },
  {
    entityType: 'US_EIN',
    pattern: /\b\d{2}-\d{7}\b/g,
    score: 0.82,
    context: /\b(ein|tax|irs|employer identification)\b/i,
  },
  {
    entityType: 'ACCOUNT_NUMBER',
    pattern: /\b(?:account|acct|iban|swift|wire)\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9 -]{5,28}\b/gi,
    score: 0.8,
  },
  {
    entityType: 'CASE_NUMBER',
    pattern: /\b(?:case|cause)\s*(?:no\.?|number|#)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9:.-]{3,28}\b/gi,
    score: 0.82,
  },
  {
    entityType: 'DOCKET_NUMBER',
    pattern: /\b(?:docket|index)\s*(?:no\.?|number|#)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9:.-]{3,28}\b/gi,
    score: 0.82,
  },
  {
    entityType: 'CLIENT_MATTER_ID',
    pattern: /\b(?:client|matter)\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9.-]{3,28}\b/gi,
    score: 0.78,
  },
  {
    entityType: 'DOB',
    pattern: /\b(?:dob|date of birth|born)\s*[:#-]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Z][a-z]+ \d{1,2}, \d{4})\b/g,
    score: 0.86,
  },
  {
    entityType: 'ADDRESS',
    pattern: /\b\d{1,6}\s+[A-Z][A-Za-z0-9'.-]*(?:\s+[A-Z][A-Za-z0-9'.-]*){0,5}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Suite|Ste\.?)\b/g,
    score: 0.74,
  },
];

export class RedactionService {
  private readonly analyzerUrl: string | null;
  private readonly scoreThreshold: number;
  private readonly enabledEntities: Set<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RedactionServiceOptions) {
    this.analyzerUrl = opts.analyzerUrl
      ? opts.analyzerUrl.replace(/\/$/, '')
      : null;
    this.scoreThreshold = opts.scoreThreshold;
    this.enabledEntities =
      opts.enabledEntities && opts.enabledEntities.length > 0
        ? new Set(opts.enabledEntities.map(normalizeEntityType))
        : DEFAULT_ENTITY_ALLOWLIST;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get configuredWithPresidio(): boolean {
    return !!this.analyzerUrl;
  }

  async analyzeText(text: string): Promise<RedactionAnalysis> {
    if (!text.trim()) {
      return {
        findings: [],
        summary: emptySummary(),
        provider: this.configuredWithPresidio ? 'presidio' : 'local',
      };
    }

    const local = this.analyzeLocally(text);
    let presidio: RedactionFinding[] = [];
    let warning: string | undefined;

    if (this.analyzerUrl) {
      try {
        presidio = await this.analyzeWithPresidio(text);
      } catch (err) {
        warning =
          err instanceof Error
            ? `Presidio analyzer unavailable: ${err.message}`
            : 'Presidio analyzer unavailable';
      }
    }

    const findings = coalesceFindings([...presidio, ...local]);
    const provider =
      presidio.length > 0 && local.length > 0
        ? 'hybrid'
        : presidio.length > 0 || this.analyzerUrl
          ? 'presidio'
          : 'local';
    return {
      findings,
      summary: summarizeFindings(findings),
      provider,
      warning,
    };
  }

  async redactText(text: string): Promise<RedactionResult> {
    const analysis = await this.analyzeText(text);
    return {
      ...analysis,
      text: applyRedactions(text, analysis.findings),
    };
  }

  async scanDocuments(
    records: FileRecord[],
    opts: { markitdownBaseUrl: string },
  ): Promise<RedactionScanReport> {
    const documents: RedactionScanDocument[] = [];

    for (const record of records) {
      try {
        const text = await textForScan(record, opts);
        const analysis = await this.analyzeText(text);
        documents.push({
          fileId: record.id,
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          status: 'scanned',
          summary: analysis.summary,
          provider: analysis.provider,
          warning: analysis.warning,
        });
      } catch (err) {
        documents.push({
          fileId: record.id,
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          status: 'error',
          summary: emptySummary(),
          provider: this.configuredWithPresidio ? 'presidio' : 'local',
          error: err instanceof Error ? err.message : 'scan failed',
        });
      }
    }

    return {
      generatedAt: Date.now(),
      documents,
      summary: mergeSummaries(documents.map((doc) => doc.summary)),
    };
  }

  private analyzeLocally(text: string): RedactionFinding[] {
    const findings: RedactionFinding[] = [];
    for (const recognizer of LOCAL_RECOGNIZERS) {
      if (!this.enabledEntities.has(recognizer.entityType)) continue;
      recognizer.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = recognizer.pattern.exec(text)) !== null) {
        const matched = match[0];
        if (!matched) continue;
        const start = match.index;
        const end = start + matched.length;
        if (recognizer.context && !hasNearbyContext(text, start, end, recognizer.context)) {
          continue;
        }
        if (recognizer.validate && !recognizer.validate(matched)) continue;
        findings.push({
          entityType: recognizer.entityType,
          start,
          end,
          score: recognizer.score,
          source: 'local',
        });
      }
    }
    return findings.filter((finding) => finding.score >= this.scoreThreshold);
  }

  private async analyzeWithPresidio(text: string): Promise<RedactionFinding[]> {
    if (!this.analyzerUrl) return [];
    const presidioEntities = Array.from(this.enabledEntities).filter((entity) =>
      PRESIDIO_SUPPORTED_ENTITIES.has(entity),
    );
    if (presidioEntities.length === 0) return [];
    const response = await this.fetchImpl(`${this.analyzerUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language: 'en',
        score_threshold: this.scoreThreshold,
        entities: presidioEntities,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    const data = (await response.json()) as PresidioRecognizerResult[];
    if (!Array.isArray(data)) return [];
    return data
      .map((item): RedactionFinding | null => {
        const entityType = normalizeEntityType(item.entity_type);
        const start = item.start;
        const end = item.end;
        const score = item.score ?? 0;
        if (!entityType || !Number.isInteger(start) || !Number.isInteger(end)) return null;
        if (start! < 0 || end! <= start! || end! > text.length) return null;
        if (score < this.scoreThreshold || !this.enabledEntities.has(entityType)) return null;
        return {
          entityType,
          start: start!,
          end: end!,
          score,
          source: 'presidio',
        };
      })
      .filter((item): item is RedactionFinding => item !== null);
  }
}

export function shouldRedactForRequest(input: {
  requestedMode?: unknown;
  configuredMode: RedactionMode;
  targetBaseUrl: string;
}): boolean {
  if (input.configuredMode === 'always') return true;
  if (input.configuredMode === 'off') return false;
  const mode = parseRedactionMode(input.requestedMode) ?? input.configuredMode;
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return !isLocalBaseUrl(input.targetBaseUrl);
}

export function parseRedactionMode(value: unknown): RedactionMode | null {
  if (value === 'auto' || value === 'always' || value === 'off') return value;
  return null;
}

export function parseConfiguredRedactionMode(value: string | undefined): RedactionMode {
  return parseRedactionMode(value) ?? 'auto';
}

export function summarizeFindings(findings: RedactionFinding[]): RedactionSummary {
  const summary = emptySummary();
  for (const finding of findings) {
    summary.total += 1;
    summary.byType[finding.entityType] = (summary.byType[finding.entityType] ?? 0) + 1;
    summary.bySource[finding.source] = (summary.bySource[finding.source] ?? 0) + 1;
  }
  return summary;
}

export function emptySummary(): RedactionSummary {
  return { total: 0, byType: {}, bySource: { local: 0, presidio: 0 } };
}

export function mergeSummaries(summaries: RedactionSummary[]): RedactionSummary {
  const merged = emptySummary();
  for (const summary of summaries) {
    merged.total += summary.total;
    for (const [type, count] of Object.entries(summary.byType)) {
      merged.byType[type] = (merged.byType[type] ?? 0) + count;
    }
    merged.bySource.local += summary.bySource.local ?? 0;
    merged.bySource.presidio += summary.bySource.presidio ?? 0;
  }
  return merged;
}

export async function redactStructuredValue(
  value: unknown,
  redactText: RedactTextFn,
): Promise<unknown> {
  return redactStructuredValueInner(value, redactText, new WeakSet<object>());
}

function applyRedactions(text: string, findings: RedactionFinding[]): string {
  if (findings.length === 0) return text;
  const sorted = [...findings].sort((a, b) => b.start - a.start);
  let out = text;
  for (const finding of sorted) {
    out =
      out.slice(0, finding.start) +
      replacementFor(finding.entityType) +
      out.slice(finding.end);
  }
  return out;
}

async function redactStructuredValueInner(
  value: unknown,
  redactText: RedactTextFn,
  seen: WeakSet<object>,
  key?: string,
): Promise<unknown> {
  if (typeof value === 'string') {
    if (key && isProtectedResultKey(key)) return value;
    return (await redactText(value)).text;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      out.push(await redactStructuredValueInner(item, redactText, seen));
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = await redactStructuredValueInner(child, redactText, seen, key);
  }
  return out;
}

function isProtectedResultKey(key: string): boolean {
  return /^(?:id|file_id|doc_id|session_id|download_url|downloadUrl|download_file_id|download_session_id|url|href|path|mimeType|filename|download_filename|downloadFilename)$/i.test(
    key,
  );
}

function replacementFor(entityType: string): string {
  const label = ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, ' ');
  return `[${label} REDACTED]`;
}

function coalesceFindings(findings: RedactionFinding[]): RedactionFinding[] {
  const usable = findings
    .filter((finding) => finding.end > finding.start)
    .sort((a, b) => a.start - b.start || b.end - a.end || b.score - a.score);
  const out: RedactionFinding[] = [];
  for (const finding of usable) {
    const last = out[out.length - 1];
    if (!last || finding.start >= last.end) {
      out.push(finding);
      continue;
    }
    const lastLength = last.end - last.start;
    const nextLength = finding.end - finding.start;
    const nextWins =
      finding.score > last.score + 0.05 ||
      (Math.abs(finding.score - last.score) <= 0.05 && nextLength > lastLength) ||
      (finding.source === 'presidio' && last.source === 'local' && finding.score >= last.score);
    if (nextWins) {
      out[out.length - 1] = finding;
    }
  }
  return out;
}

function normalizeEntityType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function hasNearbyContext(text: string, start: number, end: number, context: RegExp): boolean {
  const left = Math.max(0, start - 80);
  const right = Math.min(text.length, end + 80);
  return context.test(text.slice(left, right));
}

function looksLikeCreditCard(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

async function textForScan(
  record: FileRecord,
  opts: { markitdownBaseUrl: string },
): Promise<string> {
  if (looksLikeText(record.mimeType)) {
    return record.bytes.toString('utf-8');
  }
  return convertFileToMarkdown(record, {
    markitdownBaseUrl: opts.markitdownBaseUrl,
  });
}

function looksLikeText(mimeType: string): boolean {
  return (
    /^text\//i.test(mimeType) ||
    /^application\/json\b/i.test(mimeType) ||
    /^application\/(?:csv|xml|x-xml)\b/i.test(mimeType)
  );
}
