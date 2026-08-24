# AromaSense Versioning Policy

## Product version

Current product version: **B0.1.a**

Until AromaSense reaches its formally finalized release:

- every externally visible test build MUST use the prefix `B`;
- the major version MUST remain below `1`;
- the initial test line starts at `B0.1.a`;
- version numbers advance only when a coherent development milestone is completed and ready for acceptance;
- routine fixes, refactors, UI adjustments, and ordinary commits do NOT automatically increment the product version;
- avoid patch-style version inflation where every small change creates a new version identity.

## Milestone progression

The intended progression is milestone-based rather than commit-based. Examples:

- `B0.1.a` — initial integrated development baseline;
- `B0.1.b` — only after a meaningful grouped milestone is completed;
- `B0.2.a` — appropriate for a larger functional stage change;
- versions remain `< 1` and retain the `B` prefix until formal product finalization.

These examples are illustrative; they do not create an automatic increment schedule.

## Technical SemVer mapping

Some build/package tools require strict Semantic Versioning and cannot accept `B0.1.a` literally. In those files, AromaSense may use a technical mapping such as:

`B0.1.a` → `0.1.0-alpha.1`

The technical SemVer value is an implementation detail. The authoritative user-facing version remains the product version declared in `app/version.ts`.

## Release discipline

A version change should be made only when all changes assigned to that milestone have been integrated as a coherent implementation. A defect fix inside the same milestone normally remains on the same product version unless it materially changes the release boundary or acceptance scope.
