// AromaSense consumes LuckyBean's Worker-only PP-OCR implementation.
// No browser/main-thread OCR fallback or Canvas image-quality pass is loaded here.
import 'luckybean-static-app/src/recognition-paddle-ocr.js';

import {
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
  recognizeCoffeeBag,
  recognizeImageRegion,
  normalizeRecognitionRegion,
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

async function preparePackageImage(file) {
  if (!(file instanceof Blob)) throw new TypeError('需要有效的图片文件');
  const android = hasAndroidNativeOcr();

  // Critical anti-freeze path:
  // - Android: nativeSource=true makes LuckyBean's native bridge send no Base64;
  //   the Android bridge reads the already-retained content:// URI directly.
  // - Web: hand the original Blob directly to LuckyBean's PP-OCR Worker. Do not
  //   decode the camera image, inspect pixels, rotate, resize or re-encode it on
  //   the UI thread before recognition.
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
    status: android ? 'native-direct' : 'worker-direct',
    nativeSource: android,
    warnings: []
  };
}

globalThis.LuckyBeanRecognitionCore = Object.freeze({
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
  preparePackageImage,
  recognizeCoffeeBag,
  recognizeImageRegion,
  normalizeRecognitionRegion,
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
