import {
  alignParagraphs,
  diffWords,
  type DocumentDiffResult,
  type ParagraphDiffEvent,
} from '@teamsuzie/docx-diff';
import { bodyParagraphTexts, loadDocx } from '@teamsuzie/docx';
import type { FileRecord } from './files.js';
import { convertFileToMarkdown } from './document-tools.js';

// Re-export upstream diff types so existing suzielaw imports
// (`from './diff-engine.js'`) keep working unchanged.
export type { DocumentDiffResult, ParagraphDiffEvent } from '@teamsuzie/docx-diff';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isDocxRecord(record: FileRecord): boolean {
  return (
    record.mimeType === DOCX_MIME ||
    record.name.toLowerCase().endsWith('.docx')
  );
}

/**
 * Get one paragraph-text per main-document `<w:p>` for a DOCX, including
 * paragraphs nested inside tables, or per markdown paragraph block for
 * everything else.
 *
 * **Why the DOCX branch matters:** mammoth-derived markdown drops empty
 * paragraphs (used in legal drafting for spacing), and `splitParagraphs`
 * filters them too. That makes mammoth's paragraph stream shorter than
 * the OOXML body's `<w:p>` count. If we then pass the resulting indices
 * back to `TrackedChangesEditor.applyParagraphDiff`, the editor operates
 * on the wrong paragraphs (its body-paragraph indices include empties).
 * Result: text loss, "incomplete sentences" after reject-all. Going
 * OOXML-direct keeps indices in sync end-to-end.
 *
 * Non-DOCX inputs (PDF etc.) still go through the mammoth/markitdown
 * pipeline — we can't apply tracked changes to them anyway, since the
 * compose step only writes back to a DOCX.
 */
async function extractParagraphsFor(
  record: FileRecord,
  opts: { markitdownBaseUrl: string },
): Promise<string[]> {
  if (isDocxRecord(record)) {
    return bodyParagraphTexts(loadDocx(record.bytes));
  }
  const md = await convertFileToMarkdown(record, opts);
  return splitParagraphs(md);
}

/**
 * Extract paragraphs from each side (OOXML-direct for DOCX, mammoth for
 * other types), align via Needleman–Wunsch, then run word-level diff on
 * each matched pair. The result is a single ordered sequence of events:
 * unchanged paragraphs are stitched in their original document position,
 * insertions appear at the position they landed in B (relative to the
 * surrounding matched anchors), and deletions appear at their A position.
 *
 * The leftIndex on every event is the LEFT paragraph's body index (0-based
 * over main-document `<w:p>` elements in editor order, including empty
 * spacer paragraphs and table-cell paragraphs) — the same index space
 * `TrackedChangesEditor` uses, so callers can pipe events straight into
 * `applyParagraphDiff` / `deleteParagraph` / `insertParagraph` without
 * index translation.
 */
export async function runDocumentDiff(
  left: FileRecord,
  right: FileRecord,
  opts: { markitdownBaseUrl: string },
): Promise<DocumentDiffResult> {
  const [leftParas, rightParas] = await Promise.all([
    extractParagraphsFor(left, opts),
    extractParagraphsFor(right, opts),
  ]);

  const { matches, unmatchedB } = alignParagraphs(leftParas, rightParas);

  const events: ParagraphDiffEvent[] = [];
  const unmatchedBSet = new Set(unmatchedB);
  const stats = {
    unchanged: 0,
    modified: 0,
    deleted: 0,
    inserted: 0,
    moved: 0,
  };

  // Walk A in order; whenever a matched A paragraph points at a B index that's
  // ahead of where we last left off in B, emit any unmatched-B paragraphs in
  // between as insertions before the matched event. This produces a sequence
  // ordered like the merged document: A's flow, with B's insertions slotted in
  // at the right anchors.
  let bCursor = 0;
  const flushInsertsUpTo = (target: number) => {
    while (bCursor < target) {
      if (unmatchedBSet.has(bCursor)) {
        events.push({
          kind: 'inserted',
          rightIndex: bCursor,
          text: rightParas[bCursor],
        });
        stats.inserted++;
      }
      bCursor++;
    }
  };

  for (const match of matches) {
    if (match.bIndex === null) {
      events.push({
        kind: 'deleted',
        leftIndex: match.aIndex,
        text: match.aText,
      });
      stats.deleted++;
      continue;
    }
    flushInsertsUpTo(match.bIndex);
    bCursor = match.bIndex + 1;

    if (match.aText === match.bText) {
      events.push({
        kind: 'unchanged',
        leftIndex: match.aIndex,
        rightIndex: match.bIndex,
        text: match.aText,
      });
      stats.unchanged++;
    } else {
      events.push({
        kind: 'modified',
        leftIndex: match.aIndex,
        rightIndex: match.bIndex,
        leftText: match.aText,
        rightText: match.bText,
        ops: diffWords(match.aText, match.bText),
        similarity: match.similarity,
        moved: match.status === 'moved',
      });
      stats.modified++;
      if (match.status === 'moved') stats.moved++;
    }
  }
  flushInsertsUpTo(rightParas.length);

  return {
    left: { name: left.name, paragraphs: leftParas.length },
    right: { name: right.name, paragraphs: rightParas.length },
    stats,
    events,
  };
}

/**
 * Split a markdown blob into paragraphs on blank lines. Each paragraph is
 * trimmed, has emphasis-style markdown stripped (so a Word "Address" run
 * that mammoth emits as `**Address**` doesn't collide with our redline
 * `**inserted**` markers), and empty paragraphs are dropped. This is
 * intentionally coarser than a markdown AST split — for diff purposes a
 * heading and the paragraph underneath are separate paragraphs because
 * they're separated by a blank line in mammoth's output, and that's the
 * right granularity.
 *
 * List markers (`- `, `1. `), heading marks (`# `), and blockquotes are
 * preserved — in legal drafting those characters often ARE content
 * (section numbers, especially) and stripping them would hide real
 * differences from the diff.
 */
function splitParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n+/g)
    .map((p) => stripMarkdownEmphasis(p.trim()))
    .filter((p) => p.length > 0);
}

function stripMarkdownEmphasis(s: string): string {
  return (
    s
      // Bold **...** (mammoth's preferred bold marker)
      .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
      // Bold __...__
      .replace(/__([^_\n]+?)__/g, '$1')
      // Italic *...*  (negative lookarounds avoid eating bold markers)
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1')
      // Italic _..._
      .replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '$1')
      // Inline code `...`
      .replace(/`([^`\n]+?)`/g, '$1')
      // Strikethrough ~~...~~
      .replace(/~~([^~\n]+?)~~/g, '$1')
  );
}
