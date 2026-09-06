# Cross-project Stage 1 — Global Interaction Foundation (AromaSense / Yingxiang)

Date: 2026-09-06  
Branch: `stage1-global-interaction-foundation-20260906`  
Stage 0 parent: `705b820` (`stage0-cross-project-baseline-20260906`)

This stage integrates the shared interaction contract into AromaSense and
Yingxiang without changing recognition semantics, Session lifecycle, SQLite
schema, authentication, event protocol, or cloud synchronization.

## Implemented contract

- One `OverlayManager` owns the visible `picker -> dialog -> modal` layer order.
- All registered layers share one `rgba(0,0,0,.68)` scrim; individual overlay
  backdrops are transparent and CSS backdrop blur is removed.
- `FlowNavigation`, `NavigationManager`, `BackGestureAdapter`, and
  `RootExitGuard` expose the same named boundary used by LuckyBean.
- Back order is keyboard, picker/popover, dialog, modal, workflow step, child
  screen, top-level root, then app-root exit guard.
- Top-level sibling screens never create browser history depth.
- Root exit needs two guarded native/app backs and then an explicit Exit click.
  A further Back while the confirmation is open only dismisses the dialog.
- Ordinary browser Back is not intercepted with History API state.
- Android API 33+ predictive/system Back and the legacy callback both call the
  JavaScript adapter; `finish()` is only exposed through the explicit
  `AromaSenseNative.exitApp()` bridge.
- Native `window.confirm` / `window.alert` calls in production UI were replaced
  with managed dialogs.

## Performance and lifecycle guard

The first implementation observed the complete `document.body` subtree. That
was rejected during review. The accepted implementation requires layers to be
registered explicitly and observes only a registered layer's own visibility
attributes plus its direct parent while that layer exists. This avoids a
permanent whole-application mutation scan.

## Verification observed in this environment

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run check` | pass; 167/167 tests |
| `npm run bundle:web` | pass; Pages and Android WebView outputs hardened |
| `git diff --check` | pass |

The passing suite includes Local-first transactions, migration/restart,
offline recovery, immutable revisions, stable event/sample identity, Yingxiang
invitation/submission isolation, and the new interaction contracts. No schema
or persisted data format changed in Stage 1.

## Environment limits and remaining acceptance

- Local Chromium interaction tests could not start because the pinned
  Playwright browser executable is absent. A fresh browser download again
  timed out at the environment proxy.
- No Gradle wrapper, system Gradle, Android SDK, emulator, or physical device is
  present in this checkout environment, so the Kotlin callback has source and
  contract coverage but no local APK execution claim.
- Manual acceptance remains required for layered dialogs, repeated Back,
  Android gestures, Safari/PWA behavior, and draft preservation before this
  foundation is frozen.

Stage 2 must not begin until this Stage 1 branch has CI/device acceptance.
