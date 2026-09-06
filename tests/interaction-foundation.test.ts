import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  DraftGuard,
  FlowNavigation,
  NavigationManager,
  OverlayManager,
  RootExitGuard
} from "../app/ui/interaction-foundation";

const root = process.cwd();
const source = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("DraftGuard owns dirty-state confirmation only and attaches beforeunload only while dirty", () => {
  const events: string[] = [];
  const target = {
    addEventListener(type: string): void { events.push(`add:${type}`); },
    removeEventListener(type: string): void { events.push(`remove:${type}`); }
  };
  const guard = new DraftGuard(target);
  assert.equal(guard.decision(), "allow");
  assert.equal(guard.setDirty("sample-editor", true), true);
  assert.equal(guard.decision("sample-editor"), "confirm");
  assert.equal(guard.isDirty(), true);
  assert.equal(guard.clear("sample-editor"), false);
  assert.equal(guard.decision(), "allow");
  assert.deepEqual(events, ["add:beforeunload", "remove:beforeunload"]);
});

test("FlowNavigation resolves the latest highest-priority active handler", () => {
  const calls: string[] = [];
  const flow = new FlowNavigation();
  flow.register({ id: "older", priority: 1, back: () => { calls.push("older"); } });
  flow.register({ id: "newer", priority: 2, back: () => { calls.push("newer"); } });
  const top = flow.peek();
  assert.equal(top?.id, "newer");
  top?.back();
  assert.deepEqual(calls, ["newer"]);
});

test("RootExitGuard requires hint, confirmation and explicit confirmation before native exit", () => {
  let now = 1_000;
  const notices: string[] = [];
  const confirmations: Array<{ dirty: boolean; onConfirm(): void; onCancel(): void }> = [];
  let exits = 0;
  const draft = new DraftGuard();
  const guard = new RootExitGuard({
    draftGuard: draft,
    isNative: () => true,
    clock: () => now,
    notify: (message) => { notices.push(message); },
    openConfirmation: (options) => { confirmations.push(options); },
    exit: () => { exits += 1; }
  });

  assert.equal(guard.back(), true);
  assert.equal(notices.length, 1);
  assert.equal(confirmations.length, 0);
  assert.equal(exits, 0);

  now += 500;
  assert.equal(guard.back(), true);
  assert.equal(confirmations.length, 1);
  assert.equal(exits, 0);

  confirmations[0]!.onConfirm();
  assert.equal(exits, 1);
});

test("ordinary browser root is not trapped by application history or root-exit interception", () => {
  const overlays = new OverlayManager();
  const flow = new FlowNavigation();
  const draft = new DraftGuard();
  const rootExit = new RootExitGuard({
    draftGuard: draft,
    isNative: () => false,
    notify: () => undefined,
    openConfirmation: () => undefined,
    exit: () => { throw new Error("browser root must not exit through native guard"); }
  });
  const navigation = new NavigationManager({
    overlayManager: overlays,
    flowNavigation: flow,
    draftGuard: draft,
    rootExitGuard: rootExit
  });

  assert.equal(navigation.canGoBack(), false);
  assert.equal(navigation.back(), false);
});

test("NavigationManager resolves explicit flow before child route and root exit", () => {
  const calls: string[] = [];
  let flowActive = true;
  let childActive = true;
  const overlays = new OverlayManager();
  const flow = new FlowNavigation();
  const draft = new DraftGuard();
  flow.register({
    id: "cupping-stage",
    canBack: () => flowActive,
    back: () => { flowActive = false; calls.push("flow"); }
  });
  const rootExit = new RootExitGuard({
    draftGuard: draft,
    isNative: () => true,
    notify: () => { calls.push("root"); },
    openConfirmation: () => undefined,
    exit: () => undefined
  });
  const navigation = new NavigationManager({ overlayManager: overlays, flowNavigation: flow, draftGuard: draft, rootExitGuard: rootExit });
  navigation.registerChildBack({
    id: "screen:records",
    canBack: () => childActive,
    back: () => { childActive = false; calls.push("child"); }
  });

  assert.equal(navigation.back(), true);
  assert.equal(navigation.back(), true);
  assert.equal(navigation.back(), true);
  assert.deepEqual(calls, ["flow", "child", "root"]);
});

test("dirty flow delegates confirmation without DraftGuard navigating by itself", () => {
  const calls: string[] = [];
  let confirmed: (() => void) | undefined;
  const overlays = new OverlayManager();
  const flow = new FlowNavigation();
  const draft = new DraftGuard();
  draft.setDirty("sample-editor", true);
  flow.register({
    id: "sample-editor",
    scope: "sample-editor",
    leavesContext: true,
    back: () => { calls.push("back"); }
  });
  const rootExit = new RootExitGuard({
    draftGuard: draft,
    isNative: () => false,
    notify: () => undefined,
    openConfirmation: () => undefined,
    exit: () => undefined
  });
  const navigation = new NavigationManager({
    overlayManager: overlays,
    flowNavigation: flow,
    draftGuard: draft,
    rootExitGuard: rootExit,
    confirmDraftLeave: ({ onConfirm }) => { confirmed = onConfirm; }
  });

  assert.equal(navigation.back(), true);
  assert.deepEqual(calls, []);
  confirmed?.();
  assert.deepEqual(calls, ["back"]);
});

test("Stage 1 source contracts keep one scrim, semantic navigation and native/recognition bridges separated", () => {
  const foundation = source("app/ui/interaction-foundation.ts");
  const app = source("app/runtime/dom-app.ts");
  const entry = source("app/runtime/web-entry.ts");
  const blind = source("app/ui/dom/stable-cupping-screen-renderer.ts");
  const css = source("app/ui/dom/product-shell.css");
  const activity = source("mobile/android/app/src/main/java/com/zjcrop/aromasense/MainActivity.kt");
  const manifest = source("mobile/android/app/src/main/AndroidManifest.xml");

  assert.match(foundation, /class OverlayManager/);
  assert.match(foundation, /class NavigationManager/);
  assert.match(foundation, /class FlowNavigation/);
  assert.match(foundation, /class BackGestureAdapter/);
  assert.match(foundation, /class RootExitGuard/);
  assert.match(foundation, /class DraftGuard/);
  assert.match(foundation, /beforeunload/);
  assert.match(foundation, /再按一次返回以打开退出确认/);
  assert.doesNotMatch(foundation, /history\.pushState|history\.back\(|popstate/);

  assert.match(app, /InteractionFoundation/);
  assert.match(app, /registerChildBack/);
  assert.match(app, /overlayManager\.register/);
  assert.doesNotMatch(app, /history\.pushState|history\.back\(|popstate/);
  assert.match(entry, /window\.AromaSenseNavigation = app\.navigationApi\(\)/);

  assert.match(blind, /overlayManager\?\.register/);
  assert.doesNotMatch(blind, /blind-identity-editor[^`]*backdrop-filter:\s*blur\(/s);
  assert.match(css, /\.interaction-scrim\s*\{/);
  assert.match(css, /backdrop-filter:none!important/);
  assert.match(css, /\.home-modal,[\s\S]*\.blind-identity-editor,[\s\S]*\[data-interaction-managed="true"\]/);

  assert.match(activity, /addJavascriptInterface\(AromaSenseNativeBridge\(\), "AromaSenseNative"\)/);
  assert.match(activity, /addJavascriptInterface\(recognitionBridge, "LuckyBeanNative"\)/);
  assert.match(activity, /fun exitApp\(\)/);
  assert.match(activity, /AromaSenseNavigation.*systemBack/);
  assert.match(activity, /evaluateJavascript/);
  assert.match(activity, /OnBackInvokedDispatcher\.PRIORITY_DEFAULT/);
  assert.match(activity, /override fun onBackPressed\(\)\s*\{\s*handleSystemBack\(\)\s*\}/s);
  assert.match(activity, /removeJavascriptInterface\("AromaSenseNative"\)/);
  assert.match(activity, /removeJavascriptInterface\("LuckyBeanNative"\)/);
  assert.match(manifest, /android:enableOnBackInvokedCallback="true"/);
});
