import { describe, expect, it } from 'vitest';
import { InMemoryDocumentStore, MarkdownDocument } from '@teamsuzie/markdown-document';
import { loadDocx } from '@teamsuzie/docx';
import { buildDocumentTools, markdownToDocxSections } from '../document-tools.js';
import { InMemoryFileStore } from '../files.js';

describe('document tools DOCX export', () => {
  it('registers export_to_docx and stores a native DOCX without markitdown-agent', async () => {
    const fileStore = new InMemoryFileStore({ dataDir: null });
    const docStore = new InMemoryDocumentStore();
    const sessionId = 'session-docx';
    const docId = docStore.put(
      sessionId,
      new MarkdownDocument(
        [
          '## Confidentiality',
          '',
          'Each party shall keep confidential information in strict confidence.',
          '',
          '- Return or destroy materials on request.',
        ].join('\n'),
        'Confidentiality Provision',
      ),
    );
    const tools = buildDocumentTools({
      sessionId,
      fileStore,
      docStore,
      markitdownBaseUrl: '',
    });
    const exportTool = tools.find((tool) => tool.name === 'export_to_docx');

    expect(exportTool).toBeTruthy();
    const result = (await exportTool!.execute({
      doc_id: docId,
      filename: 'Confidentiality Provision',
    })) as {
      file_id: string;
      filename: string;
      download_url: string;
    };

    expect(result.filename).toBe('Confidentiality_Provision.docx');
    expect(result.download_url).toContain(`/api/files/${sessionId}/${result.file_id}/content`);
    const record = fileStore.get(sessionId, result.file_id);
    expect(record?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    const docx = loadDocx(record!.bytes);
    const xml = docx.readPart('word/document.xml')?.toString('utf8') ?? '';
    expect(xml).toContain('CONFIDENTIALITY PROVISION');
    expect(xml).toContain('CONFIDENTIALITY');
    expect(xml).toContain('strict confidence');
    expect(xml).toContain('Return or destroy materials');
  });

  it('maps markdown headings, prose, bullets, and tables into DOCX sections', () => {
    expect(
      markdownToDocxSections(
        [
          'Intro paragraph.',
          '',
          '## Terms',
          '',
          '- First item',
          '',
          '| Name | Role |',
          '| --- | --- |',
          '| Jane Doe | Buyer |',
        ].join('\n'),
      ),
    ).toEqual([
      { paragraphs: ['Intro paragraph.'] },
      { heading: { level: 2, text: 'Terms' }, paragraphs: ['- First item'] },
      { table: { headers: ['Name', 'Role'], rows: [['Jane Doe', 'Buyer']] } },
    ]);
  });
});
