import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("setup replaces direct mode buttons with one four-mode cupping type select", () => {
  const source = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
  assert.match(source, /caption\.textContent = "杯测类型"/);
  assert.match(source, /for \(const mode of CUPPING_MODES\)/);
  assert.match(source, /\.batch-setup__target-direct"\)\?\.remove\(\)/);
  assert.match(source, /\.batch-setup__target-help"\)\?\.remove\(\)/);
  assert.doesNotMatch(source, /公开杯测为默认；盲测无需录入/);
});

test("free runtime removes timing UI and uses the production photo-recognition flow for bean additions", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(source, /if \(!policy\.timerEnabled\)/);
  assert.match(source, /\[data-cupping-timer\], \.cupping-completion-stamp/);
  assert.match(source, /manage\.textContent = "豆子管理"/);
  assert.match(source, /add\.textContent = "\+ 拍照识别添加豆子"/);
  assert.match(source, /SegmentationReviewRecognitionService/);
  assert.match(source, /runtimeRecognizer\.recognizePage\(file, 0\)/);
  assert.match(source, /controller\.addSample/);
  assert.match(source, /controller\.deleteSample/);
  assert.match(source, /captureResumeContext\(\)/);
  assert.match(source, /restoreResumeContext\(\)/);
  assert.match(source, /cuppingModeFromMetadata\(state\.sessionMetadata\) !== "free"/);
  assert.doesNotMatch(source, /controller\.addSample\(crypto\.randomUUID\(\), \{ metadata: \{\} \}/);
});
