// Payroll-ready monthly PDF for one employee, drawn with pdf-lib (pure JS, no
// native deps, bundles cleanly in a Next route handler). Standard Helvetica uses
// WinAnsi encoding, which covers German umlauts/ß/€ but NOT the typographic minus
// (U+2212) or ≥/≤ — so all text is run through `san()` before drawing.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BRAND } from "@/config/brand";
import { formatDayKey } from "@/lib/time";
import {
  dayHours,
  dayNote,
  displayTotals,
  OPEN_ENTRY_WARNING,
  AUTO_BREAK_WARNING,
  type MonthlyReport,
} from "./report";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const TEAL = hexColor(BRAND.colors.primary);
const INK = rgb(0.122, 0.165, 0.157); // #1F2A28
const MUTED = rgb(0.42, 0.478, 0.467); // #6B7A77
const DANGER = rgb(0.753, 0.224, 0.169); // #C0392B
const LINE = rgb(0.85, 0.87, 0.86);

/** "#136860" → pdf-lib colour. */
function hexColor(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Replace characters Helvetica's WinAnsi encoding cannot draw. */
function san(s: string): string {
  return s
    .replace(/−/g, "-") // minus sign → hyphen
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/ /g, " "); // non-breaking space → space
}

/** Decimal hours (already rounded to what is printed) with a German comma. */
function hoursDec(hours: number): string {
  return hours.toFixed(2).replace(".", ",");
}
function signedDec(hours: number): string {
  const sign = hours < 0 ? "-" : "+";
  return `${sign}${Math.abs(hours).toFixed(2).replace(".", ",")}`;
}

interface Cols {
  x: number;
  w: number;
  align: "left" | "right";
  header: string;
}

// Widths are measured against the widest real value at 9pt Helvetica ("Mo,
// 16.06.2026" = 62.2pt, "08:00 – 16:30" = 55.0pt, "+123,45" = 32.8pt), so the
// left-over space can go to "Hinweis" — the only free-text column.
//
// "Abw." holds the paid time credited for leave or sickness. It earns a column
// of its own because the Soll column still states the contract: without it a
// week of holiday prints as Ist 0 / Soll 30 / Saldo 0 and the page never says
// where the thirty hours went.
const COLUMNS: Cols[] = [
  { x: MARGIN, w: 72, align: "left", header: "Datum" },
  { x: MARGIN + 72, w: 62, align: "left", header: "Zeiten" },
  { x: MARGIN + 134, w: 44, align: "right", header: "Ist" },
  { x: MARGIN + 178, w: 44, align: "right", header: "Pause" },
  { x: MARGIN + 222, w: 44, align: "right", header: "Abw." },
  { x: MARGIN + 266, w: 44, align: "right", header: "Soll" },
  { x: MARGIN + 310, w: 48, align: "right", header: "Saldo" },
  // 6pt gap so the right-aligned Saldo never touches the note text.
  { x: MARGIN + 364, w: A4.w - MARGIN - (MARGIN + 364), align: "left", header: "Hinweis" },
];

const NOTE_SIZE = 9;
const NOTE_MAX_LINES = 3;
const NOTE_LINE_HEIGHT = 9.5;
const ROW_HEIGHT = 13;

/**
 * Break `text` into at most `maxLines` lines that each fit `width` when drawn in
 * `font` at `size`; the last line is ellipsised when text remains. Measured with
 * the embedded font, because an unwrapped note in the narrow "Hinweis" column
 * runs off the MediaBox and is silently clipped by the viewer.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  maxLines: number,
): string[] {
  const safe = san(text).replace(/\s+/g, " ").trim();
  if (!safe) return [];
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;

  const lines: string[] = [];
  let cur = "";
  for (const word of safe.split(" ")) {
    let w = word;
    // A single word wider than the column has to be broken mid-word.
    while (!fits(w) && w.length > 1) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      let cut = w.length - 1;
      while (cut > 1 && !fits(w.slice(0, cut))) cut -= 1;
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const candidate = cur ? `${cur} ${w}` : w;
    if (!cur || fits(candidate)) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 0 && !fits(`${last}…`)) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** A cursor that draws top-to-bottom and starts a new page when it runs out. */
class Cursor {
  doc: PDFDocument;
  page!: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y = 0;
  pageNum = 0;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.pageNum += 1;
    this.y = A4.h - MARGIN;
    this.page.drawText(san(`Seite ${this.pageNum}`), {
      x: A4.w - MARGIN - 50, y: MARGIN - 24, size: 8, font: this.font, color: MUTED,
    });
  }

  ensure(space: number): void {
    if (this.y - space < MARGIN + 10) this.newPage();
  }

  text(s: string, opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}): void {
    const size = opts.size ?? 10;
    this.page.drawText(san(s), {
      x: opts.x ?? MARGIN,
      y: this.y,
      size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
  }

  cell(
    s: string,
    col: Cols,
    opts: { bold?: boolean; color?: ReturnType<typeof rgb>; size?: number; dy?: number } = {},
  ): void {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.font;
    const safe = san(s);
    let x = col.x;
    if (col.align === "right") {
      const width = font.widthOfTextAtSize(safe, size);
      x = col.x + col.w - width;
    }
    this.page.drawText(safe, { x, y: this.y - (opts.dy ?? 0), size, font, color: opts.color ?? INK });
  }

  /** Draw pre-wrapped lines inside a column, top line on the current baseline. */
  cellLines(lines: string[], col: Cols, opts: { color?: ReturnType<typeof rgb>; size?: number } = {}): void {
    lines.forEach((line, i) => this.cell(line, col, { ...opts, dy: i * NOTE_LINE_HEIGHT }));
  }

  /** Draw a full-width paragraph, wrapped to the text column. Returns its height. */
  paragraph(
    s: string,
    opts: { size?: number; color?: ReturnType<typeof rgb>; bold?: boolean; maxLines?: number } = {},
  ): void {
    const size = opts.size ?? 9;
    const lines = wrapText(
      s,
      opts.bold ? this.bold : this.font,
      size,
      A4.w - 2 * MARGIN,
      opts.maxLines ?? 4,
    );
    for (const line of lines) {
      this.ensure(size + 3);
      this.text(line, { size, color: opts.color, bold: opts.bold });
      this.move(size + 2.5);
    }
  }

  move(dy: number): void {
    this.y -= dy;
  }

  hline(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.w - MARGIN, y: this.y },
      thickness: 0.5,
      color: LINE,
    });
  }
}

/** Render the monthly report to PDF bytes. */
export async function monthlyReportPdf(report: MonthlyReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Monatsabrechnung ${report.user.name} ${report.monthLabel}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = new Cursor(doc, font, bold);

  // ── Header ──
  c.text(report.companyName, { bold: true, size: 16, color: TEAL });
  c.move(20);
  c.text(`Monatsabrechnung — ${report.monthLabel}`, { bold: true, size: 12 });
  c.move(16);
  c.text(`${report.user.name}  ·  ${report.user.email}`, { size: 10, color: MUTED });
  c.move(12);
  c.text(
    `Region: ${report.user.region}${report.user.isMinijob ? "  ·  Minijob (MiLoG §17)" : ""}  ·  Erstellt am ${formatDayKey(report.generatedAtKey)}`,
    { size: 9, color: MUTED },
  );
  c.move(18);
  c.hline();
  c.move(14);

  // ── Open-entry warning ──
  // Without this the affected day looks exactly like a day that was not worked.
  if (report.hasOpenAnomaly) {
    c.paragraph(OPEN_ENTRY_WARNING, { size: 9, color: DANGER, bold: true, maxLines: 4 });
    c.move(6);
  }

  // ── Automatically booked breaks ──
  // The Pause and Ist columns then contain time nobody clocked; the document has
  // to say so itself, not leave it to be inferred from a per-day marker.
  if (report.hasAutoBreak) {
    c.paragraph(AUTO_BREAK_WARNING, { size: 9, color: MUTED, maxLines: 4 });
    c.move(6);
  }

  // ── Table header ──
  for (const col of COLUMNS) c.cell(col.header, col, { bold: true, color: MUTED, size: 8 });
  c.move(6);
  c.hline();
  c.move(12);

  // ── Day rows ──
  const noteCol = COLUMNS[7]!;
  for (const d of report.days) {
    const h = dayHours(d);
    const noteLines = wrapText(
      dayNote(d, "ArbZG"),
      font,
      NOTE_SIZE,
      noteCol.w,
      NOTE_MAX_LINES,
    );
    const rowHeight = ROW_HEIGHT + Math.max(0, noteLines.length - 1) * NOTE_LINE_HEIGHT;

    c.ensure(rowHeight + 1);
    if (c.y === A4.h - MARGIN) {
      // fresh page from ensure(): redraw the column header
      for (const col of COLUMNS) c.cell(col.header, col, { bold: true, color: MUTED, size: 8 });
      c.move(6);
      c.hline();
      c.move(12);
    }
    const balColor = h.balance < 0 ? DANGER : INK;
    c.cell(formatDayKey(d.dayKey), COLUMNS[0]!);
    c.cell(d.span, COLUMNS[1]!);
    c.cell(h.worked > 0 ? hoursDec(h.worked) : "—", COLUMNS[2]!);
    c.cell(h.breakTime > 0 ? hoursDec(h.breakTime) : "—", COLUMNS[3]!);
    c.cell(h.absence > 0 ? hoursDec(h.absence) : "—", COLUMNS[4]!);
    c.cell(h.expected > 0 ? hoursDec(h.expected) : "—", COLUMNS[5]!);
    c.cell(h.worked > 0 || h.expected > 0 ? signedDec(h.balance) : "—", COLUMNS[6]!, { color: balColor });
    c.cellLines(noteLines, noteCol, {
      size: NOTE_SIZE,
      color: d.flagged || d.hasOpenAnomaly ? DANGER : MUTED,
    });
    c.move(rowHeight);
  }

  // ── Totals ──
  // Built from the values as printed above, so the columns add up to this row.
  const totals = displayTotals(report);
  c.ensure(totals.balanceToDateHours === null ? 30 : 44);
  c.move(2);
  c.hline();
  c.move(13);
  c.cell("Summe", COLUMNS[0]!, { bold: true });
  c.cell(hoursDec(totals.workedHours), COLUMNS[2]!, { bold: true });
  c.cell(hoursDec(totals.breakHours), COLUMNS[3]!, { bold: true });
  c.cell(hoursDec(totals.absenceHours), COLUMNS[4]!, { bold: true });
  c.cell(hoursDec(totals.expectedHours), COLUMNS[5]!, { bold: true });
  c.cell(signedDec(totals.balanceHours), COLUMNS[6]!, {
    bold: true,
    color: totals.balanceHours < 0 ? DANGER : INK,
  });
  if (totals.balanceToDateHours !== null) {
    c.cell("Saldo = Ist + Abw. - Soll (ganzer Monat)", noteCol, { size: 7.5, color: MUTED });
    // Mid-month, the running balance is not Ist + Abw − Soll (days not yet owed
    // are in the Soll column) — its own labelled row instead of overloading it.
    c.move(12);
    c.cell("Saldo (Stand heute)", COLUMNS[0]!, { size: 9, color: MUTED });
    c.cell(signedDec(totals.balanceToDateHours), COLUMNS[6]!, {
      color: totals.balanceToDateHours < 0 ? DANGER : INK,
    });
    c.cell(`nur Tage bis ${formatDayKey(report.generatedAtKey)}`, noteCol, { size: 7.5, color: MUTED });
  }
  c.move(22);

  // ── Absences ──
  if (report.absences.length > 0) {
    c.ensure(40);
    c.text("Abwesenheiten im Monat", { bold: true, size: 11, color: TEAL });
    c.move(15);
    for (const a of report.absences) {
      c.ensure(13);
      c.text(
        `${a.type === "VACATION" ? "Urlaub" : "Krank"}: ${formatDayKey(a.from)} – ${formatDayKey(a.to)} (${a.days} Tage)${a.note ? " · " + a.note : ""}`,
        { size: 9, color: INK },
      );
      c.move(12);
    }
    c.move(8);
  }

  // ── Violations ──
  if (report.violations.length > 0) {
    c.ensure(40);
    c.text("ArbZG-Hinweise", { bold: true, size: 11, color: TEAL });
    c.move(15);
    for (const v of report.violations) {
      c.ensure(13);
      c.text(`${formatDayKey(v.date)}: ${v.message}`, { size: 8, color: DANGER });
      c.move(11);
    }
    c.move(8);
  }

  // ── Legal footer ──
  c.ensure(40);
  c.move(6);
  c.hline();
  c.move(12);
  c.text(
    `Erzeugt mit ${BRAND.appName}. Arbeitszeit-Hinweise beruhen auf einem konfigurierbaren Regelprofil und sind`,
    { size: 7.5, color: MUTED },
  );
  c.move(9);
  c.text("rechtlich vom Betrieb zu prüfen. Aufbewahrung gemäß den gesetzlichen Fristen (ArbZG/MiLoG, GoBD).", {
    size: 7.5,
    color: MUTED,
  });

  return doc.save();
}
