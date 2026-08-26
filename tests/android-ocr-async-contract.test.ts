import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridge = readFileSync(
  "mobile/android/app/src/main/java/com/zjcrop/aromasense/AromaSenseRecognitionBridge.kt",
  "utf8"
);
const activity = readFileSync(
  "mobile/android/app/src/main/java/com/zjcrop/aromasense/MainActivity.kt",
  "utf8"
);
const androidEntry = readFileSync("app/vendor/luckybean-recognition-android-entry.js", "utf8");
const commonEntry = readFileSync("app/vendor/luckybean-recognition-entry.js", "utf8");

test("Android OCR uses LuckyBean asynchronous requestId bridge and never waits synchronously", () => {
  assert.match(bridge, /fun recognizeImage\(requestId: String, imageId: String, imageRole: String, dataUrl: String\)/);
  assert.match(bridge, /LuckyBeanNativeRecognition.*resolve/s);
  assert.match(bridge, /LuckyBeanNativeRecognition.*reject/s);
  assert.match(bridge, /Executors\.newSingleThreadExecutor/);
  assert.doesNotMatch(bridge, /Tasks\.await\s*\(/);
  assert.doesNotMatch(bridge, /fun\s+recognizeSampleImage\s*\([^)]*\)\s*:\s*String/);
});

test("Android artifact directly reuses LuckyBean native bridge while Pages common entry has no AromaSense native wrapper", () => {
  assert.match(activity, /addJavascriptInterface\(recognitionBridge, "LuckyBeanNative"\)/);
  assert.match(androidEntry, /luckybean-static-app\/android\/native-bridge\.js/);
  assert.doesNotMatch(commonEntry, /globalThis\.AromaSenseRecognitionBridge/);
  assert.doesNotMatch(commonEntry, /luckybean-static-app\/android\/native-bridge\.js/);
});
