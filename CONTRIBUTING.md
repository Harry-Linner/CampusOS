# Contributing to CampusOS

CampusOS is a local-first desktop workspace for ZJU students. A plugin is a user-selectable module that contributes exactly one first-level left-navigation destination. Core-managed connectors obtain source data through core-owned sessions; plugins consume versioned capabilities instead of source-specific imports.

## Development

1. Install dependencies with `pnpm install`.
2. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before opening a pull request.
3. Rebuild the native SQLite binding for Electron before Electron verification: `pnpm --filter @campusos/core rebuild:electron`.
4. Run the Electron smoke test with `pnpm --filter @campusos/core test:e2e`.

## Change scope

- Keep fixtures at explicit source-adapter boundaries. UI and business flows must use the production capability and IPC contracts.
- Do not expose passwords, cookies, sessions, tickets, response bodies, or access tokens to plugins or renderer code.
- Do not register connectors, event projectors, schedulers, search providers, notification policies, or export adapters as user-visible plugins.
- Keep subfeatures inside their owning module. A plugin must not add multiple first-level navigation destinations.
- Add focused tests for observable behavior. Mock only external network or data-source boundaries.
- Update `CONTEXT.md`（运行时决策/术语单一事实源）、`README.md`、`PRD.md`、`plan.md`（Current Development Workboard）和 applicable `docs/specs/` files when product scope, assumptions, or implementation status changes. Never create a second source of truth for runtime decisions that already live in `CONTEXT.md`.

## Pull requests

Describe the user-visible change, test commands run, and any validation that still requires a real device or account. Do not commit credentials, generated packages, local databases, or test artifacts.
