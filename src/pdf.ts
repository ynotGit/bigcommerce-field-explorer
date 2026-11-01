// A table as a PDF: A4 landscape, a heading, then rows that wrap their text
// and carry on over as many pages as they need, with the column headings
// repeated at the top of each page.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PdfTable {
  title: string;
  /** Short lines under the title, such as the store and when the catalog was read. */
  details: string[];
  /** A line in bold above the table, such as how many products match. */
  summary: string;
  headers: string[];
  /** Each cell is a list of lines: several values in one cell each get their own. */
  rows: string[][][];
}

const PAGE = { width: 841.89, height: 595.28 }; // A4 landscape
const MARGIN = 36;
const SIZE = 8.5;
const LINE = SIZE * 1.3;
const PAD = 4;
const MAX_COLUMN = 240;
const MIN_COLUMN = 44;

const ink = rgb(0.13, 0.15, 0.18);
const muted = rgb(0.42, 0.45, 0.5);
const rule = rgb(0.84, 0.86, 0.89);
const stripe = rgb(0.965, 0.97, 0.975);
const headFill = rgb(0.92, 0.93, 0.95);

/**
 * The standard PDF fonts only have the characters of Western European
 * languages. Anything else would stop the PDF being made, so it is shown as "?".
 */
function sanitiser(font: PDFFont): (text: string) => string {
  const known = new Set(font.getCharacterSet());
  return (text) =>
    [...text.replace(/\t/g, ' ')].map((ch) => (known.has(ch.codePointAt(0) ?? 0) ? ch : '?')).join('');
}

/** Breaks text into lines that fit `width` points, at spaces where possible. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (let word of paragraph.split(/ +/).filter(Boolean)) {
      // A word longer than the column is broken wherever it has to be.
      while (!fits(word)) {
        let cut = word.length - 1;
        while (cut > 1 && !fits(word.slice(0, cut))) cut--;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const joined = line ? `${line} ${word}` : word;
      if (fits(joined)) line = joined;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Column widths: each as wide as its longest text, up to a limit, then all
 * scaled down together if the table is still wider than the page.
 */
function columnWidths(table: PdfTable, regular: PDFFont, bold: PDFFont, available: number): number[] {
  const natural = table.headers.map((header, i) => {
    const longest = Math.max(
      bold.widthOfTextAtSize(header, SIZE),
      ...table.rows.flatMap((row) => (row[i] ?? []).map((line) => regular.widthOfTextAtSize(line, SIZE))),
    );
    return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, longest + PAD * 2 + 1));
  });
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= available) return natural;
  // Shrink the wide columns first: narrow ones (an ID, a yes or no) keep their width.
  const scale = (available - MIN_COLUMN * natural.length) / (total - MIN_COLUMN * natural.length);
  return natural.map((w) => MIN_COLUMN + (w - MIN_COLUMN) * Math.max(0, scale));
}

export async function tablePdf(table: PdfTable): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(table.title);
  doc.setProducer('field-explorer');
  doc.setCreator('field-explorer');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = sanitiser(regular);
  const headers = table.headers.map(clean);
  const rows = table.rows.map((row) => row.map((cell) => cell.map(clean)));
  const prepared: PdfTable = { ...table, headers, rows };

  const available = PAGE.width - MARGIN * 2;
  const widths = columnWidths(prepared, regular, bold, available);
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const bottom = MARGIN + 18; // room for the page number

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  // The heading, on the first page only.
  page.drawText(clean(table.title), { x: MARGIN, y: y - 14, size: 15, font: bold, color: ink });
  y -= 26;
  for (const detail of table.details) {
    for (const line of wrap(clean(detail), regular, 9, available)) {
      page.drawText(line, { x: MARGIN, y: y - 9, size: 9, font: regular, color: muted });
      y -= 12;
    }
  }
  y -= 6;
  page.drawText(clean(table.summary), { x: MARGIN, y: y - 10, size: 10, font: bold, color: ink });
  y -= 22;

  const cellLines = (cells: string[], font: PDFFont): string[][] =>
    cells.map((text, i) => wrap(text, font, SIZE, Math.max(1, (widths[i] ?? MIN_COLUMN) - PAD * 2)));

  const drawRow = (lines: string[][], font: PDFFont, fill?: ReturnType<typeof rgb>): void => {
    const height = Math.max(...lines.map((l) => l.length)) * LINE + PAD * 2;
    if (fill) page.drawRectangle({ x: MARGIN, y: y - height, width: tableWidth, height, color: fill });
    let x = MARGIN;
    lines.forEach((cell, i) => {
      cell.forEach((text, k) => {
        if (text) page.drawText(text, { x: x + PAD, y: y - PAD - SIZE - k * LINE + 1.5, size: SIZE, font, color: ink });
      });
      x += widths[i] ?? 0;
    });
    page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: MARGIN + tableWidth, y: y - height }, thickness: 0.5, color: rule });
    y -= height;
  };

  const headerLines = cellLines(headers, bold);
  const headerHeight = Math.max(...headerLines.map((l) => l.length)) * LINE + PAD * 2;
  drawRow(headerLines, bold, headFill);

  rows.forEach((row, index) => {
    const lines = cellLines(row.map((cell) => cell.join('\n')), regular);
    let height = Math.max(...lines.map((l) => l.length)) * LINE + PAD * 2;
    // A row taller than a whole page is cut to fit one; anything else that
    // does not fit moves to a new page under the headings again.
    const roomOnAPage = PAGE.height - MARGIN - bottom - headerHeight;
    if (height > roomOnAPage) {
      const keep = Math.floor((roomOnAPage - PAD * 2) / LINE);
      lines.forEach((cell, i) => { if (cell.length > keep) lines[i] = [...cell.slice(0, keep - 1), '…']; });
      height = keep * LINE + PAD * 2;
    }
    if (y - height < bottom) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
      drawRow(headerLines, bold, headFill);
    }
    drawRow(lines, regular, index % 2 ? stripe : undefined);
  });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: PAGE.width - MARGIN - regular.widthOfTextAtSize(label, 8), y: MARGIN - 4, size: 8, font: regular, color: muted });
  });
  return doc.save();
}
