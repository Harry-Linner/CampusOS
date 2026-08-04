# ADR-0003: Windows system-calendar handoff uses RFC 5545 files

**Status:** Accepted

**Date:** 2026-08-04

## Context

The desktop schedule module must offer system-calendar export on Windows. Electron does not provide a portable, permission-safe API for writing arbitrary events into the user's native calendar account. Treating a successful file write as a successful calendar import would leave the user with a false success state when no application is associated with `.ics` files.

## Decision

CampusOS generates a standards-compliant RFC 5545 `.ics` file in the user's Documents/CampusOS directory and opens that file with Electron's default file association. The main process returns success only after both operations complete and `shell.openPath` reports an empty error string. The renderer receives the actual failure and shows it as an error.

The file name is deterministic for a selected term, so repeating an export replaces the previous CampusOS export for that term instead of accumulating duplicate files. Event UIDs are stable for unchanged event identity, which lets importing calendar clients update rather than duplicate events where supported.

CampusOS does not claim to have written directly to Outlook, Windows Calendar, or another account-backed calendar. Account-level sync, deletion from an already-imported calendar, and platform-specific native calendar APIs remain outside this adapter's contract.

## Consequences

- The handoff works offline and does not require an additional calendar permission.
- A machine without an `.ics` association fails visibly and can be repaired by the user without corrupting CampusOS data.
- Tests can verify exact bytes and the open-path failure boundary without mocking a native calendar account.
- Future native integrations must add a separate adapter and preserve the current file-export contract as a fallback.
