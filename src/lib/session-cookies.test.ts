import { describe, expect, it } from "vitest";
import { clearSessionCookies } from "./session-cookies";

function fakeStore(names: string[]) {
  const deleted: Array<{ name: string; path?: string; secure?: boolean }> = [];
  const store = {
    getAll: () => names.map((name) => ({ name, value: "x" })),
    delete: (opts: { name: string; path?: string; secure?: boolean }) => {
      deleted.push(opts);
    },
  };
  return { store: store as unknown as Parameters<typeof clearSessionCookies>[0], deleted };
}

describe("clearSessionCookies", () => {
  it("deletes plain, __Secure- and chunked session cookies, nothing else", () => {
    const { store, deleted } = fakeStore([
      "authjs.session-token",
      "__Secure-authjs.session-token.0",
      "__Secure-authjs.session-token.1",
      "__Host-authjs.csrf-token",
      "zt_terminal",
    ]);
    clearSessionCookies(store);
    expect(deleted).toEqual([
      { name: "authjs.session-token", path: "/", secure: false },
      { name: "__Secure-authjs.session-token.0", path: "/", secure: true },
      { name: "__Secure-authjs.session-token.1", path: "/", secure: true },
    ]);
  });
});
