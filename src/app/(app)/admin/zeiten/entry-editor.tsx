"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, PencilLine, MoonStar, Trash2, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  adminCorrectEntryAction,
  adminRemoveEntryAction,
  type EntryEditState,
} from "./actions";

export interface EditableEntry {
  id: string;
  userId: string;
  type: "WORK" | "BREAK";
  /** Berlin wall-clock "YYYY-MM-DDTHH:mm" — the TRUE, un-clipped bounds. */
  startLocal: string;
  endLocal: string | null;
  dayLabel: string;
  startClock: string;
  endClock: string;
  source: "CLOCK" | "MANUAL";
  /** How each punch behind this entry arrived; empty for corrections/backfills. */
  punches: { edge: "Beginn" | "Ende"; via: string }[];
  /** Start and end fall on different Berlin days. */
  crossesMidnight: boolean;
  /** Stored start is within the first minute of a Berlin day. */
  startsAtMidnight: boolean;
  note: string | null;
  /** Raw instants, for spotting entries that cover the same minutes. */
  startMs: number;
  endMs: number | null;
}

/**
 * Per-entry admin override list. This is the only place in the app where a
 * recorded time can be changed without an approval step and without the period
 * lock applying — see the action for why that is deliberate. Every change still
 * supersedes (never overwrites) the original and requires a reason.
 */
export function EntryEditor({ entries }: { entries: EditableEntry[] }) {
  const [state, action, pending] = useActionState<EntryEditState, FormData>(
    adminCorrectEntryAction,
    {},
  );
  const [rmState, rmAction, removing] = useActionState<EntryEditState, FormData>(
    adminRemoveEntryAction,
    {},
  );
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

  // Same person, same type, overlapping minutes — the shift recorded twice.
  // Flagging it here is what turns "why do the hours look wrong" into an
  // obvious one-click cleanup.
  const duplicateIds = React.useMemo(() => {
    const dupes = new Set<string>();
    for (const a of entries) {
      for (const b of entries) {
        if (a.id === b.id || a.type !== b.type) continue;
        const aEnd = a.endMs ?? Number.MAX_SAFE_INTEGER;
        const bEnd = b.endMs ?? Number.MAX_SAFE_INTEGER;
        if (a.startMs < bEnd && b.startMs < aEnd) dupes.add(a.id);
      }
    }
    return dupes;
  }, [entries]);
  // A successful change supersedes the row and creates a new one with a fresh
  // id, so the edited entry simply disappears from this (ACTIVE-only) list and
  // the open editor closes on its own — no state juggling needed.
  const [openId, setOpenId] = React.useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        In diesem Monat sind keine Zeiten erfasst.
      </p>
    );
  }

  return (
    <>
      {state.ok && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
          <Check className="h-4 w-4" />
          Zeit geändert. Die vorherige Version bleibt als ersetzter Eintrag erhalten und steht
          mit Grund im Änderungsprotokoll.
        </p>
      )}
      {rmState.ok && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
          <Check className="h-4 w-4" />
          Eintrag aus der Wertung genommen. Er bleibt als ersetzter Eintrag im Rohdaten-Export
          und im Änderungsprotokoll sichtbar.
        </p>
      )}
      {rmState.error && !rmState.entryId && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          {rmState.error}
        </p>
      )}
      {duplicateIds.size > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {duplicateIds.size} Einträge überdecken dieselbe Zeit — dieselbe Schicht ist
            mehrfach erfasst. Solange mehrere davon aktiv sind, lässt sich keiner von ihnen
            korrigieren (jede Änderung kollidiert mit den übrigen). Bitte die überzähligen
            über <strong>Entfernen</strong> aus der Wertung nehmen und den verbleibenden
            anschließend korrigieren.
          </span>
        </p>
      )}
      <ul className="divide-y divide-black/[0.06]">
      {entries.map((e) => {
        const isOpen = openId === e.id;
        const isConfirming = confirmId === e.id;
        const showResult = state.entryId === e.id;
        return (
          <li key={e.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                  e.type === "WORK" ? "bg-lime" : "bg-amber-400"
                }`}
                aria-hidden
              />
              <span className="w-32 shrink-0 text-sm font-medium text-ink">{e.dayLabel}</span>
              <span className="w-16 shrink-0 text-sm text-muted">
                {e.type === "WORK" ? "Arbeit" : "Pause"}
              </span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {e.startClock} – {e.endClock}
              </span>
              {e.startsAtMidnight && (
                <Badge tone="danger">
                  Beginn 00:00
                </Badge>
              )}
              {e.crossesMidnight && (
                <Badge tone="warning">
                  <MoonStar className="h-3 w-3" />
                  über Mitternacht
                </Badge>
              )}
              {!e.endLocal && <Badge tone="danger">offen</Badge>}
              <Badge tone="neutral">
                {e.source === "MANUAL" ? "manuell" : "Stempeluhr"}
              </Badge>
              {duplicateIds.has(e.id) && (
                <Badge tone="warning">
                  <Copy className="h-3 w-3" />
                  doppelt erfasst
                </Badge>
              )}
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(isOpen ? null : e.id);
                    setConfirmId(null);
                  }}
                  aria-expanded={isOpen}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-teal hover:bg-surface"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  {isOpen ? "abbrechen" : "Ändern"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmId(isConfirming ? null : e.id);
                    setOpenId(null);
                  }}
                  aria-expanded={isConfirming}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-danger hover:bg-danger/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isConfirming ? "abbrechen" : "Entfernen"}
                </button>
              </span>
            </div>

            {e.punches.length > 0 && (
              <p className="mt-1 flex items-center gap-1 pl-[3.75rem] text-xs text-muted">
                <span>
                  Gestempelt:{" "}
                  {e.punches.map((p) => `${p.edge} über ${p.via}`).join(" — ")}
                </span>
                <InfoHint>{`Wie Beginn und Ende erfasst wurden: Erfassungsweg und grob erkannter Gerätetyp. Die Geräteangabe meldet der Browser selbst und kann verfälscht werden — sie ist ein Hinweis, kein Beweis. Standortdaten werden nicht erfasst.`}</InfoHint>
              </p>
            )}

            {e.note && (
              <p className="mt-1 pl-[3.75rem] text-xs text-muted">Anmerkung: {e.note}</p>
            )}

            {isConfirming && (
              <form action={rmAction} className="mt-3 space-y-3 rounded-xl border border-danger/20 bg-danger/[0.04] p-4">
                <input type="hidden" name="entryId" value={e.id} />
                <p className="text-sm text-ink">
                  <strong>
                    {e.type === "WORK" ? "Arbeit" : "Pause"} {e.dayLabel}, {e.startClock}–
                    {e.endClock}
                  </strong>{" "}
                  aus der Wertung nehmen? Die Zeit zählt danach nicht mehr in Nachweisen,
                  Saldo und Auswertungen. Gelöscht wird sie nicht: sie bleibt als{" "}
                  <em>ersetzt</em> im Rohdaten-Export und im Änderungsprotokoll — so verlangt
                  es die Revisionssicherheit.
                </p>

                <Field label="Grund" htmlFor={`rr-${e.id}`} required>
                  <Textarea
                    id={`rr-${e.id}`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="z. B. Doppelerfassung: dieselbe Schicht wurde dreifach angelegt, dieser Eintrag ist überzählig"
                  />
                </Field>

                {rmState.entryId === e.id && rmState.error && (
                  <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                    {rmState.error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-1.5">
                  <Button type="submit" variant="danger" disabled={removing}>
                    <Trash2 className="h-4 w-4" />
                    Endgültig aus der Wertung nehmen
                  </Button>
                  <InfoHint>{`Setzt den Eintrag auf „ersetzt". Er verschwindet aus allen Berechnungen, bleibt aber dauerhaft nachvollziehbar. Rückgängig machen lässt sich das über diese Oberfläche nicht — im Zweifel lieber korrigieren statt entfernen.`}</InfoHint>
                </div>
              </form>
            )}

            {isOpen && (
              <form action={action} className="mt-3 space-y-4 rounded-xl bg-surface p-4">
                <input type="hidden" name="entryId" value={e.id} />
                <input type="hidden" name="subjectUserId" value={e.userId} />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field
                    label="Art"
                    htmlFor={`t-${e.id}`}
                    info={`Arbeit zählt als Arbeitszeit, Pause wird von der Anwesenheit abgezogen.`}
                  >
                    <Select id={`t-${e.id}`} name="type" defaultValue={e.type}>
                      <option value="WORK">Arbeit</option>
                      <option value="BREAK">Pause</option>
                    </Select>
                  </Field>
                  <Field
                    label="Beginn"
                    htmlFor={`s-${e.id}`}
                    required
                    info={`Deutsche Ortszeit (Europe/Berlin). Dies ist der tatsächlich gespeicherte Beginn — bei einer Schicht über Mitternacht also der Vorabend, nicht die 00:00, die der Monatsnachweis am Folgetag anzeigt.`}
                  >
                    <Input
                      id={`s-${e.id}`}
                      name="start"
                      type="datetime-local"
                      defaultValue={e.startLocal}
                      required
                    />
                  </Field>
                  <Field
                    label="Ende"
                    htmlFor={`e-${e.id}`}
                    required
                    info={`Muss nach dem Beginn liegen. Ein noch offener Eintrag wird durch die Änderung abgeschlossen.`}
                  >
                    <Input
                      id={`e-${e.id}`}
                      name="end"
                      type="datetime-local"
                      defaultValue={e.endLocal ?? e.startLocal}
                      required
                    />
                  </Field>
                </div>

                <Field
                  label="Grund der Änderung"
                  htmlFor={`r-${e.id}`}
                  required
                  info={`Pflichtangabe (3–500 Zeichen). Wird zusammen mit dem alten und dem neuen Wert dauerhaft im Änderungsprotokoll gespeichert. Ohne Grund keine Änderung — das ist die Bedingung dafür, dass eine Verwaltungs-Korrektur revisionssicher bleibt (GoBD/ArbZG §16).`}
                >
                  <Textarea
                    id={`r-${e.id}`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="z. B. Beginn 00:00 stammt aus fehlerhaftem Nachtrag; tatsächlicher Beginn laut Schichtplan 06:00"
                  />
                </Field>

                {showResult && state.error && (
                  <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                    {state.error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-1.5">
                  <Button type="submit" disabled={pending}>
                    Verbindlich ändern
                  </Button>
                  <InfoHint>{`Wirkt sofort — ohne Antrag und ohne Genehmigung, und auch dann, wenn der Zeitraum für Mitarbeitende bereits gesperrt ist. Der bisherige Eintrag wird nicht gelöscht, sondern als „ersetzt" markiert und bleibt in Rohdaten-Export und Protokoll sichtbar.`}</InfoHint>
                </div>
              </form>
            )}
          </li>
        );
      })}
      </ul>
    </>
  );
}
