import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { confirmSampleInput, validateSampleInput, type CoffeeFoundationGateway } from "../app/core/sample-input-pipeline";
import { activateSession, completeSession, createSession } from "../app/core/session-lifecycle";
import { cuppingCompletionTiming, cuppingElapsedSeconds, formatCuppingDuration } from "../app/core/cupping-timing";

const conflictGateway: CoffeeFoundationGateway = {
  resolve(field, value) {
    return {
      field,
      rawValue: value,
      normalizedValue: value,
      status: "conflict",
      reason: "ambiguous-recognition",
      selected: null
    };
  }
};

test("Foundation conflicts remain reviewable instead of making manual confirmation impossible", () => {
  const validation = validateSampleInput({
    label: "山嵐莊園",
    metadata: {
      canonical: {
        decisions: [{
          field: "farm",
          rawValue: "山嵐莊園",
          normalizedValue: "山嵐莊園",
          status: "conflict",
          reason: "ambiguous-recognition"
        }]
      }
    }
  });
  assert.equal(validation.state, "review");
  assert.equal(validation.marker, "?");
});

test("explicit human confirmation preserves conflict evidence without fabricating a canonical code", () => {
  const confirmed = confirmSampleInput({
    label: "山嵐莊園",
    metadata: { farm: "山嵐莊園" },
    requiresReview: true
  }, conflictGateway, "sample:1", "2026-09-05T13:02:03.000Z");

  const canonical = confirmed.metadata.canonical as {
    decisions: Array<{ status: string; selected?: { display?: string; canonicalId?: string | null; coreCode?: string | null } }>;
    manualOverrides?: Array<{ previousStatus?: string; confirmedValue?: string }>;
  };
  assert.equal(canonical.decisions[0]?.status, "confirmed");
  assert.equal(canonical.decisions[0]?.selected?.display, "山嵐莊園");
  assert.equal(canonical.decisions[0]?.selected?.canonicalId, null);
  assert.equal(canonical.decisions[0]?.selected?.coreCode, null);
  assert.equal(canonical.manualOverrides?.[0]?.previousStatus, "conflict");
  assert.equal(canonical.manualOverrides?.[0]?.confirmedValue, "山嵐莊園");
});

test("entering cupping sets a stable session start time and completion keeps it", () => {
  const draft = createSession({ sessionId: "timing-session", now: "2026-09-05T13:00:00.000Z" });
  assert.equal(draft.startedAt, undefined);
  const active = activateSession(draft, "2026-09-05T13:01:02.000Z");
  assert.equal(active.startedAt, "2026-09-05T13:01:02.000Z");
  assert.equal(activateSession(active, "2026-09-05T13:05:00.000Z").startedAt, active.startedAt);
  const completed = completeSession(active, "2026-09-05T13:08:09.000Z");
  assert.equal(completed.startedAt, active.startedAt);
  assert.equal(completed.completedAt, "2026-09-05T13:08:09.000Z");
});

test("elapsed timing is derived consistently from the persisted session start", () => {
  assert.equal(cuppingElapsedSeconds("2026-09-05T13:00:00.000Z", "2026-09-05T13:02:07.900Z"), 127);
  assert.deepEqual(formatCuppingDuration(127), { minutes: 2, seconds: 7, label: "2分 07秒" });
  const completion = cuppingCompletionTiming("2026-09-05T13:00:00.000Z", "2026-09-05T13:02:07.900Z");
  assert.equal(completion?.elapsedLabel, "2分 07秒");
  assert.match(completion?.clockLabel ?? "", /^\d{2}:\d{2}$/u);
});

test("score confirmation UI and left-rail timer contracts remain present", () => {
  const scoreSource = readFileSync("app/ui/dom/final-assessment-renderer.ts", "utf8");
  assert.match(scoreSource, /确认得分/u);
  assert.match(scoreSource, /确认得分后，本样品杯测记录将被锁定，无法修改/u);
  assert.match(scoreSource, /font-size:18px!important/u);
  assert.match(scoreSource, /font-weight:800!important/u);
  assert.match(scoreSource, /text-align:center/u);

  const screenSource = readFileSync("app/ui/dom/cupping-screen-renderer.ts", "utf8");
  assert.match(screenSource, /data-cupping-timer/u);
  assert.match(screenSource, /cupping-rail-timer__compact-line/u);
  assert.match(screenSource, /本进程完成/u);
  assert.match(screenSource, /得分已确认 · 本样品杯测记录已锁定为只读/u);
});

test("review dialog exposes pending state and asynchronous confirmation failures", () => {
  const source = readFileSync("app/ui/dom/batch-review-dialog.ts", "utf8");
  assert.match(source, /正在确认…/u);
  assert.match(source, /确认失败：/u);
  assert.match(source, /if \(confirming\) return/u);
});
