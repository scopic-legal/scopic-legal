import { describe, expect, it } from 'vitest';
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
  it('extracts text from PDFs without markitdown-agent', async () => {
    const result = await convertToMarkdown(buildTextPdf('SAFE agreement by Jane Doe.'), {
      filename: 'safe.pdf',
      mime: 'application/pdf',
      markitdownAgentBaseUrl: '',
    });

    expect(result.filename).toBe('safe.pdf');
    expect(result.markdown).toContain('SAFE agreement by Jane Doe.');
  });
});
