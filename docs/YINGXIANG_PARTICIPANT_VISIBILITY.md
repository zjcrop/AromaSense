# Yingxiang participant visibility contract

This document records the participant-facing coffee-information boundary for Yingxiang events. It follows `docs/PROJECT_CONTEXT.md` and does not redefine Foundation Recognition or Canonical data.

## Active event visibility

| Event mode | Participant sample label / direct identity | Participant coffee metadata |
| --- | --- | --- |
| `open` | May be delivered | Full coffee detail carried by the Event Manifest |
| `semi_blind` | Hidden | `country`, `region`, `process`, `roast` only |
| `blind` | Hidden | None |

`eventSampleId`, `sampleCode`, and `order` are event coordination fields and remain available in all three modes. They are not canonical coffee identities.

The Worker is the first disclosure boundary. The AromaSense participant client applies the same rule again before writing a joined Session to local SQLite. A server regression that accidentally sends extra semi-blind or blind coffee fields therefore must not turn those fields into active local participant metadata.

## Reveal boundary

When an event is `completed` and its policy is `revealSampleIdentity = on_event_complete`, `publicEvent()` may return the full Event Manifest to the participant capability. `organizer_only` never grants that participant-facing reveal.

How an already-created local Session consumes a later revealed Event Manifest is a separate lifecycle concern; it must not weaken the active-event disclosure rules above.

## Persistence

No additional SQLite columns or tables are required. Participant-safe coffee fields are stored in the existing Sample `metadata_json` document together with stable event binding fields. Sample identity continues to use stable `sampleId` / `eventSampleId`; display order and sample code are not identity substitutes.
