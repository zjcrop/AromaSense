import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { centeredRailScrollTop } from "../app/ui/dom/cupping-rail-centering";

test("active rail item centers when there is enough scroll range", () => {
  assert.equal(centeredRailScrollTop(200, 300, 1000, 180, 40), 250);
});

test("active rail item clamps to top for early samples", () => {
  assert.equal(centeredRailScrollTop(0, 300, 1000, 20, 40), 0);
});

test("active rail item clamps to bottom for late samples", () => {
  assert.equal(centeredRailScrollTop(650, 300, 1000, 260, 40), 700);
});

test("rail centering follows explicit user transitions without adding another MutationObserver", () => {
  const source = readFileSync("app/ui/dom/cupping-rail-centering.ts", "utf8");
  assert.match(source, /\.sample-rail__select/u);
  assert.match(source, /\[data-rail-toggle\]/u);
  assert.match(source, /\.cupping-layout__main/u);
  assert.match(source, /document\.addEventListener\("pointerdown", handleMainPointerDown, true\)/u);
  assert.match(source, /CENTER_SETTLE_DELAY_MS/u);
  assert.match(source, /list\.scrollTo\(\{ top: target, behavior \}\)/u);
  assert.doesNotMatch(source, /MutationObserver/u);
});
