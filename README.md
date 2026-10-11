# Zeiterfassung

A small, **self-hosted time-tracking web app (Zeiterfassung)** for German
companies with a handful to a few dozen employees. It records working time in a tamper-evident
(*revisionssicher*) way, applies the relevant ArbZG / BUrlG / MiLoG rules as
**configurable** defaults, manages vacation and sick leave, and produces
payroll-ready exports — all in German for end users.

> ⚠️ **Not legal advice.** The compliance rules are sensible technical defaults.
> Have them reviewed by your Steuerberater:in / Fachanwält:in. The draft legal
> documents under [`docs/`](docs/) are marked `ENTWURF – rechtlich prüfen lassen`.

---

## Features

- **Clock in / out, breaks**, with a live "today" status — in the browser, or
  by scanning the **rotating QR code on an entrance terminal** (a tablet under
  Verwaltung → Terminals; the code changes every 30 s and is accepted for at
  most 90 s). Every punch records how it arrived (browser / QR + terminal).
- **Timesheets** by day / week / month with worked time, breaks and overtime
  (Gleitzeitsaldo).
- **Tamper-evident corrections:** times are never overwritten — a correction
  creates a new version linked to the original, gated by an approval workflow,
  and every change is written to an append-only **audit trail**.
- **ArbZG rule checks:** daily/weekly maximum, mandatory breaks, 11 h rest,
  Sunday/holiday work, stricter profile for minors — surfaced as warnings (or
  hard blocks) and counted on the dashboard.
- **Pausenautomatik:** a configurable fixed break is applied when a break was
  started but never ended, or never recorded at all on a day that requires one
  (§4 ArbZG). Computed per *shift*, so a cross-midnight one is covered too. The
  recorded punches are never rewritten — the deduction is derived at calculation
  time, reported as its own figure, and raises a hint asking for a correction.
  Individual accounts can be **exempted** from the automatic deduction (for
  contracts whose daily target is at or below the six-hour threshold, where an
  occasional overrun would otherwise cost 30 minutes nobody meant to deduct); a
  break that was started and never ended is still settled, and the §4 hint
  stays.
- **Absences:** vacation requests (incl. half-days), sick days (with AU flag),
  approval flow, §9 BUrlG credit-back, carry-over reminders, personal & team
  calendars. Further kinds — Sonderurlaub, Fortbildung, Dienstreise (credited),
  Freizeitausgleich (drawn from overtime), unbezahlter Urlaub, Elternzeit,
  Mutterschutz, Kind krank (Soll dropped) — go through the same approval flow. Entitlement honours BUrlG §3/§4/§5, SGB IX §208 and JArbSchG §19.
  An approved absence **credits the day's Soll** rather than reducing it, so a
  holiday comes out level instead of as a day of undertime, the month's Soll
  still states the contract, and the credit is reported as its own column
  (Saldo = Ist + Abwesenheit − Soll). A day somebody was sent home ill part-way
  through is topped up by exactly the hours they missed.
- **Retroactive absence correction:** an admin can change an absence already on
  file — its dates, its type (Urlaub ↔ Krankheit), half-day edges and AU flag —
  or withdraw it (kept as `CANCELLED`, never deleted). The consumed leave days
  are recomputed from the corrected range with any §9 credits re-derived, so a
  holiday cut short by illness leaves the leave account correct. A reason is
  mandatory and every change is audited.
- **Holidays:** public Feiertage auto-seeded per Bundesland and **per year**
  (movable feasts computed from Easter), plus gifted/company days (full/half).
- **Admin:** user & schedule management, all-timesheets view, statistics
  dashboard with charts, parameter & governance settings.
- **Exports:** payroll-ready CSV & PDF per employee/month, raw-entries CSV.
- **DSGVO:** per-person data export (Art. 15) and anonymisation (Art. 17).

## Tech stack

- **Next.js 16** (App Router, TypeScript) — single full-stack codebase
- **PostgreSQL + Prisma** (same engine in dev and prod to avoid migration drift)
- **Auth.js v5** (Credentials, JWT sessions) with **argon2id** password hashing
- **Zod** validation on every server action / route
- **Tailwind CSS** (brand tokens), **Recharts**, **pdf-lib**
- **Vitest** unit tests for the time-calculation logic

The working-time/holiday/vacation maths lives in one pure, framework-independent
module (`src/lib/time/`) so overtime and vacation-day counting can never diverge.

---

## Local development

### Prerequisites
- Node.js 20+ and npm
- Docker (for the local Postgres) — or any local PostgreSQL 14+

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start a local Postgres
docker compose -f docker-compose.dev.yml up -d

# 3. Configure environment
cp .env.example .env
#   then edit .env — at minimum set a real AUTH_SECRET:
#   npx auth secret        (or)   openssl rand -base64 32

# 4. Apply the database schema
npx prisma migrate deploy

# 5. Seed the first admin + demo employees
npm run db:seed

# 6. Run the app
npm run dev          # http://localhost:3000
```

### First login

The seed prints the credentials (defaults below — change them via `.env` before
seeding in any real environment):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@firma.de` | `ChangeMe!2026` |
| Employees | `anna@firma.de`, `bilal@firma.de`, `carla@firma.de` | `Mitarbeiter!2026` |

**Change the admin password immediately** under *Mein Konto* after first login.

### Useful scripts

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # run the production build
npm test             # run the unit tests
npm run typecheck    # TypeScript type-check
npm run lint         # ESLint
npm run db:seed      # seed admin + holidays (+ demo employees with SEED_DEMO=true)
```

There is deliberately no `db:reset` shortcut: dropping the database is
`npx prisma migrate reset --force`, typed by hand after checking `DATABASE_URL`.

---

## Deploying to Railway

Railway builds the repo with Nixpacks and runs the database migrations as a
pre-deploy step. TLS/HTTPS is provided automatically — no reverse proxy needed.

1. **Create a project** from your GitHub repo on [railway.com](https://railway.com).
2. **Add a PostgreSQL service** (Railway → *New* → *Database* → *PostgreSQL*).
3. **Set environment variables** on the app service (see the table below). Point
   `DATABASE_URL` at the Postgres service's reference variable
   (`${{ Postgres.DATABASE_URL }}`).
4. Deploy. [`railway.json`](railway.json) already configures:
   - **Pre-deploy:** `npx prisma migrate deploy` (applies migrations safely)
   - **Start:** `npm run start`
   - **Healthcheck:** `/api/health` (verifies DB connectivity)
5. **Seed the first admin once** — open a Railway shell on the service and run
   `npm run db:seed` (it is idempotent: it never overwrites an existing admin or
   settings changed in the app). In production it refuses to run without an
   explicit `SEED_ADMIN_PASSWORD`.
6. Optionally attach a **custom domain** in the service settings.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (Railway reference var). |
| `AUTH_SECRET` | ✅ | Long random value. `npx auth secret`. |
| `AUTH_URL` | prod | Public URL, e.g. `https://your-app.up.railway.app`. |
| `AUTH_TRUST_HOST` | prod | `true` behind Railway's proxy. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | seed | Used only by `db:seed`. |
| `DEFAULT_BUNDESLAND` | – | Default holiday region (e.g. `NW`). Also editable in-app. |
| `APP_TIMEZONE` | – | Day-boundary timezone (`Europe/Berlin`). |
| `CLIENT_IP_HEADER` | – | Header the reverse proxy *sets* to the client IP, used by the login throttle. Default `x-real-ip` (Railway). E.g. `cf-connecting-ip` behind Cloudflare. |

### Updating

Push to your default branch → Railway rebuilds and redeploys. New migrations in
`prisma/migrations/` are applied automatically by the pre-deploy command.

---

## Backup & restore

Railway's managed Postgres includes automated backups — review the retention in
the database service settings. **Additionally keep an off-platform copy:**

```bash
# One-off logical backup (run from anywhere with the DATABASE_URL):
pg_dump "$DATABASE_URL" --no-owner --format=custom --file=zeiterfassung_$(date +%F).dump

# Restore into an empty database:
pg_restore --no-owner --clean --if-exists --dbname "$DATABASE_URL" zeiterfassung_YYYY-MM-DD.dump
```

Schedule the dump regularly (e.g. a daily cron or a Railway cron service) and
store the file somewhere durable (encrypted object storage). Test a restore
periodically — an untested backup is not a backup.

---

## Security

- Passwords hashed with **argon2id**; minimum-strength policy enforced on change.
- **Login lockout** after repeated failures (`src/lib/auth-throttle.ts`).
- **Second factor (TOTP)** required for admins, optional for everyone else
  (`src/lib/two-factor.ts`, *Mein Konto → Zwei-Faktor-Anmeldung*). Until an
  admin has set it up, their account acts as an employee account. Ten one-time
  recovery codes; an admin can reset another person's second factor, and for
  the last admin there is `npm run db:reset-two-factor -- <e-mail> --yes`.
- **HttpOnly / Secure / SameSite=Lax** session cookies (Auth.js).
- **CSRF:** server actions are same-origin-protected by Next.js; mutations go
  through server actions / guarded route handlers, never unauthenticated GETs.
- **Security headers** (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy) in `next.config.mjs`. The CSP is self-only (no external
  CDNs/fonts/analytics — a DSGVO requirement). It currently allows inline
  scripts/styles that Next injects; a stricter nonce-based CSP can be layered on.
- **Role-based access:** employees can only ever see their own data; admin
  routes are guarded server-side and re-validate the account on every write.
- **No biometric data, no location tracking, no surveillance** — by design, to
  stay out of Art. 9 / mandatory-DPIA territory. Each punch records its
  channel (browser, terminal, …). Recording a coarse device type as well
  ("iPhone · Safari") is a setting, **off by default**; it never stores a device
  identifier, an IP or a location, and stays out of the payroll exports.
- **Works council:** an electronic time-recording system is a technical device
  under **§87(1) Nr. 6 BetrVG** — if the company has a Betriebsrat, its
  introduction (and changes such as new clock-in channels) need its agreement.
  Update the documents in [`docs/`](docs/) when you enable a new channel.

Keep all secrets in environment variables; never commit a real `.env`.

---

## Legal & data protection (drafts to review)

The [`docs/`](docs/) folder contains German draft documents, each marked
`ENTWURF – rechtlich prüfen lassen`:

- [`datenschutzerklaerung.md`](docs/datenschutzerklaerung.md) — privacy notice
- [`mitarbeiter-information-art13.md`](docs/mitarbeiter-information-art13.md) — employee information per Art. 13 DSGVO
- [`verarbeitungsverzeichnis.md`](docs/verarbeitungsverzeichnis.md) — record of processing activities (Art. 30)
- [`verfahrensdokumentation.md`](docs/verfahrensdokumentation.md) — GoBD process documentation

Note for the operator: if a **works council (Betriebsrat)** exists, it has
co-determination over this system (§87(1)(6) BetrVG) — most firms this size have
none, but confirm. Retention periods overlap (ArbZG/MiLoG ≥ 2 y, social-insurance
audits ≈ 4 y, payroll/tax up to ~10 y); the in-app retention setting defaults to
4 years — confirm the correct value with your advisor.

---

## Branding

Everything that identifies an organisation lives in
[`src/config/brand.ts`](src/config/brand.ts): product name, meta description,
logo file, the © line on the login page and the two brand colours (used by
Tailwind and the PDF export). To rebrand, edit that file and put your logo in
`public/`. The company name printed on reports is a separate setting under
*Einstellungen*.

## Project structure

```
prisma/                 schema + migrations + seed
src/
  config/brand.ts       name, logo, colours of this deployment
  app/                  routes (App Router): (app)/… employee+admin, api/…
  components/           UI, layout, calendar
  lib/
    time/               PURE calc module (tz, schedule, day, vacation, compliance) — unit-tested
    timesheet.ts        DB ↔ calc boundary for time tracking
    absences.ts         vacation + sick leave
    holidays.ts         Feiertag seeding + per-day effect map
    users.ts            admin user management
    stats.ts            statistics aggregation
    exports/            CSV + PDF + report builders
    dsgvo.ts            subject-rights export / anonymise
    settings.ts         configurable parameters + rule profile
    audit.ts            append-only audit trail
docs/                   draft legal documents (ENTWURF)
```

## Testing

```bash
npm test        # Vitest — covers the time/compliance/vacation maths
```

The pure calc module has the bulk of the tests because correctness there is what
matters most. Acceptance scenarios (over-10 h day, short break, <11 h rest,
vacation spanning a weekend + holiday, half-days, per-schedule holiday handling)
are covered by the unit tests.

---

## Contributing & security

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please
report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE). You may use, modify
and self-host it freely; if you offer a modified version to others over a
network, you must make your changes available under the same license.

The software comes **without any warranty** and is not legal advice — see the
note at the top of this file.
