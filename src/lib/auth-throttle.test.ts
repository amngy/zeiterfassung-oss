import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./auth-throttle";

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses X-Real-IP and ignores a client-forged X-Forwarded-For", () => {
    const h = new Headers({
      "x-forwarded-for": "6.6.6.6, 203.0.113.7",
      "x-real-ip": "203.0.113.7",
    });
    expect(clientIp(h)).toBe("203.0.113.7");
  });

  it("falls back to the shared unknown bucket without the trusted header", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6" }))).toBe("unknown");
    expect(clientIp(null)).toBe("unknown");
  });

  it("honours CLIENT_IP_HEADER, taking the proxy-appended last XFF entry", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "X-Forwarded-For");
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" });
    expect(clientIp(h)).toBe("198.51.100.4");
  });

  it("collapses a full IPv6 address to its /64", () => {
    const h = new Headers({ "x-real-ip": "2001:db8:1:2:3:4:5:6" });
    expect(clientIp(h)).toBe("2001:db8:1:2::/64");
  });
});
