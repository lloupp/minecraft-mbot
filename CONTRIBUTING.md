# Contributing to minecraft-mbot

## How to contribute

1. Open an issue or PR describing the change
2. Ensure the branch is based on `main`
3. Include tests (`npm test` passes)
4. Run `npm run check`, `npm run lint` and `npm run typecheck`
5. Attach evidence of real runs to the PR (CI artifact or comment); do not commit raw logs (see `docs/EVIDENCE.md`)

## Branch naming

- `feat/<name>` — new features
- `fix/<name>` — bug fixes
- `docs/<name>` — documentation
- `spike/<name>` — experiments

## CI requirements

- `npm audit --omit=dev --audit-level=high` — no high/critical vulnerabilities
- `npm run check` — all `.js` files must pass `node --check`
- `npm run lint` — ESLint (`no-empty`: an ignored error needs a comment saying why)
- `npm run typecheck` — `tsc` over `core/` and `app/`
- `npm test` — all test files must pass
- Nightly real-server soak (`.github/workflows/soak.yml`) must stay green
- Branch must be rebased on latest `main`

## Review process

- Technical review required for changes to `core/` or `lib/`
- Feature flags (`MBOT_*`) preferred for new behavior
- Survival mode must remain intact (no Creative/OP)
