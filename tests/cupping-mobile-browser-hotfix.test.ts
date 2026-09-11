import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyMobileCuppingSwipe } from "../app/ui/dom/cupping-mobile-browser-hotfix";

test("mobile cupping swipe classifier separates horizontal node and vertical sample gestures", () => {
  assert.equal(classifyMobileCuppingSwipe(-80, 10), "left");
  assert.equal(classifyMobileCuppingSwipe(80, -8), "right");
  assert.equal(classifyMobileCuppingSwipe(8, -90), "up");
  assert.equal(classifyMobileCuppingSwipe(-10, 90), "down");
  assert.equal(classifyMobileCuppingSwipe(24, 18), undefined);
  assert.equal(classifyMobileCuppingSwipe(60, 55), undefined);
});

test("mobile cupping browser hotfix uses TouchEvent fallback and suppresses legacy touch PointerEvent handling", () => {
  const source = readFileSync("app/ui/dom/cupping-mobile-browser-hotfix.ts", "utf8");
  assert.match(source, /addEventListener\("touchstart"/);
  assert.match(source, /addEventListener\("touchend"/);
  assert.match(source, /pointerType !== "touch" && event\.pointerType !== "pen"/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /\.cupping-layout__main/);
});

test("mobile stage strip fits all node labels inside narrow viewports instead of horizontal clipping", () => {
  const source = readFileSync("app/ui/dom/cupping-mobile-browser-hotfix.ts", "utf8");
  assert.match(source, /@media \(max-width:640px\)/);
  assert.match(source, /grid-auto-columns:minmax\(0,1fr\)!important/);
  assert.match(source, /overflow-x:hidden!important/);
  assert.match(source, /font-size:clamp\(10px,3\.25vw,15px\)!important/);
  assert.match(source, /min-width:0!important/);
});

test("web runtime loads mobile cupping browser hotfix after existing cupping patches", () => {
  const source = readFileSync("app/runtime/web-entry.ts", "utf8");
  const oldPatch = source.indexOf('import "../ui/dom/cupping-adjacent-navigation-hotfix";');
  const mobilePatch = source.indexOf('import "../ui/dom/cupping-mobile-browser-hotfix";');
  assert.ok(oldPatch >= 0);
  assert.ok(mobilePatch > oldPatch);
});
