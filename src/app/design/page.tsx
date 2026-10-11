import type { Metadata } from "next";
import {
  Clock3,
  Play,
  Coffee,
  TrendingUp,
  Plane,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Design-Vorschau" };

export default function DesignPreviewPage() {
  return (
    <AppShell
      user={{ name: "Lena Hoffmann", role: "Administratorin" }}
      roleKey="ADMIN"
      activeHref="/dashboard"
      badges={{ "/admin/feiertage": 2 }}
    >
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Montag, 15. Juni 2026</p>
            <h1 className="text-2xl font-medium tracking-tight text-ink">
              Guten Morgen, Lena 👋
            </h1>
          </div>
        </header>

        {/* Today / clock-in hero */}
        <Card className="overflow-hidden border-teal/15 bg-gradient-to-br from-teal to-teal-dark text-white shadow-card">
          <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-white/70">Aktueller Status</p>
              <p className="mt-1 text-3xl font-light tracking-tight">
                Eingestempelt seit <span className="font-semibold">08:32</span>
              </p>
              <p className="mt-1 text-sm text-white/75">
                Heute gearbeitet: 3 Std 18 Min · Pause: 0 Min
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                <Coffee className="h-5 w-5" />
                Pause starten
              </Button>
              <Button size="lg">
                <Play className="h-5 w-5" />
                Ausstempeln
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            icon={<Clock3 className="h-5 w-5" />}
            label="Heute gearbeitet"
            value="3:18"
            sub="Soll: 8:00"
          />
          <Kpi
            icon={<Coffee className="h-5 w-5" />}
            label="Pausen heute"
            value="0:00"
            sub="ab 6 Std: 30 Min nötig"
          />
          <Kpi
            icon={<TrendingUp className="h-5 w-5" />}
            label="Gleitzeitsaldo"
            value="+3:45"
            sub="Stand diese Woche"
            tone="lime"
          />
          <Kpi
            icon={<Plane className="h-5 w-5" />}
            label="Urlaub übrig"
            value="18 / 28"
            sub="10 Tage genommen"
            tone="teal"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent entries */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Letzte Buchungen</CardTitle>
              <CardDescription>Diese Woche · KW 25</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-2 font-medium">Tag</th>
                    <th className="px-5 py-2 font-medium">Kommen</th>
                    <th className="px-5 py-2 font-medium">Gehen</th>
                    <th className="px-5 py-2 font-medium">Pause</th>
                    <th className="px-5 py-2 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <Row day="Mo 15.06." in="08:32" out="—" pause="—" saldo="läuft" running />
                  <Row day="Fr 12.06." in="08:05" out="16:48" pause="0:30" saldo="+0:13" />
                  <Row day="Do 11.06." in="07:58" out="18:40" pause="0:30" saldo="+2:12" warn />
                  <Row day="Mi 10.06." in="09:10" out="17:05" pause="0:30" saldo="-0:35" />
                  <Row day="Di 09.06." in="08:00" out="16:30" pause="0:30" saldo="±0:00" />
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Warnings */}
          <Card className="border-danger/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-danger">
                <AlertTriangle className="h-5 w-5" />
                Hinweise
              </CardTitle>
              <CardDescription>Prüfungen nach ArbZG</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Warning
                tone="danger"
                title="Do 11.06.: über 10 Std"
                text="10 Std 12 Min erfasst — gesetzliches Tageslimit überschritten."
              />
              <Warning
                tone="warning"
                title="Do 11.06.: Pause zu kurz"
                text="Bei > 9 Std sind mind. 45 Min Pause vorgeschrieben."
              />
              <Warning
                tone="warning"
                title="Ruhezeit < 11 Std"
                text="Zwischen Do und Fr lagen nur 9 Std 25 Min."
              />
            </CardContent>
          </Card>
        </div>

        {/* Component gallery */}
        <Card>
          <CardHeader>
            <CardTitle>Komponenten-Bibliothek</CardTitle>
            <CardDescription>
              Brand-Tokens, Buttons und Status-Badges
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primär (Lime)</Button>
              <Button variant="secondary">Sekundär (Teal)</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Löschen</Button>
              <Button variant="primary" disabled>
                Deaktiviert
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="lime">Genehmigt</Badge>
              <Badge tone="teal">Im Soll</Badge>
              <Badge tone="info">Ausstehend</Badge>
              <Badge tone="warning">Prüfen</Badge>
              <Badge tone="danger">Regelverstoß</Badge>
              <Badge tone="neutral">Entwurf</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["teal", "#136860"],
                ["teal-dark", "#0E4F4A"],
                ["lime", "#8FB83E"],
                ["lime-dark", "#79991F"],
                ["surface", "#F5F7F6"],
                ["ink", "#1F2A28"],
                ["muted", "#6B7A77"],
                ["danger", "#C0392B"],
              ].map(([name, hex]) => (
                <div
                  key={name}
                  className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-2.5 py-1.5"
                >
                  <span
                    className="h-5 w-5 rounded-md border border-black/10"
                    style={{ background: hex }}
                  />
                  <span className="text-xs font-medium text-ink">{name}</span>
                  <span className="text-xs text-muted">{hex}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "teal" | "lime";
}) {
  const accent =
    tone === "lime"
      ? "text-lime-dark"
      : tone === "teal"
        ? "text-teal"
        : "text-ink";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted">
          <span className="text-teal">{icon}</span>
          <span className="text-sm">{label}</span>
        </div>
        <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent}`}>
          {value}
        </p>
        <p className="mt-0.5 text-xs text-muted">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Row({
  day,
  in: clockIn,
  out,
  pause,
  saldo,
  running,
  warn,
}: {
  day: string;
  in: string;
  out: string;
  pause: string;
  saldo: string;
  running?: boolean;
  warn?: boolean;
}) {
  return (
    <tr className="border-b border-black/[0.04] last:border-0">
      <td className="px-5 py-2.5 font-medium text-ink">{day}</td>
      <td className="px-5 py-2.5 text-ink">{clockIn}</td>
      <td className="px-5 py-2.5 text-ink">{out}</td>
      <td className="px-5 py-2.5 text-muted">{pause}</td>
      <td className="px-5 py-2.5 text-right">
        {running ? (
          <Badge tone="info">{saldo}</Badge>
        ) : warn ? (
          <Badge tone="danger">{saldo}</Badge>
        ) : (
          <span className="font-medium text-ink">{saldo}</span>
        )}
      </td>
    </tr>
  );
}

function Warning({
  tone,
  title,
  text,
}: {
  tone: "danger" | "warning";
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-black/[0.06] bg-white p-3">
      <span
        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
          tone === "danger" ? "bg-danger" : "bg-amber-500"
        }`}
      />
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="text-xs text-muted">{text}</p>
      </div>
    </div>
  );
}
