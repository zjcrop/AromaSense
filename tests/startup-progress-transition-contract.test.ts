import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const startup = readFileSync(resolve(process.cwd(), "app/ui/dom/startup-renderer.ts"), "utf8");
const home = readFileSync(resolve(process.cwd(), "app/ui/dom/home-action-enhancements.ts"), "utf8");

test("100 percent startup state has an enter path and homepage observers yield to the event loop", () => {
  assert.match(startup, /percent === 100/);
  assert.match(startup, /this\.maybeEnter\(\)/);
  assert.match(startup, /window\.setTimeout\(\(\) => \{ void this\.options\.onEnter\(\); \}, 180\)/);
  assert.match(home, /window\.setTimeout\(/);
  assert.match(home, /observer\.disconnect\(\)/);
  assert.doesNotMatch(home, /new MutationObserver\(scan\)/);
});
