# P3 Release Manifest — 2026-09-08

## Integration baseline

### AromaSense
- Repository: `zjcrop/AromaSense`
- Release integration commit: `f93153f715163fc4f392ddad126d56a94fd25092`
- Purpose: consume repaired OCR producer and verify deployed recognition.

### LuckyBean producer
- Repository: `zjcrop/luckybean`
- Producer pin consumed by AromaSense: `cdb23b36d796476e2477562a386eaac6987ff42f`
- Package version: `1.24.18`

## Verified gates

- AromaSense CI: passed
- Browser refresh acceptance: passed
- Production OCR verification path added:
  - deployment identity check
  - real JPEG OCR inference verification
  - runtime resource integrity validation

## Remaining release checks

- physical Android device camera OCR acceptance
- final APK artifact verification
- end-user regression on sync/delete recovery
- BrewProfiles runtime confirmation

## Constraints

- No paid service introduced.
- OCR remains based on existing shared Foundation implementation.
- Production release requires runtime verification, not source-only tests.
