import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  groupSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  matchTotp,
  otpauthUri,
  totpCode,
  totpStep,
} from "./totp";

// RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

describe("base32", () => {
  it("round-trips and matches RFC 4648", () => {
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(new TextDecoder().decode(base32Decode("mzxw 6ytb-oi=="))).toBe("foobar");
  });
  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("ABC1")).toThrow();
  });
});

describe("totpCode", () => {
  it("reproduces the RFC 6238 SHA-1 test vectors (8 digits)", () => {
    const cases: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, code] of cases) {
      expect(totpCode(RFC_SECRET, totpStep(new Date(seconds * 1000)), 8)).toBe(code);
    }
  });
  it("uses the last six digits by default", () => {
    expect(totpCode(RFC_SECRET, totpStep(new Date(59_000)))).toBe("287082");
  });
});

describe("matchTotp", () => {
  const secret = generateTotpSecret();
  const at = new Date("2026-10-11T12:00:10Z");
  const step = totpStep(at);

  it("accepts the current code and the neighbouring steps", () => {
    expect(matchTotp(secret, totpCode(secret, step), at)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), at)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), at)).toBe(step + 1);
  });
  it("refuses codes outside the window", () => {
    expect(matchTotp(secret, totpCode(secret, step - 2), at)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, step + 2), at)).toBeNull();
  });
  it("refuses a step that was already used", () => {
    expect(matchTotp(secret, totpCode(secret, step), at, step)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, step + 1), at, step)).toBe(step + 1);
  });
  it("tolerates spaces but nothing else", () => {
    const code = totpCode(secret, step);
    expect(matchTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(step);
    expect(matchTotp(secret, `${code}0`, at)).toBeNull();
    expect(matchTotp(secret, "abcdef", at)).toBeNull();
  });
});

describe("otpauthUri", () => {
  it("carries issuer, account and parameters", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "admin@firma.de", issuer: "Zeiterfassung" });
    expect(uri).toBe(
      "otpauth://totp/Zeiterfassung%3Aadmin%40firma.de?secret=JBSWY3DPEHPK3PXP&issuer=Zeiterfassung&algorithm=SHA1&digits=6&period=30",
    );
  });
  it("groups the secret for manual entry", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});

describe("recovery codes", () => {
  it("are ten distinct, well-formed codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      expect(looksLikeRecoveryCode(c)).toBe(true);
    }
  });
  it("hash the same regardless of case, spaces and dashes", () => {
    expect(hashRecoveryCode("k7qx m2pa-rt5d")).toBe(hashRecoveryCode("K7QX-M2PA-RT5D"));
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});
