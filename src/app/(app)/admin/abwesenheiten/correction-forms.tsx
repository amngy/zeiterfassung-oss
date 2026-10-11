"use client";

// Retroactive correction of an absence that is already on file.
//
// The case this exists for: a holiday was approved 20.07. – 06.08., the person
// then fell ill, and the record has to say the holiday ended on 30.07. with a
// separate sick spell from 03.08. Before this, the only way to get there was to
// leave the wrong record standing (and keep charging the leave account for days
// that were sick days) — so correcting one is now a first-class action.
//
// Two deliberate choices in this form:
//   · the whole absence is edited at once, including its TYPE, because "it was
//     not leave, it was illness" is the correction people actually need;
//   · the reason is mandatory. The audit entry is what explains, months later,
//     why a booked holiday shrank.

import * as React from "react";
import { useActionState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import { formatDayKey, formatDays } from "@/lib/time";
import { ABSENCE_KINDS, ABSENCE_LABEL, isSicknessKind } from "@/lib/time/absence-kinds";
import type { AbsenceKind } from "@/lib/time/types";
import {
  cancelAbsenceAction,
  correctAbsenceAction,
  type AdminAbsenceState,
} from "./actions";
import type { EmployeeOption } from "./admin-forms";

/** One absence row as the admin screen needs it — plain data, no Prisma types. */
export interface CorrectableAbsence {
  id: string;
  userId: string;
  type: AbsenceKind;
  /** "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  sickNoteOnFile: boolean;
  creditedBackFromVacation: boolean;
  workingDaysCount: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  note: string | null;
  correctionReason: string | null;
}

const STATUS: Record<
  CorrectableAbsence["status"],
  { label: string; tone: "warning" | "lime" | "danger" | "neutral" }
> = {
  PENDING: { label: "beantragt", tone: "warning" },
  APPROVED: { label: "gebucht", tone: "lime" },
  REJECTED: { label: "abgelehnt", tone: "neutral" },
  CANCELLED: { label: "storniert", tone: "neutral" },
};

function Banner({ state }: { state: AdminAbsenceState }) {
  if (state.ok) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
        <Check className="h-4 w-4" />
        {state.message}
      </p>
    );
  }
  if (state.error) {
    return (
      <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
        {state.error}
      </p>
    );
  }
  return null;
}

export function AbsenceCorrectionPanel({
  employees,
  absences,
  year,
}: {
  employees: EmployeeOption[];
  absences: CorrectableAbsence[];
  year: number;
}) {
  const [selectedId, setSelectedId] = React.useState(employees[0]?.id ?? "");
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const rows = absences.filter((a) => a.userId === selectedId);
  // Only a record that is actually in force can be corrected or withdrawn; a
  // rejected or already-cancelled one is history and stays as it is.
  const isLive = (a: CorrectableAbsence) =>
    a.status === "PENDING" || a.status === "APPROVED";

  if (employees.length === 0) {
    return <p className="text-sm text-muted">Keine Mitarbeitenden vorhanden.</p>;
  }

  return (
    <div className="space-y-4">
      <Field label="Mitarbeiter:in" htmlFor="k-user">
        <Select
          id="k-user"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setEditingId(null);
          }}
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
      </Field>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          Für {year} ist für diese Person keine Abwesenheit erfasst.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const s = STATUS[a.status];
            const editing = editingId === a.id;
            return (
              <li key={a.id} className="rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    {ABSENCE_LABEL[a.type]} ·{" "}
                    {formatDayKey(a.startDate)} – {formatDayKey(a.endDate)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone={isSicknessKind(a.type) ? "info" : "neutral"}>
                      {formatDays(a.workingDaysCount)} Tage
                    </Badge>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {isLive(a) && (
                      <button
                        type="button"
                        onClick={() => setEditingId(editing ? null : a.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-teal hover:underline"
                      >
                        {editing ? (
                          <>
                            <X className="h-3.5 w-3.5" /> Schließen
                          </>
                        ) : (
                          <>
                            <Pencil className="h-3.5 w-3.5" /> Korrigieren
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-1 text-xs text-muted">
                  {(a.halfDayStart || a.halfDayEnd) && (
                    <>
                      {a.halfDayStart && "Erster Tag halbtags. "}
                      {a.halfDayEnd && "Letzter Tag halbtags. "}
                    </>
                  )}
                  {a.type === "SICK" &&
                    `AU-Bescheinigung: ${a.sickNoteOnFile ? "liegt vor" : "fehlt"}. `}
                  {a.creditedBackFromVacation && "Urlaub gutgeschrieben (§9 BUrlG). "}
                  {a.note}
                </p>
                {a.correctionReason && (
                  <p className="mt-1 text-xs text-muted">
                    Zuletzt korrigiert: {a.correctionReason}
                  </p>
                )}

                {editing && <CorrectionForm absence={a} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CorrectionForm({ absence }: { absence: CorrectableAbsence }) {
  const [state, action, pending] = useActionState<AdminAbsenceState, FormData>(
    correctAbsenceAction,
    {},
  );
  const [cancelState, cancelAction, cancelPending] = useActionState<
    AdminAbsenceState,
    FormData
  >(cancelAbsenceAction, {});
  const [type, setType] = React.useState(absence.type);
  const [showCancel, setShowCancel] = React.useState(false);

  // The editor stays open after a save on purpose: the server action revalidates
  // the page, so the row above already shows the corrected record while the
  // confirmation is still on screen — closing it would hide the outcome.
  return (
    <div className="mt-3 space-y-4 border-t border-black/[0.06] pt-3">
      <form action={action} className="space-y-3">
        <input type="hidden" name="absenceId" value={absence.id} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Art"
            htmlFor={`k-type-${absence.id}`}
            info={`Die Art lässt sich mitkorrigieren — für den häufigsten Fall: Es war kein Urlaub, sondern Krankheit. Aus Urlaub verbuchte Tage fließen dabei in den Urlaubsanspruch zurück, aus Krankheit gebuchte Tage werden abgezogen.`}
          >
            <Select
              id={`k-type-${absence.id}`}
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as AbsenceKind)}
            >
              {ABSENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ABSENCE_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Von"
            htmlFor={`k-from-${absence.id}`}
            required
            info={`Beginn nach der Korrektur. Die verbrauchten Arbeitstage werden aus dem neuen Zeitraum neu berechnet — bereits gutgeschriebene Krankheitstage (§9 BUrlG) bleiben dabei berücksichtigt.`}
          >
            <Input
              id={`k-from-${absence.id}`}
              name="startDate"
              type="date"
              defaultValue={absence.startDate}
              required
            />
          </Field>
          <Field label="Bis" htmlFor={`k-to-${absence.id}`} required>
            <Input
              id={`k-to-${absence.id}`}
              name="endDate"
              type="date"
              defaultValue={absence.endDate}
              required
            />
          </Field>
        </div>

        {type !== "SICK" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="halfDayStart"
                defaultChecked={absence.halfDayStart}
                className="h-4 w-4 rounded border-black/20 accent-lime"
              />
              <span className="text-ink">Erster Tag halbtags</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="halfDayEnd"
                defaultChecked={absence.halfDayEnd}
                className="h-4 w-4 rounded border-black/20 accent-lime"
              />
              <span className="text-ink">Letzter Tag halbtags</span>
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="sickNoteOnFile"
                defaultChecked={absence.sickNoteOnFile}
                className="h-4 w-4 rounded border-black/20 accent-lime"
              />
              <span className="text-ink">AU-Bescheinigung liegt vor</span>
            </label>
            <InfoHint>{`Nur mit vorliegender AU können Krankheitstage, die in einen genehmigten Urlaub fallen, dem Urlaubskonto gutgeschrieben werden (§9 BUrlG).`}</InfoHint>
          </div>
        )}

        <Field label="Anmerkung" htmlFor={`k-note-${absence.id}`} hint="optional">
          <Textarea
            id={`k-note-${absence.id}`}
            name="note"
            defaultValue={absence.note ?? ""}
            className="min-h-[60px]"
          />
        </Field>
        <Field
          label="Grund der Korrektur"
          htmlFor={`k-reason-${absence.id}`}
          required
          info={`Wird im Protokoll festgehalten und am Eintrag vermerkt. Eine nachträglich geänderte Abwesenheit muss sich später erklären lassen — z. B. „Urlaub wegen Erkrankung ab 03.08. auf den 30.07. verkürzt“.`}
        >
          <Input
            id={`k-reason-${absence.id}`}
            name="reason"
            required
            placeholder="z. B. Urlaub wegen Erkrankung verkürzt"
          />
        </Field>

        <Banner state={state} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowCancel((v) => !v)}
            className="text-xs font-medium text-danger hover:underline"
          >
            Abwesenheit stornieren
          </button>
          <Button type="submit" disabled={pending}>
            Korrektur speichern
          </Button>
        </div>
      </form>

      {showCancel && (
        <form
          action={cancelAction}
          className="space-y-3 rounded-xl border border-danger/20 bg-danger/[0.04] p-3"
        >
          <input type="hidden" name="absenceId" value={absence.id} />
          <p className="text-xs text-muted">
            Die Abwesenheit wird nicht gelöscht, sondern als <strong>storniert</strong>{" "}
            gekennzeichnet: Sie zählt nicht mehr zum Urlaubskonto und schreibt keine
            Sollzeit mehr gut, bleibt aber im Protokoll nachvollziehbar.
          </p>
          <Field label="Grund der Stornierung" htmlFor={`k-cancel-${absence.id}`} required>
            <Input
              id={`k-cancel-${absence.id}`}
              name="reason"
              required
              placeholder="z. B. doppelt erfasst"
            />
          </Field>
          <Banner state={cancelState} />
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={cancelPending}>
              Endgültig stornieren
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
