import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cuppingContentPageKey } from "../app/ui/dom/stable-cupping-screen-renderer-base";

test("cupping content scroll memory is keyed by session, sample and stage", () => {
  const aroma = {
    sessionId: "session-a",
    active: { context: { sampleId: "sample-2", stageId: "aroma" }, slice: { observations: [] } }
  } as never;
  const flavor = {
    sessionId: "session-a",
    active: { context: { sampleId: "sample-2", stageId: "flavor" }, slice: { observations: [] } }
  } as never;
  const otherSample = {
    sessionId: "session-a",
    active: { context: { sampleId: "sample-3", stageId: "aroma" }, slice: { observations: [] } }
  } as never;

  assert.equal(cuppingContentPageKey(aroma), "session-a:sample-2:aroma");
  assert.equal(cuppingContentPageKey(flavor), "session-a:sample-2:flavor");
  assert.equal(cuppingContentPageKey(otherSample), "session-a:sample-3:aroma");
});

test("final assessment sub-pages retain independent scroll positions", () => {
  const flavor = {
    sessionId: "session-a",
    active: {
      context: { sampleId: "sample-2", stageId: "final" },
      slice: { observations: [{ fieldKey: "final_phase", value: "flavor" }] }
    }
  } as never;
  const score = {
    sessionId: "session-a",
    active: {
      context: { sampleId: "sample-2", stageId: "final" },
      slice: { observations: [{ fieldKey: "final_phase", value: "score" }] }
    }
  } as never;

  assert.equal(cuppingContentPageKey(flavor), "session-a:sample-2:final:flavor");
  assert.equal(cuppingContentPageKey(score), "session-a:sample-2:final:score");
});

test("first visit resolves to top while revisits use page-specific memory", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer-base.ts", "utf8");
  assert.match(source, /scrollMemory\.get\(nextPageKey\) \?\? 0/);
  assert.match(source, /SCROLL_MEMORY_PREFIX = "aromasense\.cupping\.scroll\.v2:"/);
  assert.match(source, /this\.persistScrollMemory\(\)/);
  assert.match(source, /pageChanged/);
});

test("left rail uses one native vertical scroll layer and no fixed active overlay", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer-base.ts", "utf8");
  assert.match(source, /\.cupping-layout__rail-list\{/);
  assert.match(source, /overflow-y:auto!important/);
  assert.match(source, /touch-action:pan-y/);
  assert.match(source, /-webkit-overflow-scrolling:touch/);
  assert.match(source, /\.sample-rail__active-tab\{display:none!important\}/);
  assert.match(source, /\.sample-rail__item\.is-active::before/);
});
