// Terminal PINs (#11): format rules and generation. Pure; see @/lib/kiosk-pin
// for storage and checking.

import { randomInt } from "node:crypto";

export const PIN_LENGTH = 6;
export const PIN_RE = /^\d{6}$/;

/** Same digit throughout, or a straight run up or down (123456, 987654). */
export function isTrivialPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]!));
  return steps.size === 1 && [0, 1, -1].includes([...steps][0]!);
}

/** A random six-digit PIN that is not trivial. */
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
    if (!isTrivialPin(pin)) return pin;
  }
}
