import { describe, expect, it } from "vitest";
import { versionChain, type VersionChange, type VersionRow } from "./entry-history";

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h));

function row(id: string, supersedesId: string | null, startHour: number, extra: Partial<VersionRow> = {}): VersionRow {
  return {
    id,
    supersedesId,
    type: "WORK",
    start: at(startHour),
    end: at(startHour + 8),
    source: "MANUAL",
    createdAt: at(20 + startHour),
    punches: [],
    ...extra,
  };
}

const map = <T extends { id: string }>(...items: T[]) => new Map(items.map((i) => [i.id, i]));

describe("versionChain", () => {
  it("is empty for an entry that was never corrected", () => {
    expect(versionChain("a", map(row("a", null, 6)), new Map())).toEqual([]);
  });

  it("lists earlier versions newest first, each with the change that replaced it", () => {
    const original = row("c", null, 5, {
      source: "CLOCK",
      punches: [
        { edge: "Beginn", via: "QR-Code · iPhone" },
        { edge: "Ende", via: "Browser" },
      ],
    });
    const rows = map(row("a", "b", 7), row("b", "c", 6), original);
    const changes = new Map<string, VersionChange>([
      ["b", { actor: "Erika", at: at(21), reason: "Beginn vergessen" }],
      ["a", { actor: "Admin", at: at(22), reason: "Pause fehlte" }],
    ]);

    const chain = versionChain("a", rows, changes);

    expect(chain.map((v) => v.id)).toEqual(["b", "c"]);
    expect(chain[0]!.replaced).toEqual({ actor: "Admin", at: at(22), reason: "Pause fehlte" });
    expect(chain[1]!.replaced.reason).toBe("Beginn vergessen");
    expect(chain[1]!.source).toBe("CLOCK");
    expect(chain[1]!.punches).toHaveLength(2);
  });

  it("falls back to the creation time when the audit row is missing", () => {
    const head = row("a", "b", 7);
    const chain = versionChain("a", map(head, row("b", null, 6)), new Map());
    expect(chain[0]!.replaced).toEqual({ actor: null, at: head.createdAt, reason: null });
  });

  it("stops at a missing link or a loop", () => {
    expect(versionChain("a", map(row("a", "gone", 7)), new Map())).toEqual([]);
    const loop = versionChain("a", map(row("a", "b", 7), row("b", "a", 6)), new Map());
    expect(loop.map((v) => v.id)).toEqual(["b"]);
  });
});
