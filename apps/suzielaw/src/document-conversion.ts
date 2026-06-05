import { convertDocxToMarkdown, isDocxMimeType } from '@teamsuzie/markdown-document';

export interface ConvertToMarkdownOptions {
  mime?: string | null;
  filename?: string | null;
  markitdownAgentBaseUrl?: string;
}

export interface ConvertToMarkdownResult {
  filename: string;
  markdown: string;
}

function isPdf(mime: string, filename: string): boolean {
  return mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
}

/**
 * Standalone PDF → plain-text fallback used when markitdown-agent isn't
 * configured (e.g. the packaged Electron build). Uses pdfjs-dist's legacy
 * Node build to walk every page and concatenate the text content; no
 * worker, no canvas — text extraction only.
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

  // PDFs have a pure-JS standalone path so the packaged Electron build can
  // read them without a markitdown-agent sidecar. When markitdown IS
  // configured we still prefer it — its tables / image OCR are better.
  if (isPdf(mime, filename) && !baseUrl) {
    const markdown = await convertPdfToMarkdown(buffer);
    return { filename, markdown };
  }

  if (!baseUrl) {
    throw new Error(
      `Cannot convert ${mime || filename}: markitdown-agent is not configured. Only DOCX and PDF are supported in standalone mode.`,
    );
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: mime || 'application/octet-stream' }),
    filename,
  );

  const response = await fetch(`${baseUrl}/convert`, {
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
    filename: data.filename || filename,
    markdown: data.markdown || '',
  };
}
