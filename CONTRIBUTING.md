# Contributing

Thanks for your interest! Bug reports, fixes and improvements are welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on
  the approach.
- Security problems: see [SECURITY.md](SECURITY.md), not the issue tracker.
- The user interface is German; code, comments and commit messages are English.

## Development

See the README for local setup (Node per `.nvmrc`, PostgreSQL via
`docker-compose.dev.yml`). Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

CI runs the same checks on every pull request.

## Guidelines

- **Recorded times are never overwritten.** Corrections create a new version and
  an audit entry; keep it that way.
- Calculation logic belongs in the pure `src/lib/time/` module and needs unit
  tests. Database access stays in the `src/lib/*.ts` service modules.
- Every server action and route handler re-checks the user server-side
  (`requireActiveUser` / `requireAdmin` / `requireAdminApi`).
- Schema changes need a Prisma migration under `prisma/migrations/`.
- Legal rules (ArbZG, BUrlG, …) should be configurable defaults, not hard-coded
  assumptions. Cite the paragraph in a comment.

## License

By contributing you agree that your contribution is licensed under the
[GNU AGPL v3.0 or later](LICENSE), the license of this project.
