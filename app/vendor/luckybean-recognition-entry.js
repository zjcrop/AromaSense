// Load LuckyBean's production Worker-only browser OCR provider and shared
// recognition core. Android uses a separate build entry that first loads
// LuckyBean's own android/native-bridge.js transport.
import 'luckybean-static-app/src/recognition-quality-controller.js';
import 'luckybean-static-app/src/recognition-paddle-ocr.js';

import {
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
  preparePackageImage as preparePackageImageUpstream,
  recognizeCoffeeBag,
  getRecognitionCapabilities,
  createRecognitionDocument,
  recognitionDocumentFromText,
  analyzeRecognitionDocument,
  recognitionResultField,
  resolveRecognitionRelations,
  resolverPriorityDescription,
  codebookCandidates,
  scalarCandidates,
  fieldCandidates,
  reliableCandidates,
  normalizeEvidenceValue
} from 'luckybean-static-app/src/recognition-core.js';

function hasAndroidNativeOcr() {
  return globalThis.__LUCKYBEAN_ANDROID__ === true &&
    typeof globalThis.LuckyBeanRecognitionBridge?.recognizeCoffeeBag === 'function';
}

async function preparePackageImage(file, options) {
  // Critical mobile path: the Android file chooser already retains the original
  // content:// URI. Do not decode the full camera image in WebView, do not run
  // Canvas quality analysis/resampling, and do not Base64-encode the result back
  // across JavascriptInterface. LuckyBean's native bridge will send an empty
  // dataUrl and AromaSenseRecognitionBridge reads the original URI directly.
  if (hasAndroidNativeOcr()) {
    return {
      blob: file,
      originalName: file?.name || 'coffee-bag-image',
      originalSize: Number(file?.size || 0),
      width: 0,
      height: 0,
      processedWidth: 0,
      processedHeight: 0,
      metrics: null,
      score: 100,
      status: 'native-direct',
      nativeSource: true,
      warnings: []
    };
  }
  return preparePackageImageUpstream(file, options);
}

globalThis.LuckyBeanRecognitionCore = Object.freeze({
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
  preparePackageImage,
  recognizeCoffeeBag,
  getRecognitionCapabilities,
  createRecognitionDocument,
  recognitionDocumentFromText,
  analyzeRecognitionDocument,
  recognitionResultField,
  resolveRecognitionRelations,
  resolverPriorityDescription,
  codebookCandidates,
  scalarCandidates,
  fieldCandidates,
  reliableCandidates,
  normalizeEvidenceValue
});
