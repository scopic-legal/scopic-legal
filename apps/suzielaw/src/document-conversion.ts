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
  if (!baseUrl) {
    throw new Error(
      `Cannot convert ${mime || filename}: markitdown-agent is not configured. Only DOCX is supported in standalone mode.`,
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
