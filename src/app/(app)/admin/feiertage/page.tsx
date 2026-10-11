import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { getAppSettings } from "@/lib/settings";
import { getHolidaysForYear } from "@/lib/holidays";
import { berlinDayKey, formatDayKey } from "@/lib/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddGiftedForm, SeedHolidaysForm } from "./holiday-forms";
import { deleteHolidayAction } from "./actions";

export const metadata: Metadata = { title: "Feiertage" };

export default async function AdminHolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string }>;
}) {
  await requireAdmin();
  const { jahr } = await searchParams;
  const settings = await getAppSettings();
  const currentYear = Number(berlinDayKey(new Date()).slice(0, 4));
  const year = /^\d{4}$/.test(jahr ?? "") ? Number(jahr) : currentYear;

  const rows = await getHolidaysForYear(year);
  const publicRows = rows.filter((r) => r.type === "PUBLIC");
  const giftedRows = rows.filter((r) => r.type === "GIFTED");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Feiertage &amp; Sonderfrei</h1>
        <p className="text-sm text-muted">
          Gesetzliche Feiertage werden pro Jahr berechnet (bewegliche Feste richten sich nach Ostern).
          Sonderfrei-Tage (firmenfrei) reduzieren die Sollzeit und mindern keinen Urlaub.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gesetzliche Feiertage anlegen</CardTitle>
            <CardDescription>
              Für das Bundesland des Betriebs (Standard: {settings.defaultBundesland}). Bereits
              vorhandene Tage bleiben unverändert.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeedHolidaysForm defaultBundesland={settings.defaultBundesland} defaultYear={year} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sonderfrei hinzufügen</CardTitle>
            <CardDescription>
              Firmenfreie Tage wie Rosenmontag, Heiligabend oder Silvester — ganz oder halbtags.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddGiftedForm defaultYear={year} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Feiertage {year}</CardTitle>
            <div className="flex items-center gap-1">
              <Link href={`/admin/feiertage?jahr=${year - 1}`} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Vorjahr">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="px-1 text-sm font-medium tabular-nums">{year}</span>
              <Link href={`/admin/feiertage?jahr=${year + 1}`} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Folgejahr">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <HolidaySection
            title={`Gesetzliche Feiertage (${publicRows.length})`}
            empty="Noch keine gesetzlichen Feiertage angelegt — bitte oben anlegen."
            rows={publicRows}
          />
          <HolidaySection
            title={`Sonderfrei / firmenfrei (${giftedRows.length})`}
            empty="Keine Sonderfrei-Tage."
            rows={giftedRows}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function HolidaySection({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Awaited<ReturnType<typeof getHolidaysForYear>>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-teal">{title}</h3>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-surface px-3 py-4 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-black/[0.05]">
          {rows.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="w-36 font-mono tabular-nums text-muted">
                  {formatDayKey(berlinDayKey(h.date, "UTC"))}
                </span>
                <span className="font-medium text-ink">{h.name}</span>
                {h.fraction === "HALF" && <Badge tone="info">halber Tag</Badge>}
                {h.recurringAnnually && <Badge tone="neutral">jährlich</Badge>}
                {h.source === "MANUAL" && h.type === "PUBLIC" && <Badge tone="warning">manuell</Badge>}
              </span>
              <form action={deleteHolidayAction}>
                <input type="hidden" name="id" value={h.id} />
                <button
                  type="submit"
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label={`${h.name} entfernen`}
                  title="Entfernen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
