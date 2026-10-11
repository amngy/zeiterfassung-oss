import { cookies } from "next/headers";
import QRCode from "qrcode";
import { issueQrCode, terminalForCookie, touchTerminal, TERMINAL_COOKIE } from "@/lib/terminals";
import { requestOrigin } from "@/lib/request-context";

// The kiosk page polls this for the current code. Authenticated by the device
// cookie only; the HMAC key never leaves the server.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  const terminal = await terminalForCookie((await cookies()).get(TERMINAL_COOKIE)?.value);
  if (!terminal) return Response.json({ error: "not-paired" }, { status: 401, headers: NO_STORE });

  const now = new Date();
  const { code, changesInMs } = issueQrCode(terminal.id, now);
  const svg = await QRCode.toString(`${await requestOrigin()}/q/${code}`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });
  await touchTerminal(terminal.id, now);
  return Response.json({ svg, changesInMs }, { headers: NO_STORE });
}
