import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-redirect";

const PROTOCOL_RELATIVE = /^\/[/\\]/;

describe("safeInternalPath", () => {
  it("keeps the path (and query) of a same-site callback, absolute or relative", () => {
    expect(safeInternalPath("https://zeit.example.com/q/abc.1a.XYZ")).toBe("/q/abc.1a.XYZ");
    expect(safeInternalPath("/zeiten?view=month")).toBe("/zeiten?view=month");
  });

  it("drops the host of a foreign absolute URL instead of following it", () => {
    expect(safeInternalPath("https://evil.example/zeiten")).toBe("/zeiten");
  });

  it("never yields a protocol-relative target", () => {
    for (const raw of ["//evil.example", "/\\evil.example", "\\\\evil.example", "/%2F/evil.example"]) {
      const path = safeInternalPath(raw);
      expect(path === null || !PROTOCOL_RELATIVE.test(path)).toBe(true);
    }
  });

  it("refuses login, api and junk targets", () => {
    for (const bad of ["/login", "/api/auth/signout", "/", "", null, 42, "javascript:alert(1)"]) {
      expect(safeInternalPath(bad)).toBeNull();
    }
  });
});
