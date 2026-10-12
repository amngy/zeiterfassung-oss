import { describe, expect, it } from "vitest";
import { generatePin, isTrivialPin, PIN_RE } from "./pin";

describe("isTrivialPin", () => {
  it("spots repeated digits and straight runs", () => {
    for (const pin of ["000000", "111111", "123456", "654321", "345678"]) expect(isTrivialPin(pin)).toBe(true);
  });

  it("accepts everything else", () => {
    for (const pin of ["120456", "135790", "902341", "112233"]) expect(isTrivialPin(pin)).toBe(false);
  });
});

describe("generatePin", () => {
  it("gives six digits that are not trivial", () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin();
      expect(pin).toMatch(PIN_RE);
      expect(isTrivialPin(pin)).toBe(false);
    }
  });
});
