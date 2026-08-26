import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";
import { parseSpreadsheetFile } from "../app/core/spreadsheet-import";

function workbookFile(sheets: Record<string, unknown[][]>, name = "cupping.xlsx"): File {
  const workbook = utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), sheetName);
  }
  const bytes = write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

test("each worksheet becomes a cupping group when no explicit group column exists", async () => {
  const file = workbookFile({
    Morning: [
      ["名称", "国家", "产区", "品种", "处理法"],
      ["A", "Ethiopia", "Guji", "74110", "Washed"],
      ["B", "Kenya", "Nyeri", "SL28", "Washed"]
    ],
    Afternoon: [
      ["名称", "国家", "产区", "品种", "处理法"],
      ["C", "Panama", "Boquete", "Gesha", "Natural"]
    ]
  });
  const bundle = await parseSpreadsheetFile(file);
  assert.equal(bundle.sessions.length, 2);
  assert.deepEqual(bundle.sessions.map((session) => session.sourceGroup), ["Morning", "Afternoon"]);
  assert.deepEqual(bundle.sessions.map((session) => session.samples.length), [2, 1]);
  assert.equal(bundle.sessions[0].samples[0].metadata.country, "Ethiopia");
  assert.equal(bundle.sessions[1].samples[0].metadata.variety, "Gesha");
});

test("explicit cup group column splits one worksheet into multiple sessions", async () => {
  const file = workbookFile({
    Import: [
      ["杯测组", "日期", "组织方", "名称", "国家", "品种"],
      ["上午组", "2026-08-26", "Lab", "A", "Ethiopia", "74110"],
      ["上午组", "2026-08-26", "Lab", "B", "Kenya", "SL28"],
      ["下午组", "2026-08-26", "Lab", "C", "Panama", "Gesha"]
    ]
  });
  const bundle = await parseSpreadsheetFile(file);
  assert.equal(bundle.sessions.length, 2);
  assert.deepEqual(bundle.sessions.map((session) => session.title), ["上午组", "下午组"]);
  assert.deepEqual(bundle.sessions.map((session) => session.samples.length), [2, 1]);
  assert.equal(bundle.sessions[0].metadata.organizer, "Lab");
  assert.equal(bundle.sessions[1].metadata.date, "2026-08-26");
});
