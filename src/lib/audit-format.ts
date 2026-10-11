// Human-friendly presentation of audit-log entries for the admin "Protokoll"
// view. This module is pure (no DB, no React) so it can be unit-tested and so
// all German/timezone formatting stays in one place.
//
// The audit trail stores technical action keys ("user.deactivate") and raw
// JSON old/new snapshots. On their own those are unreadable for the people who
// actually look at the log (the Verwaltung). Here we translate every known
// action into a plain-German label + category, and turn each payload into a
// short, readable summary of what changed.

import {
  berlinDayKey,
  formatClock,
  formatDayKey,
  formatDays,
} from "@/lib/time";

/** Minimal shape the view-model builder needs from an audit row. */
export interface AuditRowInput {
  id: string;
  createdAt: Date;
  action: string;
  actorName: string | null;
  subjectName: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
}

/**
 * A fully pre-formatted log row, ready to hand to a client component. Every
 * field is a plain string (or null) so it serializes cleanly and all
 * date/timezone formatting stays on the server.
 */
export interface AuditRowView {
  id: string;
  dateLabel: string; // "Mo, 16.06.2026"
  timeLabel: string; // "08:30"
  category: AuditCategory;
  categoryLabel: string;
  actionLabel: string;
  tone: BadgeTone;
  actorName: string;
  subjectName: string | null;
  detail: AuditDetail;
  reason: string | null;
}

/** Build the display view-model for one audit row. */
export function toAuditRowView(row: AuditRowInput): AuditRowView {
  const { label, category } = describeAction(row.action);
  const meta = CATEGORY_META[category];
  return {
    id: row.id,
    dateLabel: formatDayKey(berlinDayKey(row.createdAt)),
    timeLabel: formatClock(row.createdAt),
    category,
    categoryLabel: meta.label,
    actionLabel: label,
    tone: DESTRUCTIVE.has(row.action) ? "danger" : meta.tone,
    actorName: row.actorName ?? "System",
    subjectName: row.subjectName,
    detail: summarizeDetail(row.action, row.oldValue, row.newValue),
    reason: row.reason,
  };
}

// ── Categories ───────────────────────────────────────────────────────────────

export type AuditCategory =
  | "zeit"
  | "korrektur"
  | "abwesenheit"
  | "konto"
  | "feiertag"
  | "einstellung"
  | "system";

// Kept in sync with the tones supported by <Badge>.
export type BadgeTone =
  | "neutral"
  | "teal"
  | "lime"
  | "warning"
  | "danger"
  | "info";

export interface CategoryMeta {
  label: string;
  tone: BadgeTone;
}

export const CATEGORY_META: Record<AuditCategory, CategoryMeta> = {
  zeit: { label: "Zeiterfassung", tone: "teal" },
  korrektur: { label: "Korrekturen", tone: "info" },
  abwesenheit: { label: "Abwesenheiten", tone: "lime" },
  konto: { label: "Konten", tone: "warning" },
  feiertag: { label: "Feiertage", tone: "info" },
  einstellung: { label: "Einstellungen", tone: "neutral" },
  system: { label: "System", tone: "neutral" },
};

// Actions whose outcome is a removal / deactivation / rejection. These are
// tinted red regardless of their category, so a scan of the log surfaces them.
const DESTRUCTIVE = new Set<string>([
  "correction.reject",
  "absence.reject",
  "absence.admin.cancel",
  "user.deactivate",
  "user.anonymize",
  "holiday.delete",
]);

// ── Action → friendly label + category ───────────────────────────────────────

interface ActionMeta {
  label: string;
  category: AuditCategory;
}

const ACTIONS: Record<string, ActionMeta> = {
  // Zeiterfassung
  "timeentry.create": { label: "Eintrag angelegt", category: "zeit" },
  "timeentry.correct": { label: "Eintrag korrigiert", category: "zeit" },
  "timeentry.break-remove": { label: "Pause entfernt (laut Angabe)", category: "zeit" },
  "timeentry.remove": { label: "Eintrag aus der Wertung genommen", category: "zeit" },

  // Korrekturen
  "correction.submit": { label: "Korrektur beantragt", category: "korrektur" },
  "correction.approve": { label: "Korrektur genehmigt", category: "korrektur" },
  "correction.reject": { label: "Korrektur abgelehnt", category: "korrektur" },

  // Abwesenheiten
  "absence.vacation.request": { label: "Urlaub beantragt", category: "abwesenheit" },
  "absence.sick.record": { label: "Krankmeldung erfasst", category: "abwesenheit" },
  "absence.approve": { label: "Abwesenheit genehmigt", category: "abwesenheit" },
  "absence.reject": { label: "Abwesenheit abgelehnt", category: "abwesenheit" },
  "absence.withdraw": { label: "Abwesenheit zurückgezogen", category: "abwesenheit" },
  "absence.creditback": { label: "Urlaub gutgeschrieben (§ 9 BUrlG)", category: "abwesenheit" },
  "absence.admin.vacation": { label: "Urlaub eingetragen (Verwaltung)", category: "abwesenheit" },
  "absence.admin.sick": { label: "Krankheit eingetragen (Verwaltung)", category: "abwesenheit" },
  "absence.admin.correct": { label: "Abwesenheit korrigiert (Verwaltung)", category: "abwesenheit" },
  "absence.admin.cancel": { label: "Abwesenheit storniert (Verwaltung)", category: "abwesenheit" },
  "absence.recount": { label: "Urlaubstage neu berechnet", category: "abwesenheit" },
  "user.entitlement.update": { label: "Urlaubsanspruch geändert", category: "abwesenheit" },
  "user.carryover.remind": { label: "Urlaubs-Hinweis versendet", category: "abwesenheit" },

  // Konten
  "user.create": { label: "Konto angelegt", category: "konto" },
  "user.update": { label: "Stammdaten geändert", category: "konto" },
  "user.schedule.add": { label: "Arbeitszeitmodell hinzugefügt", category: "konto" },
  "user.schedule.update": { label: "Arbeitszeitmodell geändert", category: "konto" },
  "user.activate": { label: "Konto aktiviert", category: "konto" },
  "user.deactivate": { label: "Konto deaktiviert", category: "konto" },
  "user.password.reset": { label: "Passwort zurückgesetzt", category: "konto" },
  "user.password.change": { label: "Passwort geändert", category: "konto" },
  "user.anonymize": { label: "Konto anonymisiert (DSGVO)", category: "konto" },

  // Feiertage
  "holiday.seed": { label: "Feiertage importiert", category: "feiertag" },
  "holiday.gifted.add": { label: "Sonderfrei hinzugefügt", category: "feiertag" },
  "holiday.delete": { label: "Feiertag entfernt", category: "feiertag" },

  // Einstellungen
  "settings.general": { label: "Einstellungen · Allgemein", category: "einstellung" },
  "settings.rounding": { label: "Einstellungen · Rundung", category: "einstellung" },
  "settings.ruleProfile": { label: "Einstellungen · Regelprofil", category: "einstellung" },
  "settings.minorRuleProfile": { label: "Einstellungen · Jugend-Regelprofil", category: "einstellung" },
  "settings.correctionPolicy": { label: "Einstellungen · Korrektur-Governance", category: "einstellung" },
  "settings.punchPolicy": { label: "Einstellungen · Stempeln", category: "einstellung" },

  // Terminals (QR-Code am Eingang)
  "terminal.create": { label: "Terminal angelegt", category: "einstellung" },
  "terminal.pair-code": { label: "Kopplungslink für Terminal erzeugt", category: "einstellung" },
  "terminal.pair": { label: "Terminal gekoppelt", category: "einstellung" },
  "terminal.activate": { label: "Terminal aktiviert", category: "einstellung" },
  "terminal.deactivate": { label: "Terminal deaktiviert", category: "einstellung" },
};

/** Turn a raw dotted action key into a readable "Foo · Bar" fallback label. */
function prettifyAction(action: string): string {
  return action
    .split(".")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" · ");
}

/** Friendly label + category for an action key, with graceful fallbacks. */
export function describeAction(action: string): ActionMeta {
  const known = ACTIONS[action];
  if (known) return known;
  if (action.startsWith("settings."))
    return { label: prettifyAction(action), category: "einstellung" };
  return { label: prettifyAction(action), category: "system" };
}

// ── Small value helpers (Prisma JSON columns are typed `unknown`) ─────────────

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

// ── German label helpers ─────────────────────────────────────────────────────

const ROLE_DE: Record<string, string> = {
  ADMIN: "Administrator:in",
  EMPLOYEE: "Mitarbeiter:in",
};
const STATUS_DE: Record<string, string> = {
  PENDING: "beantragt",
  APPROVED: "genehmigt",
  REJECTED: "abgelehnt",
  WITHDRAWN: "zurückgezogen",
  CANCELLED: "storniert",
};
const FRACTION_DE: Record<string, string> = {
  FULL: "ganzer Tag",
  HALF: "halber Tag",
};
const BUNDESLAND_DE: Record<string, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAY_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "16.06.2026" — day key without the weekday prefix ("Mo, "). */
function shortDate(dayKey: string): string {
  return formatDayKey(dayKey).slice(4);
}

/** A German date range from two day keys: "15.06.2026–19.06.2026". */
function dateRange(from: string | null, to: string | null): string | null {
  if (!from) return null;
  if (!to || to === from) return shortDate(from);
  return `${shortDate(from)}–${shortDate(to)}`;
}

/** Plain number in German notation (37.5 → "37,5", 40 → "40"). */
function numDe(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

function boolDe(v: unknown): string {
  const b = asBool(v);
  return b === null ? "—" : b ? "Ja" : "Nein";
}

/** A day count with the correct singular/plural noun: "1 Tag", "5 Tage". */
function daysLabel(n: number): string {
  return `${formatDays(n)} ${n === 1 ? "Tag" : "Tage"}`;
}

// ── Change summary ───────────────────────────────────────────────────────────

/**
 * A rendered description of what an entry changed. `from`/`to` produce a
 * struck-through "before → after" pair; `text` is a single descriptive line.
 * An empty object means "nothing worth showing" (the label + reason suffice).
 */
export interface AuditDetail {
  from?: string;
  to?: string;
  text?: string;
}

/** Render a {type,start,end} time-entry snapshot as "Arbeit 16.06.2026 08:00–17:00". */
function entryLabel(v: unknown): string | undefined {
  const o = asObj(v);
  const startS = o && asStr(o.start);
  if (!o || !startS) return undefined;
  const start = new Date(startS);
  const endS = asStr(o.end);
  const end = endS ? new Date(endS) : null;
  const kind = o.type === "BREAK" ? "Pause" : "Arbeit";
  return `${kind} ${shortDate(berlinDayKey(start))} ${formatClock(start)}–${
    end ? formatClock(end) : "offen"
  }`;
}

/** "15.06.2026–19.06.2026 · 5 Tage" from a {from,to,days} payload. */
function rangeWithDays(v: unknown): string | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const range = dateRange(asStr(o.from), asStr(o.to));
  const days = asNum(o.days);
  const dl = days !== null ? daysLabel(days) : null;
  if (range && dl) return `${range} · ${dl}`;
  return range ?? dl ?? undefined;
}

/** "Urlaub · 20.07.2026 – 06.08.2026 · 14 Tage" — one side of a correction. */
function absenceLabel(v: unknown): string | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const type = asStr(o.type);
  const kind = type === "SICK" ? "Krankheit" : type === "VACATION" ? "Urlaub" : null;
  const rest = rangeWithDays(v);
  return [kind, rest].filter(Boolean).join(" · ") || undefined;
}

/** "ab 01.07.2026 · 40 h/Woche (Mo 8 · Di 8 · Mi 8 · Do 8 · Fr 8)". */
function scheduleText(v: unknown): string | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const parts: string[] = [];
  const eff = asStr(o.effectiveFrom);
  if (eff) parts.push(`ab ${shortDate(eff)}`);
  const hours = asObj(o.hours);
  let weekly = asNum(o.weekly);
  if (weekly === null && hours) {
    weekly = WEEKDAY_KEYS.reduce((sum, k) => sum + (asNum(hours[k]) ?? 0), 0);
  }
  if (weekly !== null) parts.push(`${numDe(weekly)} h/Woche`);
  const head = parts.join(" · ");
  if (hours) {
    const breakdown = WEEKDAY_KEYS.map((k, i) => {
      const h = asNum(hours[k]) ?? 0;
      return h > 0 ? `${WEEKDAY_DE[i]} ${numDe(h)}` : null;
    })
      .filter((x): x is string => x !== null)
      .join(" · ");
    if (breakdown) return head ? `${head} (${breakdown})` : `(${breakdown})`;
  }
  return head || undefined;
}

interface FieldSpec {
  key: string;
  label: string;
  format: (v: unknown) => string;
}

const strOrDash = (v: unknown) => asStr(v) ?? "—";
const roleOrDash = (v: unknown) => {
  const s = asStr(v);
  return s ? ROLE_DE[s] ?? s : "—";
};
const bundeslandOrDash = (v: unknown) => {
  const s = asStr(v);
  return s ? BUNDESLAND_DE[s] ?? s : "—";
};
const daysOrDash = (v: unknown) => {
  const n = asNum(v);
  return n !== null ? formatDays(n) : "—";
};

const USER_FIELDS: FieldSpec[] = [
  { key: "name", label: "Name", format: strOrDash },
  { key: "email", label: "E-Mail", format: strOrDash },
  { key: "role", label: "Rolle", format: roleOrDash },
  { key: "bundesland", label: "Bundesland", format: bundeslandOrDash },
  { key: "isMinijob", label: "Minijob", format: boolDe },
  { key: "exemptFromTimeRecording", label: "Von der Zeiterfassung befreit", format: boolDe },
  { key: "exemptFromAutoBreak", label: "Ohne automatischen Pausenabzug", format: boolDe },
];

const ENTITLEMENT_FIELDS: FieldSpec[] = [
  { key: "vacationDaysPerYear", label: "Urlaubstage/Jahr", format: daysOrDash },
  { key: "vacationCarryOverDays", label: "Übertrag", format: daysOrDash },
  { key: "isSchwerbehindert", label: "Schwerbehindert", format: boolDe },
];

/** List only the fields that actually changed, as "Feld: alt → neu". */
function diffFields(
  oldValue: unknown,
  newValue: unknown,
  specs: FieldSpec[],
): string | undefined {
  const o = asObj(oldValue) ?? {};
  const n = asObj(newValue) ?? {};
  const parts = specs
    .map((s) => {
      const before = s.format(o[s.key]);
      const after = s.format(n[s.key]);
      return before === after ? null : `${s.label}: ${before} → ${after}`;
    })
    .filter((x): x is string => x !== null);
  return parts.length ? parts.join(" · ") : undefined;
}

function createUserText(v: unknown): string | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const parts: string[] = [];
  const name = asStr(o.name);
  if (name) parts.push(name);
  const email = asStr(o.email);
  if (email) parts.push(email);
  const role = asStr(o.role);
  if (role) parts.push(ROLE_DE[role] ?? role);
  const weekly = asNum(o.weeklyHours);
  if (weekly !== null) parts.push(`${numDe(weekly)} h/Woche`);
  // After a DSGVO anonymisation the name and the e-mail both hold the same
  // redaction marker; printing it twice reads like a bug. Collapse repeats.
  const shown = parts.filter((p, i) => p !== parts[i - 1]);
  return shown.length ? shown.join(" · ") : undefined;
}

function holidaySeedText(v: unknown): string | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const code = asStr(o.region);
  const region = code ? BUNDESLAND_DE[code] ?? code : "bundesweit";
  const year = asNum(o.year);
  const created = asNum(o.created) ?? 0;
  const holidayWord = created === 1 ? "Feiertag" : "Feiertage";
  return `${region}${year !== null ? ` ${year}` : ""} · ${created} ${holidayWord}`;
}

function holidayText(v: unknown): string | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const parts: string[] = [];
  const dayKey = asStr(o.dayKey);
  if (dayKey) parts.push(shortDate(dayKey));
  const name = asStr(o.name);
  if (name) parts.push(name);
  const fraction = asStr(o.fraction);
  if (fraction) parts.push(FRACTION_DE[fraction] ?? fraction);
  if (asBool(o.recurringAnnually)) parts.push("jährlich");
  return parts.length ? parts.join(" · ") : undefined;
}

function statusChange(oldValue: unknown, newValue: unknown): AuditDetail {
  const o = asObj(oldValue);
  const n = asObj(newValue);
  const from = o && asStr(o.status);
  const to = n && asStr(n.status);
  return {
    from: from ? STATUS_DE[from] ?? from : undefined,
    to: to ? STATUS_DE[to] ?? to : undefined,
  };
}

/** Build the change summary for one audit row. */
export function summarizeDetail(
  action: string,
  oldValue: unknown,
  newValue: unknown,
): AuditDetail {
  switch (action) {
    case "timeentry.create":
    case "correction.submit":
      return { to: entryLabel(newValue) };
    case "timeentry.correct":
      return { from: entryLabel(oldValue), to: entryLabel(newValue) };
    case "timeentry.break-remove":
    case "timeentry.remove":
      return { from: entryLabel(oldValue) };

    case "absence.vacation.request": {
      const base = rangeWithDays(newValue);
      const o = asObj(newValue);
      const halfCount =
        (o && asBool(o.halfDayStart) ? 1 : 0) + (o && asBool(o.halfDayEnd) ? 1 : 0);
      const suffix =
        halfCount === 0 ? "" : halfCount === 1 ? " · mit halbem Tag" : " · mit halben Tagen";
      return { text: base ? `${base}${suffix}` : undefined };
    }
    case "absence.sick.record": {
      const base = rangeWithDays(newValue);
      const o = asObj(newValue);
      const note = o ? asBool(o.sickNoteOnFile) : null;
      const suffix = note === null ? "" : note ? " · AU liegt vor" : " · ohne AU";
      return { text: base ? `${base}${suffix}` : undefined };
    }
    case "absence.admin.vacation":
    case "absence.admin.sick":
      return { text: rangeWithDays(newValue) };
    // A correction is only legible as a before/after pair: which range and which
    // type the record used to be, and what it is now.
    case "absence.admin.correct":
      return { from: absenceLabel(oldValue), to: absenceLabel(newValue) };
    case "absence.admin.cancel":
      return { from: absenceLabel(oldValue), to: "storniert" };
    case "absence.recount": {
      const o = asObj(oldValue);
      const n = asObj(newValue);
      const before = o && asNum(o.days);
      const after = n && asNum(n.days);
      return {
        from: typeof before === "number" ? daysLabel(before) : undefined,
        to: typeof after === "number" ? daysLabel(after) : undefined,
      };
    }
    case "absence.approve":
    case "absence.reject":
      return statusChange(oldValue, newValue);
    case "absence.creditback": {
      const o = asObj(oldValue);
      const n = asObj(newValue);
      const before = o && asNum(o.days);
      const after = n && asNum(n.days);
      return {
        from: typeof before === "number" ? daysLabel(before) : undefined,
        to: typeof after === "number" ? daysLabel(after) : undefined,
      };
    }

    case "user.create":
      return { text: createUserText(newValue) };
    case "user.update":
      return { text: diffFields(oldValue, newValue, USER_FIELDS) };
    case "user.entitlement.update":
      return { text: diffFields(oldValue, newValue, ENTITLEMENT_FIELDS) };
    case "user.schedule.add":
    case "user.schedule.update":
      return { text: scheduleText(newValue) };
    case "user.activate":
    case "user.deactivate": {
      const o = asObj(oldValue);
      const n = asObj(newValue);
      const before = o ? asBool(o.active) : null;
      const after = n ? asBool(n.active) : null;
      const de = (b: boolean | null) => (b === null ? undefined : b ? "aktiv" : "inaktiv");
      return { from: de(before), to: de(after) };
    }

    case "holiday.seed":
      return { text: holidaySeedText(newValue) };
    case "holiday.gifted.add":
      return { text: holidayText(newValue) };
    case "holiday.delete":
      return { text: holidayText(oldValue) };

    // No meaningful payload — the label (and reason, where present) says it all:
    // correction.approve/reject, absence.withdraw, user.password.*,
    // user.carryover.remind, user.anonymize, settings.*
    default:
      return {};
  }
}
