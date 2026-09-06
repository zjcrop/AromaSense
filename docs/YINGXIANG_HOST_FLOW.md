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

## Sample code intake

The event sample-code list supports both direct editing and the same intake foundation used by AromaSense sample input:

- camera capture -> `SampleRecognitionService`;
- image upload -> `SampleRecognitionService`;
- spreadsheet -> `parseSpreadsheetFile`;
- pasted text -> `recognizeManualText`.

Imported codes replace the current textarea contents and dispatch the same input update used by direct editing, so the real-coffee mapping list refreshes immediately. Spreadsheet columns such as `编号`, `sample`, `sample name`, `name` and other existing sample-label aliases are accepted through the shared import schema. Explicit `sampleCode`/`code` metadata is preferred over a generic label when available.

Import does not silently remove duplicate codes. Duplicates are surfaced for correction and remain subject to `YINGXIANG_SAMPLE_CODE_DUPLICATE` when building the event manifest. Once participants exist, both direct editing and import controls are locked with the rest of the event structure.

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

## Real coffee mapping

The event manifest may store optional host coffee identity per event sample slot:

```text
coffee = {
  productName?, country?, region?, farm?, station?, variety?, roast?,
  process?, roaster?, altitude?, roastDate?, notes?
}
```

Input uses the same AromaSense recognition foundation:

- camera/photo upload -> `SampleRecognitionService`;
- spreadsheet -> `parseSpreadsheetFile`;
- pasted text -> `recognizeManualText`.

The review list maps imported coffee rows to the sample codes by current order. It reuses the shared `attachDragReorder` implementation, including the virtual source placeholder, FLIP placeholder movement and final drop placement.

Compact host display is:

```text
产品名
国家/产区（否则庄园/处理站）/豆种/烘焙度/……
```

`……` indicates that additional notes/award information exists. Clicking a coffee row opens the detailed editor. Sample-code blocks use fixed equal width and height.

Spreadsheet headers such as `备注`, `其他信息`, `奖项`, `荣誉`, `remark`, `award` and `winner` are preserved as `coffee.notes`. OCR text that contains obvious award markers such as `TOH` or `冠军` is retained as a reviewable note when no structured note field exists.

## Blindness boundary

Real coffee identity is host data. The Worker must not leak it to participants in `blind` or `semi_blind` events before the configured reveal boundary.

`publicEvent(..., owner=false)` therefore reduces non-open sample slots to only:

- `eventSampleId`
- `sampleCode`
- `order`

Coffee identity becomes participant-visible only for an open event, or after completion when `revealSampleIdentity = on_event_complete`.

## Compatibility and invariants

- Local cupping data remains Local-first; host-account and invitation changes do not move sensory edits to a server-first model.
- Old fixed-name invitations remain readable.
- Existing Firebase host ownership remains a migration compatibility path.
- Applied D1 migrations are never edited; recovery is introduced as numbered migration `0011` after host/sequence migration `0010`.
- Event structure remains locked once participants exist, including sample codes and real-coffee mapping, to prevent a sample identity from changing under already collected observations.
