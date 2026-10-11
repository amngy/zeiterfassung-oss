import { describe, expect, it } from "vitest";
import { sickNoteDue, sickNoteDueKey } from "./sick-note";

const spell = (fromKey: string, toKey: string, sickNoteOnFile = false) => ({ fromKey, toKey, sickNoteOnFile });

describe("sickNoteDue (EFZG §5)", () => {
  it("is due from day N of the spell, not before", () => {
    const s = spell("2026-10-05", "2026-10-09"); // Mon–Fri
    expect(sickNoteDueKey(s, 4)).toBe("2026-10-08");
    expect(sickNoteDue(s, 4, "2026-10-07")).toBe(false);
    expect(sickNoteDue(s, 4, "2026-10-08")).toBe(true);
    expect(sickNoteDue(s, 4, "2026-11-30")).toBe(true);
  });

  it("counts calendar days, weekend included", () => {
    const s = spell("2026-10-09", "2026-10-12"); // Fri–Mon
    expect(sickNoteDueKey(s, 4)).toBe("2026-10-12");
  });

  it("is never due for a spell shorter than N days", () => {
    const s = spell("2026-10-05", "2026-10-07");
    expect(sickNoteDueKey(s, 4)).toBeNull();
    expect(sickNoteDue(s, 4, "2026-12-01")).toBe(false);
  });

  it("an employer requiring it from day 1 makes it due at once", () => {
    expect(sickNoteDue(spell("2026-10-05", "2026-10-05"), 1, "2026-10-05")).toBe(true);
  });

  it("is not due once the certificate is on file", () => {
    expect(sickNoteDue(spell("2026-10-05", "2026-10-09", true), 4, "2026-10-09")).toBe(false);
  });
});
