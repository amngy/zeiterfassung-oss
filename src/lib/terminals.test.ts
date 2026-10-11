import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

const { checkQrCode, issueQrCode, QR_WINDOW_MS } = await import("./terminals");

const SECRET = "test-secret-not-used-anywhere";
const TERMINAL = "cmv465h3m00005o14w0ptxb27";
const T0 = new Date("2026-10-12T08:00:10Z"); // 10 s into a window

describe("terminal QR codes", () => {
  const { code, changesInMs } = issueQrCode(TERMINAL, T0, SECRET);

  it("encodes the terminal and says when the code changes", () => {
    expect(code.startsWith(`${TERMINAL}.`)).toBe(true);
    expect(changesInMs).toBe(QR_WINDOW_MS - 10_000);
  });

  it("accepts the code in its own window and the two after it", () => {
    expect(checkQrCode(code, T0, SECRET)).toBe(TERMINAL);
    expect(checkQrCode(code, new Date(T0.getTime() + 2 * QR_WINDOW_MS), SECRET)).toBe(TERMINAL);
  });

  it("rejects it three windows later", () => {
    expect(checkQrCode(code, new Date(T0.getTime() + 3 * QR_WINDOW_MS), SECRET)).toBeNull();
  });

  it("rejects a code from the future", () => {
    const later = issueQrCode(TERMINAL, new Date(T0.getTime() + QR_WINDOW_MS), SECRET).code;
    expect(checkQrCode(later, T0, SECRET)).toBeNull();
  });

  it("rejects a different secret, a tampered MAC, window or terminal", () => {
    expect(checkQrCode(code, T0, "another-secret")).toBeNull();
    const [id, w, mac] = code.split(".") as [string, string, string];
    const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
    expect(checkQrCode(`${id}.${w}.${flipped}`, T0, SECRET)).toBeNull();
    const earlier = (parseInt(w, 36) - 1).toString(36);
    expect(checkQrCode(`${id}.${earlier}.${mac}`, T0, SECRET)).toBeNull();
    expect(checkQrCode(`cmv465h3m00005o14w0ptxb28.${w}.${mac}`, T0, SECRET)).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "x", `${TERMINAL}..`, `${TERMINAL}.zz`, `${code}.extra`, code.toUpperCase()]) {
      expect(checkQrCode(bad, T0, SECRET)).toBeNull();
    }
  });
});
