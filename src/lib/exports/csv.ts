// CSV exporters. German/Excel conventions: semicolon delimiter, decimal comma,
// CRLF line endings and a UTF-8 BOM (so Excel detects the encoding and umlauts
// render). Use `csvBytes()` to get the final downloadable buffer.

import { formatDayKey, RECORDING_STATE_LABEL, recordingIssueText } from "@/lib/time";
import {
  dayHours,
  dayNote,
  displayHours,
  displayTotals,
  OPEN_ENTRY_WARNING,
  AUTO_BREAK_WARNING,
  type MonthlyReport,
} from "./report";
import { ABSENCE_LABEL } from "@/lib/time/absence-kinds";

/**
 * Escape one field for semicolon-delimited CSV.
 *
 * Also neutralises spreadsheet formula injection. Excel and LibreOffice evaluate
 * a leading `=`, `+`, `-` or `@` on import — even inside quotes — so a free-text
 * note or an employee name is an injection vector into the payroll file that an
 * admin opens. Prefixing a single quote makes the cell inert and is the standard
 * OWASP mitigation; the visible text is unchanged in the spreadsheet.
 */
function field(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cells: (string | number)[]): string {
  return cells.map(field).join(";");
}

/** Decimal hours with a German decimal comma, e.g. 8.5 → "8,50". */
function deci(hours: number): string {
  return hours.toFixed(2).replace(".", ",");
}

/** Milliseconds as decimal hours with a German decimal comma. */
function hoursDecimal(ms: number): string {
  return deci(displayHours(ms));
}

/** Wrap CSV text as a downloadable UTF-8 buffer with a BOM. */
export function csvBytes(text: string): Uint8Array {
  const bom = "﻿";
  return new TextEncoder().encode(bom + text);
}

/** Payroll-ready monthly timesheet for one employee. */
export function monthlyReportCsv(report: MonthlyReport): string {
  const lines: string[] = [];
  lines.push(row([report.companyName]));
  lines.push(row(["Monatsabrechnung", report.monthLabel]));
  lines.push(row(["Mitarbeiter:in", report.user.name]));
  lines.push(row(["E-Mail", report.user.email]));
  if (report.user.isMinijob) lines.push(row(["Beschäftigung", "Minijob (MiLoG §17)"]));
  lines.push(row(["Erstellt am", formatDayKey(report.generatedAtKey)]));
  // A forgotten clock-out means a worked day is missing from the figures below —
  // say so at the top, not only in the affected row.
  if (report.hasOpenAnomaly) lines.push(row(["WARNUNG", OPEN_ENTRY_WARNING]));
  // Pause/Ist then contain time nobody clocked — say so on the document itself.
  if (report.hasAutoBreak) lines.push(row(["HINWEIS", AUTO_BREAK_WARNING]));
  lines.push("");

  // "Abwesenheit" is the paid time credited for leave/sickness. It has its own
  // column because the Soll column still states the contract: without it, a
  // week of holiday reads as Ist 0 / Soll 30 / Saldo 0 and nothing on the page
  // explains where the 30 hours went.
  lines.push(
    row([
      "Datum",
      "Zeiten",
      "Ist (Std)",
      "Pause (Std)",
      "Abwesenheit (Std)",
      "Soll (Std)",
      "Saldo (Std)",
      "Hinweis",
    ]),
  );
  for (const d of report.days) {
    const h = dayHours(d);
    lines.push(
      row([
        formatDayKey(d.dayKey),
        d.span,
        deci(h.worked),
        deci(h.breakTime),
        deci(h.absence),
        deci(h.expected),
        deci(h.balance),
        dayNote(d, "ArbZG-Hinweis"),
      ]),
    );
  }
  lines.push("");
  // Totals are the sums of the values as printed above, so the column adds up.
  const totals = displayTotals(report);
  lines.push(
    row([
      "Summe",
      "",
      deci(totals.workedHours),
      deci(totals.breakHours),
      deci(totals.absenceHours),
      deci(totals.expectedHours),
      deci(totals.balanceHours),
      totals.balanceToDateHours === null
        ? ""
        : "Saldo = Ist + Abwesenheit − Soll (ganzer Monat)",
    ]),
  );
  // Mid-month the running balance differs from Ist − Soll (future days are not
  // owed yet) — report it as its own labelled figure instead of overloading "Saldo".
  if (totals.balanceToDateHours !== null) {
    lines.push(
      row([
        "Saldo (Stand heute)",
        "",
        "",
        "",
        "",
        "",
        deci(totals.balanceToDateHours),
        `nur Tage bis ${formatDayKey(report.generatedAtKey)}`,
      ]),
    );
  }

  if (report.absences.length > 0) {
    lines.push("");
    lines.push(row(["Abwesenheiten im Monat"]));
    for (const a of report.absences) {
      lines.push(
        row([
          ABSENCE_LABEL[a.type],
          `${formatDayKey(a.from)} – ${formatDayKey(a.to)}`,
          `${a.days} Tage`,
          a.note ?? "",
        ]),
      );
    }
  }

  if (report.violations.length > 0) {
    lines.push("");
    lines.push(row(["ArbZG-Hinweise"]));
    for (const v of report.violations) {
      lines.push(row([formatDayKey(v.date), v.severity === "BLOCK" ? "Verstoß" : "Hinweis", v.message]));
    }
  }

  if (report.recordingIssues.length > 0) {
    lines.push("");
    lines.push(row(["MiLoG §17 – Aufzeichnungsfrist"]));
    for (const r of report.recordingIssues) {
      lines.push(row([formatDayKey(r.dayKey), RECORDING_STATE_LABEL[r.state], recordingIssueText(r)]));
    }
  }

  return lines.join("\r\n");
}

export interface RawEntryRow {
  employeeName: string;
  type: "WORK" | "BREAK";
  startKey: string;
  startClock: string;
  endClock: string;
  workedMs: number;
  source: "CLOCK" | "MANUAL";
  status: "ACTIVE" | "SUPERSEDED";
  note: string | null;
}

/** Raw recorded entries (one row per punch interval) for inspection / Zoll export. */
export function rawEntriesCsv(rows: RawEntryRow[]): string {
  const lines: string[] = [];
  lines.push(
    row(["Mitarbeiter:in", "Datum", "Art", "Von", "Bis", "Dauer (Std)", "Erfassung", "Status", "Anmerkung"]),
  );
  for (const r of rows) {
    lines.push(
      row([
        r.employeeName,
        formatDayKey(r.startKey),
        r.type === "WORK" ? "Arbeit" : "Pause",
        r.startClock,
        r.endClock,
        hoursDecimal(r.workedMs),
        r.source === "MANUAL" ? "manuell" : "Stempeluhr",
        r.status === "ACTIVE" ? "aktiv" : "ersetzt",
        r.note ?? "",
      ]),
    );
  }
  return lines.join("\r\n");
}
