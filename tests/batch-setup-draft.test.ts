import assert from "node:assert/strict";
import test from "node:test";
import {
  batchSetupDraftCounts,
  firstPendingItemIndex,
  normalizeBatchSetupDraft,
  type BatchSetupDraftItem
} from "../app/core/batch-setup-draft";

function item(id: string, confirmed: boolean): BatchSetupDraftItem {
  return {
    id,
    label: id,
    metadata: { country: "Ethiopia" },
    requiresReview: !confirmed,
    confirmed
  };
}

test("batch draft normalizes serializable review rows", () => {
  const draft = normalizeBatchSetupDraft({
    version: 1,
    title: "Demo",
    updatedAt: "2026-08-25T12:00:00Z",
    items: [
      {
        id: "row-1",
        label: "Guji",
        metadata: { country: "Ethiopia" },
        previewDataUrl: "data:image/jpeg;base64,abc",
        recognitionStatus: "OCR",
        requiresReview: true,
        confirmed: false
      }
    ]
  });
  assert.equal(draft?.title, "Demo");
  assert.equal(draft?.items[0].previewDataUrl, "data:image/jpeg;base64,abc");
  assert.equal(draft?.items[0].confirmed, false);
});

test("pending lookup advances and wraps for interrupted confirmation", () => {
  const rows = [item("a", true), item("b", false), item("c", true), item("d", false)];
  assert.equal(firstPendingItemIndex(rows), 1);
  assert.equal(firstPendingItemIndex(rows, 1), 3);
  assert.equal(firstPendingItemIndex(rows, 3), 1);
  assert.deepEqual(batchSetupDraftCounts(rows), { confirmed: 2, pending: 2, total: 4 });
});

test("invalid draft payload is rejected", () => {
  assert.equal(normalizeBatchSetupDraft({ version: 1, items: [{ id: "", metadata: {} }] }), undefined);
  assert.equal(normalizeBatchSetupDraft({ version: 2, items: [] }), undefined);
});
