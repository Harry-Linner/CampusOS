# Contributing to CampusOS

CampusOS is a local-first desktop workspace for ZJU students. Contributions must preserve the capability-driven plugin boundary: connectors obtain source data through core-owned sessions, and feature plugins consume versioned capabilities instead of source-specific imports.

## Development

1. Install dependencies with `pnpm install`.
2. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before opening a pull request.
3. Rebuild the native SQLite binding for Electron before Electron verification: `pnpm --filter @campusos/core rebuild:electron`.
4. Run the Electron smoke test with `pnpm --filter @campusos/core test:e2e`.

## Change scope

- Keep fixtures at explicit source-adapter boundaries. UI and business flows must use the production capability and IPC contracts.
- Do not expose passwords, cookies, sessions, tickets, response bodies, or access tokens to plugins or renderer code.
- Add focused tests for observable behavior. Mock only external network or data-source boundaries.
- Update `PRD.md`, `plan.md`, `research.md`, and applicable `docs/specs/` files when product scope, assumptions, or implementation status changes.

## Pull requests

Describe the user-visible change, test commands run, and any validation that still requires a real device or account. Do not commit credentials, generated packages, local databases, or test artifacts.
