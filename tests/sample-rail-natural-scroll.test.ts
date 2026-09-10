import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeSampleScrollTarget } from "../app/ui/dom/sample-rail-natural-scroll";

test("active sample target centers and clamps without resetting to the first sample", () => {
  assert.equal(activeSampleScrollTarget({
    scrollTop: 480,
    scrollHeight: 2200,
    viewportTop: 100,
    viewportHeight: 600,
    cardTop: 660,
    cardHeight: 60
  }), 770);
  assert.equal(activeSampleScrollTarget({
    scrollTop: 0,
    scrollHeight: 2200,
    viewportTop: 100,
    viewportHeight: 600,
    cardTop: 90,
    cardHeight: 60
  }), 0);
  assert.equal(activeSampleScrollTarget({
    scrollTop: 1500,
    scrollHeight: 2200,
    viewportTop: 100,
    viewportHeight: 600,
    cardTop: 720,
    cardHeight: 60
  }), 1600);
});

test("rail auto-positioning only observes a genuine active-sample change", () => {
  const source = readFileSync("app/ui/dom/sample-rail-natural-scroll.ts", "utf8");
  const entry = readFileSync("app/runtime/web-entry.ts", "utf8");

  assert.match(entry, /sample-rail-natural-scroll/);
  assert.doesNotMatch(entry, /sample-rail-active-scroll/);
  assert.match(source, /attributeFilter:\s*\["data-active-sample-id"\]/);
  assert.match(source, /record\.attributeName !== "data-active-sample-id"/);
  assert.doesNotMatch(source, /attributeFilter:[\s\S]*"class"/);
  assert.match(source, /scroll-behavior:auto!important/);
  assert.match(source, /overflow-anchor:none!important/);
  assert.match(source, /delta > root\.clientHeight \* 0\.9/);
  assert.match(source, /longJump \? "auto" : "smooth"/);
});