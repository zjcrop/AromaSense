import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  BACK_PRIORITY,
  FlowNavigation,
  NavigationManager,
  RootExitGuard,
  resolveBackStep
} from "../app/ui/interaction-foundation";

test("back priority is keyboard, transient layer, dialog, modal, workflow, child, root", () => {
  assert.deepEqual(BACK_PRIORITY, ["keyboard", "picker", "dialog", "modal", "workflow", "child", "topLevelRoot", "appRoot"]);
  const visited: string[] = [];
  const step = resolveBackStep(Object.fromEntries(BACK_PRIORITY.map((name) => [name, () => {
    visited.push(name);
    return name === "dialog";
  }])));
  assert.equal(step, "dialog");
  assert.deepEqual(visited, ["keyboard", "picker", "dialog"]);
});

test("root exit requires two guarded backs and never guards an ordinary browser back", () => {
  let hints = 0;
  let confirmations = 0;
  const guard = new RootExitGuard({ windowMs: 2000, onHint: () => { hints += 1; }, onConfirm: () => { confirmations += 1; } });
  assert.equal(guard.request("browser", 1000), false);
  assert.equal(hints, 0);
  assert.equal(confirmations, 0);
  assert.equal(guard.request("android", 1000), true);
  assert.equal(guard.snapshot(1500).armed, true);
  assert.equal(hints, 1);
  assert.equal(guard.request("android", 2500), true);
  assert.equal(confirmations, 1);
  assert.equal(guard.snapshot(2500).armed, false);
  assert.equal(guard.request("android", 5000), true);
  assert.equal(guard.request("android", 8001), true);
  assert.equal(hints, 3);
  assert.equal(confirmations, 1);
});

test("flow and child navigation are LIFO and top-level siblings never create history depth", () => {
  const flow = new FlowNavigation();
  const actions: string[] = [];
  flow.register({ id: "first", previous: () => { actions.push("first"); } });
  const removeSecond = flow.register({ id: "second", previous: () => { actions.push("second"); } });
  assert.equal(flow.previous(), true);
  removeSecond();
  assert.equal(flow.previous(), true);
  assert.deepEqual(actions, ["second", "first"]);

  const navigation = new NavigationManager();
  let screen = "records";
  navigation.setTopLevelRoot({ current: () => screen, isAtRoot: () => screen === "setup", backToRoot: () => { screen = "setup"; } });
  assert.equal(navigation.backToTopLevelRoot(), true);
  assert.equal(navigation.snapshot().topLevelHistoryDepth, 0);
  assert.equal(navigation.backToTopLevelRoot(), false);
});

test("web, CSS and Android adapters use one scrim and explicit native exit", () => {
  const interaction = readFileSync("app/ui/interaction-foundation.ts", "utf8");
  const styles = readFileSync("app/ui/dom/interaction-foundation.css", "utf8");
  const webEntry = readFileSync("app/runtime/web-entry.ts", "utf8");
  const activity = readFileSync("mobile/android/app/src/main/java/com/zjcrop/aromasense/MainActivity.kt", "utf8");
  const manifest = readFileSync("mobile/android/app/src/main/AndroidManifest.xml", "utf8");
  const template = readFileSync("web/index.template.html", "utf8");
  const build = readFileSync("scripts/build-web.mjs", "utf8");
  const appSources = readdirSync("app", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:css|ts)$/.test(entry.name))
    .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, "utf8"))
    .join("\n");

  assert.match(interaction, /class OverlayManager/);
  assert.match(interaction, /class NavigationManager/);
  assert.match(interaction, /class FlowNavigation/);
  assert.match(interaction, /class BackGestureAdapter/);
  assert.match(interaction, /class RootExitGuard/);
  assert.match(interaction, /manage\(element: HTMLElement, kind\?: OverlayKind\)/);
  assert.doesNotMatch(interaction, /observe\(this\.document\.body/);
  assert.doesNotMatch(interaction, /popstate|history\.(?:pushState|replaceState|back|go)/);
  assert.match(styles, /--app-interaction-scrim:\s*rgba\(0,0,0,\.68\)/);
  assert.equal((styles.match(/--app-interaction-scrim:/g) || []).length, 1);
  assert.match(styles, /\[data-interaction-backdrop="true"\]\s*\{\s*background:\s*transparent/);
  assert.doesNotMatch(appSources, /(?:-webkit-)?backdrop-filter\s*:/);
  assert.doesNotMatch(appSources, /window\.(?:confirm|alert|prompt)\(/);
  assert.match(webEntry, /installInteractionFoundation/);
  assert.match(webEntry, /cupping-workflow/);
  assert.match(activity, /AromaSenseBackGestureAdapter/);
  assert.match(activity, /handleAndroidBack/);
  assert.match(activity, /fun exitApp\(\)/);
  assert.match(activity, /AromaSenseNative/);
  assert.doesNotMatch(activity, /super\.onBackPressed\(\)/);
  assert.match(manifest, /android:enableOnBackInvokedCallback="true"/);
  assert.match(template, /interaction-foundation\.css/);
  assert.match(build, /interaction-foundation\.css/);
});
