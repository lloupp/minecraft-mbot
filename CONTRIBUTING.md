# Contributing to minecraft-mbot

## How to contribute

1. Open an issue or PR describing the change
2. Ensure the branch is based on `main`
3. Include tests (`npm test` passes)
4. Run `npm run check` (syntax check)

## Branch naming

- `feat/<name>` — new features
- `fix/<name>` — bug fixes
- `docs/<name>` — documentation
- `spike/<name>` — experiments

## CI requirements

- `npm run check` — all `.js` files must pass `node --check`
- `npm test` — all test files must pass
- Branch must be rebased on latest `main`

## Review process

- Technical review required for changes to `core/` or `lib/`
- Feature flags (`MBOT_*`) preferred for new behavior
- Survival mode must remain intact (no Creative/OP)
