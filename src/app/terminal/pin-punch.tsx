"use client";

import * as React from "react";
import { useActionState } from "react";
import { kioskPunchAction, type KioskPunchState } from "./actions";

// Name + PIN punching on the kiosk (#11), for staff without a smartphone.
// Big touch targets; the PIN never stays on screen: after a punch, a cancel or
// a minute without input the view goes back to the QR code.

const IDLE_MS = 60_000;
const RESULT_MS = 6_000;

const ACTIONS: { value: string; label: string; tone: string }[] = [
  { value: "clock-in", label: "Einstempeln", tone: "bg-lime text-white" },
  { value: "break-start", label: "Pause starten", tone: "bg-white text-ink" },
  { value: "break-end", label: "Pause beenden", tone: "bg-white text-ink" },
  { value: "clock-out", label: "Ausstempeln", tone: "bg-white text-ink" },
];

export function PinPunch({ people, onDone }: { people: { id: string; name: string }[]; onDone: () => void }) {
  const [person, setPerson] = React.useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = React.useState("");
  const [state, action, pending] = useActionState<KioskPunchState, FormData>(kioskPunchAction, {});

  // A refused PIN is cleared at once (adjusting state on a new result while
  // rendering, the React way, rather than in an effect).
  const [seen, setSeen] = React.useState(state);
  if (state !== seen) {
    setSeen(state);
    setPin("");
  }

  // Leave after a punch, and whenever nobody touches the screen for a minute.
  const idleSeconds = React.useRef(0);
  const touch = () => {
    idleSeconds.current = 0;
  };
  React.useEffect(() => {
    const id = setInterval(() => {
      idleSeconds.current += 1;
      if (idleSeconds.current * 1_000 >= IDLE_MS) onDone();
    }, 1_000);
    return () => clearInterval(id);
  }, [onDone]);
  React.useEffect(() => {
    if (!state.ok) return;
    const id = setTimeout(onDone, RESULT_MS);
    return () => clearTimeout(id);
  }, [state, onDone]);

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-6 text-center" role="status">
        <p className="max-w-md text-2xl font-medium">{state.message}</p>
        <button type="button" onClick={onDone} className="rounded-2xl bg-white px-6 py-3 text-lg font-medium text-ink">
          Fertig
        </button>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="w-full max-w-2xl space-y-4" onPointerDown={touch}>
        <p className="text-center text-lg font-medium">Wer stempelt?</p>
        {people.length === 0 ? (
          <p className="text-center opacity-80">Noch niemand hat eine Terminal-PIN.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPerson(p)}
                className="rounded-2xl bg-white px-4 py-4 text-lg font-medium text-ink shadow"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="text-center">
          <button type="button" onClick={onDone} className="px-4 py-2 text-base underline opacity-90">
            Abbrechen
          </button>
        </div>
      </div>
    );
  }

  const press = (digit: string) => {
    touch();
    setPin((p) => (p.length < 6 ? p + digit : p));
  };

  return (
    <form action={action} className="w-full max-w-md space-y-4" onPointerDown={touch} onKeyDown={touch}>
      <input type="hidden" name="userId" value={person.id} />
      <p className="text-center text-lg font-medium">{person.name}</p>
      <label htmlFor="kiosk-pin" className="sr-only">
        PIN
      </label>
      <input
        id="kiosk-pin"
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="PIN"
        className="w-full rounded-2xl bg-white px-4 py-3 text-center font-mono text-3xl tracking-[0.5em] text-ink"
      />
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} className="rounded-2xl bg-white/15 py-4 text-2xl font-medium">
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setPin("")} className="rounded-2xl bg-white/15 py-4 text-base">
          Löschen
        </button>
        <button type="button" onClick={() => press("0")} className="rounded-2xl bg-white/15 py-4 text-2xl font-medium">
          0
        </button>
        <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} className="rounded-2xl bg-white/15 py-4 text-base">
          ←
        </button>
      </div>
      {state.ok === false && (
        <p className="rounded-xl bg-danger px-4 py-2 text-center font-medium text-white" role="alert">
          {state.error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.value}
            type="submit"
            name="action"
            value={a.value}
            disabled={pending || pin.length !== 6}
            className={`rounded-2xl px-3 py-4 text-lg font-medium shadow disabled:opacity-50 ${a.tone}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="text-center">
        <button type="button" onClick={onDone} className="px-4 py-2 text-base underline opacity-90">
          Abbrechen
        </button>
      </div>
    </form>
  );
}
