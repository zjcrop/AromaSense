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

test("a persisted session start time remains stable through completion", () => {
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

test("competition timing uses persisted wall clock, 30-minute cues, wake lock and interruption-safe lifecycle", () => {
  const flowSource = readFileSync("app/ui/dom/cupping-flow-enhancements.ts", "utf8");
  const screenSource = readFileSync("app/ui/dom/cupping-screen-renderer.ts", "utf8");
  const latestUi = readFileSync("app/ui/dom/cupping-latest-ui-finalize.ts", "utf8");

  assert.match(screenSource, /data-cupping-timer/u);
  assert.match(screenSource, /cupping-rail-timer__compact-line/u);
  assert.match(screenSource, /本进程完成/u);
  assert.match(flowSource, /const MILESTONE_SECONDS = 30 \* 60/u);
  assert.match(flowSource, /competitionStartedAt \?\? state\?\.sessionStartedAt/u);
  assert.match(flowSource, /Date\.parse\(start\)/u);
  assert.match(flowSource, /document\.addEventListener\("visibilitychange"/u);
  assert.match(flowSource, /nav\.wakeLock/u);
  assert.match(flowSource, /比赛进行中，不可退出/u);
  assert.match(flowSource, /competitionLockedAt/u);
  assert.match(latestUi, /aromasense-stage-completion-triple-flash 2100ms/);
});

test("review dialog exposes pending state and asynchronous confirmation failures", () => {
  const source = readFileSync("app/ui/dom/batch-review-dialog.ts", "utf8");
  assert.match(source, /正在确认…/u);
  assert.match(source, /确认失败：/u);
  assert.match(source, /if \(confirming\) return/u);
});
