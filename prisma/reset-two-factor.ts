// Removes the second factor of ONE account (#14) — for when the last admin has
// lost their phone and their recovery codes, so no other admin can reset it in
// the app (Mitarbeitende → Konto → Zwei-Faktor zurücksetzen).
//
// The account keeps its password; at the next sign-in an admin is sent straight
// to set up a new second factor. The reset is written to the audit trail with
// no actor ("System"), like every other change.
//
// Usage (e.g. in a Railway shell):
//   npx tsx prisma/reset-two-factor.ts admin@firma.de         → shows the account, does nothing
//   npx tsx prisma/reset-two-factor.ts admin@firma.de --yes   → resets it

import { prisma } from "@/lib/db";
import { resetTwoFactor } from "@/lib/two-factor";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"))?.toLowerCase().trim();
  const yes = process.argv.includes("--yes");
  if (!email) {
    console.error("Aufruf: npx tsx prisma/reset-two-factor.ts <e-mail> [--yes]");
    process.exit(2);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, role: true, active: true, totpEnabledAt: true, totpPendingSecret: true },
  });
  if (!user) {
    console.error(`Kein Konto mit der E-Mail-Adresse ${email}.`);
    process.exit(1);
  }

  console.log(`${user.name} <${email}> · ${user.role} · ${user.active ? "aktiv" : "deaktiviert"}`);
  console.log(
    user.totpEnabledAt
      ? `Zwei-Faktor eingeschaltet seit ${user.totpEnabledAt.toISOString()}`
      : `Zwei-Faktor nicht eingeschaltet${user.totpPendingSecret ? " (Einrichtung begonnen)" : ""}`,
  );
  if (!yes) {
    console.log("\nNichts geändert. Mit --yes zurücksetzen.");
    return;
  }

  await resetTwoFactor({ actorId: null, userId: user.id });
  console.log("\nZurückgesetzt. Bei der nächsten Anmeldung genügt das Passwort; Admins richten dann sofort neu ein.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
