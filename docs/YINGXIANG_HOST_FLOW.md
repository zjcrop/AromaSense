# Yingxiang host flow

Status: B0.2 host-flow contract, 2026-09-06.

## Account boundary

Yingxiang host identity is independent from the AromaSense personal account.

- Opening **迎香** always presents the Yingxiang host login before the host console.
- The account name is never auto-filled or auto-submitted on entry.
- Normal login uses a random 256-bit device credential stored locally after account creation or recovery. The user still types the Yingxiang account name on every entry; the device credential prevents account-name-only impersonation.
- The host bearer token is kept in memory for the open host overlay and is discarded/logged out when the overlay closes.
- Existing Firebase/AromaSense-owned Yingxiang events remain readable through the legacy authenticated route during migration; new host UI uses `/api/v1/yingxiang/host/*`.

### Cross-device recovery

Cross-device recovery uses a separate one-time recovery credential. It does **not** weaken host authentication to account-name-only login.

- New host accounts receive a random 192-bit recovery code (48 hexadecimal characters).
- The Worker stores only a SHA-256-derived recovery hash bound to the normalized Yingxiang account key; the plaintext recovery code is returned only when created or rotated.
- Existing device-bound host accounts created before recovery support receive a recovery code on their next successful login from the already trusted device.
- `POST /api/v1/yingxiang/host/recover` requires the account name, the current recovery code and a newly generated 256-bit device credential.
- Successful recovery replaces the device credential, rotates the recovery code and deletes all existing host bearer tokens. The previous device credential and previous recovery code therefore stop working.
- `POST /api/v1/yingxiang/host/recovery/rotate` lets an authenticated host deliberately replace the recovery code.
- The browser may keep the current recovery code locally for convenience, but it is a credential and should also be stored separately by the host when cross-device recovery is required.

Cloud migration `0010_yingxiang_host_accounts_and_sequence.sql` adds the host-account/token tables. Migration `0011_yingxiang_host_recovery.sql` adds recovery hashes without changing existing account ownership. A shadow `users` row preserves the existing `yingxiang_events.owner_user_id` foreign-key contract; it is an implementation identity only and is not an AromaSense personal account.

## Single sample-list intake and ordering

Yingxiang now has one authoritative event sample list. The previous organizer workflow that uploaded a second “real coffee list” and mapped it positionally against the public/sample-code list has been removed.

The single sample-code list supports:

- direct one-code-per-line editing;
- camera capture through `SampleRecognitionService`;
- image upload through `SampleRecognitionService`;
- spreadsheet import through `parseSpreadsheetFile`;
- pasted text, with literal one-code-per-line input taking precedence over coffee semantic parsing;
- drag ordering through the shared `attachDragReorder` interaction.

The textarea, imported result and drag-order UI all write the same `sampleCodes` sequence. There is no second list and therefore no positional cross-list mapping state to reconcile.

Import does not silently remove duplicate codes. Duplicates remain visible and are rejected by `YINGXIANG_SAMPLE_CODE_DUPLICATE` when the event manifest is built. Once participants exist, sample editing and ordering are locked with the event structure.

Legacy event manifests may still contain the historical optional `coffee` object. The current host UI does not create, upload, compare or edit it. Existing values may be preserved opaquely when an old event is republished so historical records are not destructively rewritten. Worker-side blindness filtering remains in place for backward compatibility.

## Participant naming

`participantName.mode = organizer_assigned` means **automatic sequence naming**, not one fixed name per invitation.

- `requiredPrefix` is the host-configured prefix (for example `评委`).
- New invitations omit `assignedName`.
- Successful joins receive an event-wide monotonic ordinal and a display name such as `评委01`, `评委02`, ...
- The ordinal is stored in `yingxiang_participants.participant_ordinal` and is unique inside the event.
- Concurrent joins retry a sequence conflict rather than returning duplicate names.
- Existing invitations that already contain `assigned_name` remain valid and use that legacy fixed name.
- Personal AromaSense account display names cannot override organizer-assigned event identity.

## Invitation delivery

The host creates one invitation with a participant-capacity limit and expiry.

The UI renders:

1. a QR code containing the web invitation URL when available, otherwise the deep link;
2. the same invitation URL as text below the QR code;
3. a one-click copy action.

The QR is generated locally with the existing `qrcode` runtime dependency. No paid API or external QR service is introduced.

## Repeated-sample calibration

Repeated-sample calibration remains separate from sample-list intake. The organizer may group two or more event sample slots under one calibration identifier so repeated measurements of the same physical coffee can be compared statistically.

This feature does **not** upload a second coffee list and does not change the participant sample order. It stores only the event sample IDs participating in the calibration group plus the organizer-only calibration label.

## Recognition review contract

For multi-entry photo recognition, automatic OCR evidence and manual segmentation geometry are separate layers:

1. OCR creates positioned text evidence.
2. automatic segmentation proposes regions.
3. if the organizer adjusts a region, the **current geometry** becomes authoritative.
4. applying the review recalculates which OCR lines belong to each current region before semantic parsing runs again.
5. when the OCR characters themselves are wrong, explicit ROI re-recognition reruns OCR for that selected region.

A deterministic whole-image rerun of the same source is not treated as a correction mechanism because it normally reproduces the same OCR and segmentation output while consuming the same image-processing cost.

## Compatibility and invariants

- Local cupping data remains Local-first; host-account and invitation changes do not move sensory edits to a server-first model.
- Old fixed-name invitations remain readable.
- Existing Firebase host ownership remains a migration compatibility path.
- Applied D1 migrations are never edited; recovery is introduced as numbered migration `0011` after host/sequence migration `0010`.
- Event structure remains locked once participants exist, including sample codes and order.
- Legacy `coffee` fields remain readable and are still filtered by the Worker for blind/semi-blind participant payloads, but they are no longer part of the active organizer editing workflow.
