import {
  bodyParagraphTexts,
  listRevisions,
  loadDocx,
  TrackedChangesEditor,
} from '@teamsuzie/docx';
import type { WordDiffOp } from '@teamsuzie/docx';
import type { DocumentDiffResult, ParagraphDiffEvent } from './diff-engine.js';

export interface ComposeRedlineOptions {
  leftBytes: Buffer | Uint8Array;
  rightBytes?: Buffer | Uint8Array;
  diff: DocumentDiffResult;
  author?: string;
}

export interface RedlineRevision {
  id: number;
  type: string;
  author: string;
  date: string;
}

export interface RedlineParagraph {
  id: string;
  text: string;
  revisions: RedlineRevision[];
}

export function composeRedlineDocx(opts: ComposeRedlineOptions): Buffer {
  const file = loadDocx(opts.leftBytes);
  const editor = new TrackedChangesEditor(file, {
    name: opts.author || 'Counsel',
  });
  let offset = 0;
  let lastLeftIndex = -1;

  for (const event of opts.diff.events) {
    if ('leftIndex' in event && typeof event.leftIndex === 'number') {
      lastLeftIndex = event.leftIndex;
    }
    if (event.kind === 'modified') {
      editor.applyParagraphDiff(event.leftIndex + offset, event.ops as WordDiffOp[], {
        inheritFormatting: true,
      });
    } else if (event.kind === 'deleted') {
      editor.deleteParagraph(event.leftIndex + offset);
    } else if (event.kind === 'inserted') {
      const insertAfter = Math.max(-1, lastLeftIndex + offset);
      editor.insertParagraph(insertAfter, event.text);
      offset++;
    }
  }

  return file.save();
}

export function redlineDownloadFilename(leftName: string, rightName: string): string {
  const base = stripExtension(leftName) || 'redline';
  const compared = stripExtension(rightName);
  return compared ? `${base}-to-${compared}-redline.docx` : `${base}-redline.docx`;
}

export function extractRedlineParagraphs(bytes: Buffer | Uint8Array): RedlineParagraph[] {
  const file = loadDocx(bytes);
  const revisions = listRevisions(file);
  return bodyParagraphTexts(file).map((text, index) => ({
    id: String(index),
    text,
    revisions: revisions.map((revision) => ({ ...revision })),
  }));
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');
}
