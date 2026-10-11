import { headers } from "next/headers";
import { deviceLabel } from "@/lib/device-label";
import { getAppSettings } from "@/lib/settings";

// Per-request facts the punch and link code needs, read from the incoming
// request. Server-only (next/headers).

/**
 * The coarse device type of the browser making this request, or null when the
 * operator has not switched it on (Einstellungen → Stempeln).
 */
export async function punchDeviceLabel(): Promise<string | null> {
  const { punchPolicy } = await getAppSettings();
  if (!punchPolicy.recordDeviceType) return null;
  return deviceLabel((await headers()).get("user-agent"));
}

/**
 * Absolute origin for links that leave the browser — a QR code, a pairing
 * link. AUTH_URL wins when set; otherwise the proxy's forwarded host/proto.
 */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.AUTH_URL;
  if (configured) return new URL(configured).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}
