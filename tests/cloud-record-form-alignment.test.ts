import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("cloud record dialog is aligned to the existing account form design tokens", () => {
  const style = source("app/ui/dom/cloud-records-form-alignment.ts");
  assert.match(style, /width:min\(460px,calc\(100vw - 32px\)\)/u);
  assert.match(style, /border-radius:18px/u);
  assert.match(style, /font-size:22px/u);
  assert.match(style, /color:#b9995a/u);
  assert.match(style, /font-size:13px/u);
  assert.match(style, /min-height:44px/u);
  assert.match(style, /border-radius:10px/u);
  assert.match(style, /background:#1d1d1d/u);
  assert.match(style, /background:#242424/u);
  assert.match(style, /grid-template-columns:1fr 1fr/u);
});

test("signed-in account form receives a cloud records entry using the existing secondary button class", () => {
  const alignment = source("app/ui/dom/cloud-records-form-alignment.ts");
  const entry = source("app/runtime/web-entry.ts");
  assert.match(entry, /import "\.\.\/ui\/dom\/cloud-records-form-alignment"/u);
  assert.match(alignment, /\.account-card__status--good/u);
  assert.match(alignment, /className = "account-card__secondary"/u);
  assert.match(alignment, /button\.textContent = "云端记录"/u);
  assert.match(alignment, /source\.click\(\)/u);
});
