// Coarse device label for a punch, e.g. "iPhone · Safari" or "Windows · Edge".
//
// Deliberately coarse (data minimisation): it answers "phone or office PC, which
// browser" and nothing finer — no versions, no raw header. It is an indicator,
// not proof: any client can send any User-Agent. Verified device identity is the
// job of passkeys, not of this string.

const OS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  // iPadOS 13+ reports itself as a Mac; it cannot be told apart here.
  [/Macintosh|Mac OS X/, "Mac"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

// Order matters: Edge, Opera and Samsung Internet also claim "Chrome", and
// every Chromium browser claims "Safari".
const BROWSER: [RegExp, string][] = [
  [/EdgA?\/|EdgiOS\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

function match(table: [RegExp, string][], ua: string): string | null {
  for (const [re, name] of table) if (re.test(ua)) return name;
  return null;
}

/** "OS · Browser", whichever parts are recognisable; null for an empty header. */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.trim();
  if (!ua) return null;
  const parts = [match(OS, ua), match(BROWSER, ua)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Unbekanntes Gerät";
}
