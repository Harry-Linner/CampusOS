# CampusOS Round 2 Specification

> Status: superseded by `docs/specs/campusos-interface-v3.md` and ADR-0002.
>
> This file records the current implementation contract where the historical Round 2 draft differs from the product that is shipped in this repository.

## Current Product Contract

CampusOS exposes exactly three user-facing official modules in the left activity bar:

| Module | Responsibilities |
| --- | --- |
| Academic | timetable, course catalog, exams, grades, and extracurricular credits |
| Schedule | month, week, day, tasks, planning, reminders, and iCal export |
| Materials | course materials, course filters, and download queue |

The desktop product does not include a campus-card feature. Campus-card functionality belongs to the mobile product and must not be registered, rendered, or listed as a desktop plugin.

The Schedule module is the single owner of calendar behavior. There is no standalone calendar plugin, desktop companion window, mini floating calendar, system-tray calendar process, or multi-window calendar architecture.

Core destinations remain dashboard, extensions, and settings. Connectors, event projection, scheduling, search, and export are implementation services used by the three modules rather than additional first-level plugins.

## Data And Domain Rules

- The timetable baseline for development is the real `2026-2027` autumn/winter academic-year feed stored only under `.tmp/development-baselines/`.
- Materials and new downloads use the real `2025-2026` spring/summer feed under the same ignored boundary.
- Calendar data is projected through `calendar.events@1`; course, exam, assignment, and task events are deduplicated by canonical event id.
- Refreshing a source replaces its capability feed totals instead of accumulating them across refreshes.
- iCal export consumes canonical events. `includeExams` filters canonical and legacy exam records, and `includeTasks` filters canonical and local task records.
- The academic module follows the Celechron 1.3.0 rules for major-course classification, GPA calculation, deferred exams, and failed grades. CampusOS only adapts transport, IPC, secure storage, and types.
- The grades capability preserves Celechron's independent `getMajorGrade` GPA/earned-credit projection. Major labels still come from `xkkh` matching; no local GPA weighting override is exposed.

## Implementation Status

Completed in the current implementation:

- three-module plugin model and left-bar registration;
- canonical calendar projection and source refresh replacement;
- timetable, exam, assignment, task, reminder, planning, and iCal integration;
- course catalog linkage and exam countdowns;
- Celechron-aligned grade and major-course rules;
- materials filtering and download queue;
- renderer sandbox, capability provenance, permission confirmation, and persistence boundaries.
- repeated real undergraduate verification on 2026-07-29, 2026-08-04, and
  2026-08-05, including the private timetable oracle, complete materials
  traversal, authenticated download, byte validation, and zero sensitive
  output.

Not claimed as complete:

- real graduate-account, multi-device, clean-Windows, desktop-notification, and release-package acceptance;
- any live upstream result based only on fixture, mock, build, or UI evidence.

## Historical Decisions Retained

Compliance, local-first storage, capability provenance, the pnpm monorepo, modular main-process services, renderer sandboxing, and CI/CD remain valid architectural decisions. Historical UX text that described a standalone calendar companion is superseded by the Current Product Contract above.

## Verification Gate

Every independently verifiable change must pass the relevant local checks, be committed and pushed, and have the GitHub Actions run for the current HEAD inspected with `gh` until completion. A live business endpoint is reported as passed only when a real account request, redacted upstream response, and user-visible result have all been observed.
