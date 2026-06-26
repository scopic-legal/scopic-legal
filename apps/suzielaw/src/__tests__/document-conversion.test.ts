import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertToMarkdown } from '../document-conversion.js';

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildTextPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${startXref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

describe('document conversion', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('extracts text from PDFs without markitdown-agent', async () => {
    const result = await convertToMarkdown(buildTextPdf('SAFE agreement by Jane Doe.'), {
      filename: 'safe.pdf',
      mime: 'application/pdf',
      markitdownAgentBaseUrl: '',
    });

    expect(result.filename).toBe('safe.pdf');
    expect(result.markdown).toContain('SAFE agreement by Jane Doe.');
  });

  it('falls back to OpenAI PDF extraction when local parsing cannot read the PDF', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: 'Extracted fallback agreement text.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await convertToMarkdown(Buffer.from('not a real pdf'), {
      filename: 'scanned.pdf',
      mime: 'application/pdf',
      markitdownAgentBaseUrl: '',
      openAiPdfFallback: {
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.test/v1',
        model: 'gpt-4o-mini',
      },
    });

    expect(result.markdown).toBe('Extracted fallback agreement text.');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.test/v1/responses');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.input[0].content[1]).toMatchObject({
      type: 'input_file',
      filename: 'scanned.pdf',
    });
    expect(body.input[0].content[1].file_data).toContain('data:application/pdf;base64,');
  });
});
