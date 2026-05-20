import ExcelJS from 'exceljs';

import type { ReviewsStore, ReviewSnapshot } from '@teamsuzie/grid-review';
import type { WorkspacesStore } from '@teamsuzie/workspaces';

interface CellCitation {
  id: number;
  doc: string;
  quote: string;
  locator?: string;
}

export interface BuildReviewWorkbookOptions {
  reviews: ReviewsStore;
  workspaces: WorkspacesStore;
  reviewId: string;
  matterId: string;
}

/**
 * Build an `.xlsx` workbook for one review. One row per review
 * document, one column per review column, header row with the column
 * titles. Each answered cell's citations land in a cell comment so
 * `[1] "verbatim quote"` lines are visible on hover in Excel — that's
 * how reviewers verify the source without leaving the spreadsheet.
 *
 * Pending / running cells render as empty; errored cells render the
 * error string in the cell value (and a `(error)` prefix on the
 * comment) so the export reflects the live grid state honestly.
 */
export async function buildReviewWorkbook(
  opts: BuildReviewWorkbookOptions,
): Promise<{
  workbook: ExcelJS.Workbook;
  fileName: string;
  reviewName: string;
}> {
  const snapshot = opts.reviews.getReviewSnapshot(opts.reviewId);
  if (!snapshot || snapshot.review.workspaceId !== opts.matterId) {
    throw new Error('review not found');
  }
  const workspace = opts.workspaces.getWorkspace(opts.matterId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Scopic';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(safeSheetName(snapshot.review.name));

  // Headers — first column is the document name; rest mirror review columns.
  const headerCells: string[] = ['Document', ...snapshot.columns.map((c) => c.title)];
  const headerRow = sheet.addRow(headerCells);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'top' };
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  // Width tuning: doc-name column wider, value columns wrap on text.
  sheet.getColumn(1).width = 36;
  for (let i = 0; i < snapshot.columns.length; i++) {
    sheet.getColumn(i + 2).width = 42;
  }

  // Index cells by (columnId, rowId) for O(1) lookup as we walk the matrix.
  const cellByKey = new Map<string, ReviewSnapshot['cells'][number]>();
  for (const cell of snapshot.cells) {
    cellByKey.set(`${cell.columnId}::${cell.reviewDocumentId}`, cell);
  }

  for (const doc of snapshot.documents) {
    const rowValues: (string | null)[] = [doc.name];
    for (const col of snapshot.columns) {
      const cell = cellByKey.get(`${col.id}::${doc.id}`);
      rowValues.push(formatCellValue(cell));
    }
    const row = sheet.addRow(rowValues);
    row.alignment = { vertical: 'top', wrapText: true };

    // Attach citation comments after the row exists. Skip the doc-name
    // column at index 1.
    for (let colIdx = 0; colIdx < snapshot.columns.length; colIdx++) {
      const col = snapshot.columns[colIdx];
      const cell = cellByKey.get(`${col.id}::${doc.id}`);
      if (!cell) continue;
      const comment = formatCellComment(cell, snapshot);
      if (!comment) continue;
      const xlCell = row.getCell(colIdx + 2);
      xlCell.note = {
        texts: [{ text: comment }],
        margins: { insetmode: 'auto' },
      };
    }
  }

  const fileName = buildFileName({
    reviewName: snapshot.review.name,
    matterName: workspace?.name ?? 'matter',
  });

  return {
    workbook,
    fileName,
    reviewName: snapshot.review.name,
  };
}

function formatCellValue(
  cell: ReviewSnapshot['cells'][number] | undefined,
): string | null {
  if (!cell) return '';
  if (cell.status === 'error') return cell.error ?? '(error)';
  if (cell.status === 'pending' || cell.status === 'streaming') return '';
  return cell.value ?? '';
}

function formatCellComment(
  cell: ReviewSnapshot['cells'][number],
  snapshot: ReviewSnapshot,
): string | null {
  if (!cell.citations) return null;
  let parsed: CellCitation[];
  try {
    const raw = JSON.parse(cell.citations);
    if (!Array.isArray(raw)) return null;
    parsed = raw as CellCitation[];
  } catch {
    return null;
  }
  if (parsed.length === 0) return null;
  const docNameByHandle = new Map(
    snapshot.documents.map((d) => [d.externalDocId, d.name]),
  );
  const lines: string[] = [];
  for (const c of parsed) {
    const docName = docNameByHandle.get(c.doc) ?? c.doc;
    const locator = c.locator ? ` · ${c.locator}` : '';
    lines.push(`[${c.id}] ${docName}${locator}`);
    lines.push(`"${c.quote}"`);
    lines.push('');
  }
  // Trim trailing blank line and cap comment length — Excel truncates
  // very long notes anyway, and 8KB is more than enough for ~10 quotes.
  let text = lines.join('\n').trimEnd();
  if (text.length > 8000) text = text.slice(0, 7997) + '…';
  return text;
}

function safeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, can't contain : \ / ? * [ ]
  const cleaned = name.replace(/[:\\/?*[\]]/g, '-').trim();
  return cleaned.slice(0, 31) || 'Review';
}

function buildFileName({
  reviewName,
  matterName,
}: {
  reviewName: string;
  matterName: string;
}): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'review';
  const date = new Date().toISOString().slice(0, 10);
  return `${slug(matterName)}-${slug(reviewName)}-${date}.xlsx`;
}
