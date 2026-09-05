import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bean-card editor keeps key fields first and defers low-frequency evidence", async () => {
  const source = await readFile("app/ui/dom/batch-review-dialog.ts", "utf8");
  const keyFields = source.indexOf('renderSection("关键字段"');
  const more = source.indexOf('"更多信息"');
  const evidence = source.indexOf('"来源与识别证据"');
  const sourceImage = source.indexOf('image.alt = "当前样品来源图片"');
  assert.ok(keyFields >= 0 && more > keyFields && evidence > more && sourceImage > evidence);
  assert.match(source, /field\.tier === "detail"/u);
});

test("bean-card short fields use three desktop columns and two mobile columns", async () => {
  const css = await readFile("app/ui/dom/batch-setup.css", "utf8");
  assert.match(css, /batch-review__grid--core\s*\{\s*grid-template-columns:\s*repeat\(3,/u);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*batch-review__grid--core\s*\{\s*grid-template-columns:\s*repeat\(2,/u);
  assert.match(css, /env\(safe-area-inset-left\)/u);
  assert.match(css, /batch-review__field--wide\s*\{\s*grid-column:\s*1 \/ -1/u);
});
