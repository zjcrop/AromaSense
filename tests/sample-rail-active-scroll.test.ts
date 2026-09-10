import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeSampleScrollTarget } from "../app/ui/dom/sample-rail-active-scroll";

test("active sample centers when there is enough scroll room", () => {
  const target = activeSampleScrollTarget({
    scrollTop: 0,
    scrollHeight: 1200,
    viewportTop: 100,
    viewportHeight: 400,
    cardTop: 560,
    cardHeight: 40
  });
  assert.equal(target, 280);
});

test("active sample clamps to the top edge for early samples", () => {
  const target = activeSampleScrollTarget({
    scrollTop: 120,
    scrollHeight: 1200,
    viewportTop: 100,
    viewportHeight: 400,
    cardTop: 118,
    cardHeight: 40
  });
  assert.equal(target, 0);
});

test("active sample clamps to the bottom edge for late samples", () => {
  const target = activeSampleScrollTarget({
    scrollTop: 500,
    scrollHeight: 1200,
    viewportTop: 100,
    viewportHeight: 400,
    cardTop: 690,
    cardHeight: 40
  });
  assert.equal(target, 800);
});

test("rail auto-scroll reacts to sample changes and compact/expanded geometry changes", () => {
  const source = readFileSync("app/ui/dom/sample-rail-active-scroll.ts", "utf8");
  assert.match(source, /attributeFilter:\s*\["data-active-sample-id",\s*"class"\]/);
  assert.match(source, /if \(record\.oldValue === current\) continue/);
  assert.match(source, /classList\.contains\("cupping-layout"\)/);
  assert.match(source, /railFromLayout\(target\)/);
  assert.match(source, /classList\.contains\("cupping-layout__rail-list"\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => \{/);
  assert.doesNotMatch(source, /textContent\s*=/);
});
