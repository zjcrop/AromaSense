# Yingxiang participant reveal lifecycle

## Scope

This contract applies to AromaSense participant sessions created from a Yingxiang event. It complements `YINGXIANG_PARTICIPANT_VISIBILITY.md` and governs the transition from an active blind/semi-blind event to organizer completion.

## Stable identity

`eventSampleId` is the only key used to reconcile the organizer manifest with a participant's local sample after join. The following are display or ordering properties and MUST NOT be used as identity keys:

- local array position
- `sortOrder`
- `displayNumber`
- visible label

A reveal must validate the complete local and remote sample sets before any local identity write occurs.

## Same-revision completion

Participant access remains pinned to the event revision used when the participant joined. The organizer may complete the event without changing that participant submission revision. Therefore a participant refresh MAY accept the same `eventRevision` only when all of these conditions hold:

1. event policy is unchanged;
2. organizer name, cupping mode, event sample ids, sample codes and sample orders are unchanged;
3. lifecycle status only moves forward;
4. previously disclosed labels or coffee facts are not changed or retracted;
5. new information is disclosure enrichment allowed by the event reveal policy.

Any structural mutation at the same revision is `YINGXIANG_EVENT_REVISION_CONFLICT`.

## Local reveal transaction

For `status=completed` with `revealSampleIdentity=on_event_complete`, blind and semi-blind participant sessions perform one local transaction:

1. refresh the participant event context;
2. resolve every local sample by `metadata.eventSampleId`;
3. replace event-controlled coffee identity fields with organizer manifest truth;
4. update the visible label from organizer label, product name, then sample code fallback;
5. set session `revealedAt`;
6. release the event-scoped participant principal.

Sensory observations, sample stable ids and existing workflow states are not rewritten by reveal.

## Submission finality

Reveal is a presentation/identity lifecycle event, not a new sensory submission. Once a final submission ACK has been stored and the remote event is closed, reveal-only changes MUST NOT:

- create a new `submission_revisions` row;
- generate a new content hash for delivery;
- call the submission endpoint again;
- replace the stored ACK revision/hash.

If an event closes before a participant ever receives a final ACK, the local record remains available but the delivery row records `YINGXIANG_EVENT_CLOSED_BEFORE_SUBMISSION`; the client must not loop on a submission the server can no longer accept.

## Ownership boundary

This is P1 AromaSense/Yingxiang lifecycle logic. It does not modify Recognition, Canonical, Dictionary or Foundation contracts, and it requires no SQLite migration.
