import assert from "node:assert/strict";
import test from "node:test";
import {
  loadBundledLuckyBeanRecognitionBook,
  type LuckyBeanRecognitionBook
} from "../app/core/luckybean-upstream-adapter";

const validBook: LuckyBeanRecognitionBook = {
  version: "test",
  countries: [["C", "Country"]],
  regions: [["R", "Region"]],
  entities: [["E", "Entity"]],
  varieties: [["V", "Variety"]],
  processes: [["P", "Process"]],
  flavors: [["F", "Flavor"]]
};

test("recognition book remains available when localStorage is unavailable", () => {
  const runtime = globalThis as typeof globalThis & { __AROMASENSE_RECOGNITION_BOOK__?: unknown };
  const previous = runtime.__AROMASENSE_RECOGNITION_BOOK__;
  runtime.__AROMASENSE_RECOGNITION_BOOK__ = structuredClone(validBook);
  try {
    const loaded = loadBundledLuckyBeanRecognitionBook();
    assert.equal(loaded.version, "test");
    assert.deepEqual(loaded.varieties, [["V", "Variety"]]);
  } finally {
    if (previous === undefined) delete runtime.__AROMASENSE_RECOGNITION_BOOK__;
    else runtime.__AROMASENSE_RECOGNITION_BOOK__ = previous;
  }
});
