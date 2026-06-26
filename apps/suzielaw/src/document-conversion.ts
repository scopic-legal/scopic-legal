import { convertDocxToMarkdown, isDocxMimeType } from '@teamsuzie/markdown-document';

export interface OpenAiPdfFallbackOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ConvertToMarkdownOptions {
  mime?: string | null;
  filename?: string | null;
  markitdownAgentBaseUrl?: string;
  openAiPdfFallback?: OpenAiPdfFallbackOptions;
}

export interface ConvertToMarkdownResult {
  filename: string;
  markdown: string;
}

function isPdf(mime: string, filename: string): boolean {
  return mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
}

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime || 'application/pdf'};base64,${bytes.toString('base64')}`;
}

function responseText(data: unknown): string {
  const direct = (data as { output_text?: unknown })?.output_text;
  if (typeof direct === 'string') return direct;

  const output = (data as { output?: unknown })?.output;
  if (!Array.isArray(output)) return '';

  const chunks: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === 'string') chunks.push(text);
    }
  }
  return chunks.join('');
}

function cleanExtractedText(text: string): string {
  return text.replace(/-- \d+ of \d+ --/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Standalone PDF -> plain-text fallback used when markitdown-agent isn't
 * configured. Uses pdfjs-dist's legacy Node build to walk every page and
 * concatenate text content; no worker and no canvas are required.
 */
async function convertPdfToMarkdown(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      page.cleanup();
      if (pageText) pages.push(pageText);
    }
    return pages.join('\n\n');
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }
}

async function convertPdfWithOpenAiFallback(
  bytes: Buffer,
  opts: { filename: string; mime: string; fallback?: OpenAiPdfFallbackOptions },
): Promise<string> {
  const apiKey = opts.fallback?.apiKey?.trim();
  if (!apiKey) return '';

  const baseUrl = (opts.fallback?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = opts.fallback?.model || 'gpt-4o';
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Extract the readable legal-document text from this PDF. Preserve party names, defined terms, addresses, dates, section headings, signature blocks, and clause text. Return only extracted text. If no text is readable, say exactly: No readable text extracted from this PDF.',
            },
            {
              type: 'input_file',
              filename: opts.filename || 'document.pdf',
              file_data: dataUrl(opts.mime, bytes),
            },
          ],
        },
      ],
      max_output_tokens: 4000,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI PDF fallback failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  const text = cleanExtractedText(responseText(await response.json()));
  return /^No readable text extracted from this PDF\.?$/i.test(text) ? '' : text;
}

async function convertPdfBestEffort(
  bytes: Buffer,
  opts: { filename: string; mime: string; fallback?: OpenAiPdfFallbackOptions },
): Promise<string> {
  let localError: unknown;
  try {
    const localText = cleanExtractedText(await convertPdfToMarkdown(bytes));
    if (localText) return localText;
  } catch (err) {
    localError = err;
  }

  const fallbackText = await convertPdfWithOpenAiFallback(bytes, opts);
  if (fallbackText) return fallbackText;

  if (localError) throw localError;
  return '';
}

async function convertWithMarkitdownAgent(
  bytes: Buffer,
  opts: { filename: string; mime: string; baseUrl: string },
): Promise<ConvertToMarkdownResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: opts.mime || 'application/octet-stream' }),
    opts.filename,
  );

  const response = await fetch(`${opts.baseUrl}/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`markitdown-agent /convert returned ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { filename?: string; markdown?: string };
  return {
    filename: data.filename || opts.filename,
    markdown: data.markdown || '',
  };
}

export async function convertToMarkdown(
  bytes: Buffer | Uint8Array,
  opts: ConvertToMarkdownOptions,
): Promise<ConvertToMarkdownResult> {
  const filename = opts.filename?.trim() || 'document';
  const mime = opts.mime?.trim() || '';
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  if (isDocxMimeType(mime) || filename.toLowerCase().endsWith('.docx')) {
    const result = await convertDocxToMarkdown(buffer);
    return { filename, markdown: result.markdown };
  }

  const baseUrl = opts.markitdownAgentBaseUrl?.replace(/\/$/, '');
  const pdf = isPdf(mime, filename);

  if (pdf && !baseUrl) {
    const markdown = await convertPdfBestEffort(buffer, {
      filename,
      mime: mime || 'application/pdf',
      fallback: opts.openAiPdfFallback,
    });
    return { filename, markdown };
  }

  if (!baseUrl) {
    throw new Error(
      `Cannot convert ${mime || filename}: markitdown-agent is not configured. Only DOCX and PDF are supported in standalone mode.`,
    );
  }

  try {
    const result = await convertWithMarkitdownAgent(buffer, { filename, mime, baseUrl });
    if (!pdf || result.markdown.trim()) return result;
  } catch (err) {
    if (!pdf || !opts.openAiPdfFallback?.apiKey) throw err;
  }

  const markdown = await convertPdfBestEffort(buffer, {
    filename,
    mime: mime || 'application/pdf',
    fallback: opts.openAiPdfFallback,
  });
  return { filename, markdown };
}
