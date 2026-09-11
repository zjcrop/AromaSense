import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flow = readFileSync("app/ui/dom/source-choice-layout-hotfix.ts", "utf8");
const home = readFileSync("app/ui/dom/home-action-enhancements.ts", "utf8");

test("batch intake first level stays six-source only", () => {
  assert.match(home, /const ordered = \[photo, split, text, sheet, link, qr\]/);
  assert.match(home, /ordered\.length === 6/);
  assert.match(flow, /\.import-source__photo-form\[hidden\]\{display:none!important\}/);
});

test("image and split tiles share one deferred lower source sheet", () => {
  assert.match(flow, /title !== "图片" && title !== "分割识别"/);
  assert.match(flow, /openSourceSheet\(title === "分割识别" \? "split" : "image", panel\)/);
  assert.match(flow, /data-source-camera>拍照<\/button>/);
  assert.match(flow, /data-source-upload>上传图片<\/button>/);
  assert.match(flow, /align-items:flex-end/);
});

test("shared sheet routes to normal image or split pipeline only after source choice", () => {
  assert.match(flow, /if \(mode === "split"\) startSplitImageSource\(panel, useCamera\)/);
  assert.match(flow, /else startNormalImageSource\(panel, useCamera\)/);
  assert.match(flow, /\[data-manual-split-photo\]/);
  assert.match(flow, /useCamera \? "\[data-camera\]" : "\[data-upload\]"/);
});
