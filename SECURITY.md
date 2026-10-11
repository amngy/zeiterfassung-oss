# Security policy

This application stores personal data about employees (working times, absences,
sick days). Please report vulnerabilities privately so that operators can update
before details are public.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: open the repository's
*Security* tab and choose **Report a vulnerability**. Please do not open a public
issue, pull request or discussion for a security problem.

Helpful details: affected version or commit, steps to reproduce, and the impact
you expect. You will get an acknowledgement within a week.

## Supported versions

Only the latest commit on `main` receives fixes. Operators should update
regularly; migrations run automatically on deploy (`prisma migrate deploy`).

## Operator checklist

- Set a long random `AUTH_SECRET` and an explicit `SEED_ADMIN_PASSWORD`; change
  the admin password after the first login.
- Run behind a reverse proxy that terminates TLS and **sets** the client-IP
  header named in `CLIENT_IP_HEADER` (default `x-real-ip`). The login throttle
  depends on it; never expose the app port directly.
- Back up the database (`pg_dump`) and test restores — see the README.
