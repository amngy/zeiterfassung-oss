"use client";

import * as React from "react";
import { BRAND } from "@/config/brand";

// Shows the terminal's rotating QR code, fetched from /terminal/code just after
// each change. A code is accepted for 60 s past its own window, so a short
// network hiccup does not interrupt punching; after that the code is hidden
// rather than shown stale.

const ACCEPTED_AFTER_CHANGE_MS = 60_000;
const RETRY_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;

type Status = "loading" | "ok" | "offline" | "unpaired";

export function KioskDisplay({ label, signedInWarning }: { label: string; signedInWarning: boolean }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status>("loading");
  const [now, setNow] = React.useState(() => new Date());
  const validUntil = React.useRef(0);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    async function load() {
      try {
        const res = await fetch("/terminal/code", {
          cache: "no-store",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.status === 401) {
          setStatus("unpaired");
          setSvg(null);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { svg: string; changesInMs: number };
        setSvg(data.svg);
        setStatus("ok");
        validUntil.current = Date.now() + data.changesInMs + ACCEPTED_AFTER_CHANGE_MS;
        // Whatever happens to the next fetch, never show a code past the point
        // where the server would refuse it.
        clearTimeout(expiry);
        expiry = setTimeout(() => setSvg(null), validUntil.current - Date.now() - RETRY_MS);
        if (!stopped) timer = setTimeout(load, data.changesInMs + 250);
      } catch {
        setStatus("offline");
        if (Date.now() > validUntil.current - RETRY_MS) setSvg(null);
        if (!stopped) timer = setTimeout(load, RETRY_MS);
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(expiry);
    };
  }, []);

  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the screen on where the browser allows it.
  React.useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Lock> } };
    let lock: Lock | null = null;
    async function acquire() {
      try {
        lock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") void acquire();
    }
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  const time = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  return (
    <main className="flex min-h-screen flex-col bg-teal text-white">
      {signedInWarning && (
        <p className="bg-danger px-6 py-2 text-center text-sm font-medium text-white">
          Auf diesem Gerät ist noch ein Benutzerkonto angemeldet. Bitte abmelden — das Terminal ist
          für alle zugänglich.
        </p>
      )}
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-medium">{BRAND.appName}</span>
        <span className="text-sm opacity-80">{label}</span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
        <div>
          <p className="font-mono text-6xl font-semibold tabular-nums">{time}</p>
          <p className="mt-1 text-base opacity-80">{date}</p>
        </div>
        <div className="rounded-3xl bg-white p-4 shadow-lg">
          {svg ? (
            <div
              className="h-[min(60vh,80vw)] w-[min(60vh,80vw)] [&>svg]:h-full [&>svg]:w-full"
              // Server-generated SVG of our own URL (qrcode library); no user input.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="flex h-[min(60vh,80vw)] w-[min(60vh,80vw)] items-center justify-center p-6 text-ink">
              {status === "unpaired"
                ? "Dieses Terminal wurde abgemeldet."
                : status === "offline"
                  ? "Keine Verbindung zum Server …"
                  : "Lädt …"}
            </div>
          )}
        </div>
        <div className="max-w-md space-y-1">
          <p className="text-lg font-medium">Mit der Handykamera scannen, um zu stempeln.</p>
          <p className="text-sm opacity-80">
            Der Code wechselt alle 30 Sekunden.
            {status === "offline" && svg ? " Verbindung wird wiederhergestellt …" : ""}
          </p>
        </div>
      </div>
    </main>
  );
}
