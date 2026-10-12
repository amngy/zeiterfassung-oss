# Threat model

## What this project does and where untrusted input enters

A self-hosted working-time recording app for small German businesses. It records
working time as German law requires (ArbZG §16, MiLoG §17, GoBD revision safety)
and handles absences, corrections, payroll exports and GDPR exports. One
installation serves one company: there is no multi-tenancy.

Stack: Next.js 16 (App Router, server actions), Auth.js v5 with a credentials
provider and JWT sessions, Prisma 6 with PostgreSQL, Zod for input validation.

Actors and trust:

- **Anonymous users** can reach the sign-in page (`src/app/login`), the Auth.js
  routes (`/api/auth/*`), `/api/health`, `/sitzung-beendet` and the terminal
  pages (`src/app/terminal`).
- **Employees** (role `EMPLOYEE`) clock in and out, see their own times and
  absences, and file correction and absence requests.
- **Admins** (role `ADMIN`) manage people and settings, decide requests, correct
  any entry and export data. Admins must use a second factor (TOTP). Until they
  enrol, an admin account acts as an employee account (`src/lib/session.ts`).
- **On-site terminals** (kiosk devices) have no user session. They authenticate
  with a device cookie issued when an admin pairs them (`src/lib/terminals.ts`).
  They show a rotating, HMAC-signed QR code. An employee scans it in their own
  signed-in session (`src/app/(app)/q/[code]`) to punch.

Untrusted input reaches the app through:

- every server action (`src/app/**/actions.ts`): form data and bound arguments;
- the route handlers under `src/app/api` and `src/app/terminal/code`;
- the QR code string, the terminal device cookie and the session cookie;
- the request headers used for the device label and the origin
  (`src/lib/device-label.ts`, `src/lib/request-context.ts`);
- text that employees enter (notes, reasons, names). It later appears to admins
  in pages, CSV files and PDFs.

## Components that matter most / least

Most important:

- **Authorization between people.** An employee must never read or change
  another person's times, absences, requests or account. Check the ownership
  checks in the server actions and in `src/lib/corrections.ts`,
  `src/lib/absences.ts` and `src/lib/clock.ts`.
- **Becoming an admin.** This covers role escalation, using admin actions or the
  `/api/admin/*` exports without the role, and bypassing the admin TOTP
  requirement (`src/auth.ts`, `src/lib/two-factor.ts`, `src/lib/totp.ts`,
  `src/lib/admin-api.ts`).
- **Authentication.** This covers the password check, the login throttle
  (`src/lib/auth-throttle.ts`), TOTP replay and the per-account lockout, recovery
  codes, and sessions of deactivated users (they must end at once).
- **Revision safety.** Time entries are never overwritten. A correction creates a
  new version (`supersedesId`) and writes an audit row (`src/lib/audit.ts`).
  Changing or deleting history without leaving a trace is a serious problem.
  Exceptions are the documented retention purge (`src/lib/retention.ts`, admin
  only) and GDPR anonymisation (`src/lib/dsgvo.ts`).
- **Terminals and QR punches.** This covers forging or reusing terminal cookies,
  forging QR codes, and punching for another person.
- **Exports.** CSV and PDF exports (`src/lib/exports`) include text that
  employees entered. Look for CSV formula injection and data from other people
  leaking into a person's export.
- Open redirects after sign-in (`src/lib/safe-redirect.ts`), CSRF on server
  actions, and XSS. A Content-Security-Policy is set in `next.config.mjs`.

Less important / out of scope:

- `prisma/*.ts` scripts (seed, maintenance, `reset-two-factor`). Operators run
  them on the server with database access; they are not an attack surface.
- `docs/`, `tmp/`, `src/app/design` (static style guide) and
  `src/config/brand.ts`.
- The demo seed data and its well-known passwords. These are for local use only.
- Missing rate limits on routes other than sign-in. Volumetric DoS is the job of
  the reverse proxy.
- The infrastructure: HTTPS termination, the database server and backups.

## How to exercise it

The image has a production build and a local PostgreSQL with all migrations
applied and demo data seeded.

- Start everything with `/src/.oss-scanner/start.sh`. The app then listens on
  http://localhost:3000.
- Sign-in data (local only):
  - Admin: `admin@firma.de` / `Scanner-Admin!2026`. It has no second factor yet,
    so it acts as an employee until TOTP is set up under `/konto/zwei-faktor`.
    For tests, call `beginEnrolment` and `confirmEnrolment` from
    `src/lib/two-factor.ts` and compute codes with `totpCode` from
    `src/lib/totp.ts`, e.g. in a script run with `npx tsx`.
  - Employees: `anna@firma.de`, `bilal@firma.de`, `carla@firma.de`, each with
    the password `Mitarbeiter!2026`.
- Server actions can be called without JavaScript. Fetch the page, take the
  hidden `$ACTION_*` inputs from the form, and POST them as multipart with an
  `Origin` header that matches the host.
- Unit tests: `npm test` (Vitest, mostly the pure time logic in
  `src/lib/time`). Type check: `npm run typecheck`.
- Database: `psql postgresql://zeit:zeit@localhost:5432/zeiterfassung`.

## How you rate severity

The data is personal data about employees (working times, sick days, absences).
A breach is a GDPR matter, and the records are legal evidence.

- **Critical:** remote code execution; access to any personal data or time
  records without signing in; signing in as someone else without their
  credentials; becoming an admin without admin credentials.
- **High:** an employee reads or changes another person's data; an employee
  gains admin rights; bypassing the admin second factor; changing or deleting
  time entries, versions or audit rows without an audit trace; stored XSS that
  an employee can plant and an admin will view; forging terminal cookies or QR
  codes that punch for someone else.
- **Medium:** CSRF on a state-changing action; CSV formula injection in exports;
  bypassing the login throttle or the TOTP lockout; replaying a QR code after it
  expires; a deactivated user's session staying usable; open redirects.
- **Low:** issues that need admin rights (admins are trusted within their
  company) unless they break revision safety; DoS that needs a signed-in
  account; leaks of non-personal data such as settings or holidays.

Reports are most useful with a reproducer against the running image, such as a
short `npx tsx` script or curl calls, and with a patch that follows the existing
patterns: Zod validation, `requireUser`/`requireAdmin` guards, an audit row for
every change, and no in-place updates of time entries.

## Anything to leave alone

- The default and demo passwords in the seed and in this image.
- Placeholder secrets in `.env.example`, CI and this Dockerfile.
- Admins seeing and changing everyone's data. That is their role.
- `next.config.mjs` allowing `'unsafe-inline'` for scripts and styles in the
  CSP. Next.js needs it for its bootstrap scripts, and it is a known trade-off.
  Report XSS by its injection point, not by the CSP setting itself.
