// AromaSense consumes LuckyBean's audited browser-safe PP-OCR implementation.
// Chromium/Android Web use a module Worker; WebKit intentionally uses the bounded
// direct-WASM/no-SIMD compatibility mode. ROI preprocessing remains Worker-only.
// No generic main-thread OCR fallback, Tesseract fallback, or Canvas image-quality
// pass is loaded here.
import 'luckybean-static-app/src/recognition-paddle-ocr.js';

import {
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
  RECOGNITION_RECORD_CANDIDATE_SCHEMA,
  RECOGNITION_RECORD_HYPOTHESIS_SCHEMA,
  RECOGNITION_STRUCTURE_RECOVERY_SCHEMA,
  AI_STRUCTURE_RESULT_SCHEMA,
  MULTI_ENTRY_SCHEMA,
  recognizeCoffeeBag as recognizeCoffeeBagUpstream,
  recognizeImageRegion,
  normalizeRecognitionRegion,
  getRecognitionCapabilities,
  createRecognitionDocument,
  recognitionDocumentFromText,
  groupRecognitionRecordCandidates,
  buildRecognitionRecordHypothesis,
  splitRecognitionEntries,
  normalizeAiStructureProposal,
  recoverRecognitionStructureLocal,
  recoverRecognitionStructure,
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

const FULL_FRAME_REGION = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 });
const WEB_OCR_MAX_EDGE = 1280;
const WEB_OCR_LOW_MEMORY_MAX_EDGE = 960;

function hasAndroidNativeOcr() {
  return globalThis.__LUCKYBEAN_ANDROID__ === true &&
    typeof globalThis.LuckyBeanRecognitionBridge?.recognizeCoffeeBag === 'function';
}

function boundedWebOcrEdge() {
  return globalThis.LuckyBeanPaddleOCR?.lowMemory === true
    ? WEB_OCR_LOW_MEMORY_MAX_EDGE
    : WEB_OCR_MAX_EDGE;
}

async function recognizeCoffeeBag(images, options = {}) {
  if (hasAndroidNativeOcr()) return recognizeCoffeeBagUpstream(images, options);

  // Never hand an original high-resolution camera Blob straight to PaddleOCR on Web.
  // The Foundation ROI path decodes/resizes in a dedicated Worker and returns a bounded
  // Blob first, so PaddleOCR's internal OffscreenCanvas.getImageData() can only allocate
  // pixels for <= 1280 px (<= 960 px after a remembered low-memory failure) instead of
  // the original 12/48 MP camera frame. This also keeps the expensive decode/resize off
  // the UI thread and avoids the short click-time freeze caused by a huge ImageData/GC.
  const blocks = [];
  const textGroups = [];
  let engine = '';
  let resultIndex = 0;
  const results = [];
  const source = Array.isArray(images) ? images : [];

  for (const image of source) {
    resultIndex += 1;
    options.onProgress?.({
      index: resultIndex - 1,
      total: source.length,
      status: 'processing',
      message: `正在 Worker 中压缩第 ${resultIndex}/${source.length} 张原图后识别`
    });
    const result = await recognizeImageRegion(image, FULL_FRAME_REGION, {
      locale: options.locale,
      maxEdge: boundedWebOcrEdge()
    });
    results.push(result);
    engine ||= String(result?.engine || '');
    const currentBlocks = Array.isArray(result?.blocks) ? result.blocks : [];
    blocks.push(...currentBlocks);
    const fullText = String(result?.fullText || '').trim();
    if (fullText) textGroups.push(fullText);
    options.onProgress?.({
      index: resultIndex,
      total: source.length,
      status: 'completed',
      message: `第 ${resultIndex}/${source.length} 张图片识别完成`
    });
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return {
    engine: engine || 'PP-OCRv5-bounded-full-frame',
    blocks,
    fullText: textGroups.join('\n\n'),
    results,
    serial: true,
    queueConcurrency: 1,
    batch: {
      mode: 'worker-bounded-full-frame',
      maxEdge: boundedWebOcrEdge(),
      imageCount: source.length
    }
  };
}

async function preparePackageImage(file) {
  if (!(file instanceof Blob)) throw new TypeError('需要有效的图片文件');
  const android = hasAndroidNativeOcr();

  // Critical anti-freeze path:
  // - Android: nativeSource=true makes LuckyBean's native bridge send no Base64;
  //   the Android bridge reads the already-retained content:// URI directly.
  // - Web: keep the original Blob opaque on the UI thread. The bounded full-frame
  //   recognition wrapper above moves decode + resize into the Foundation ROI Worker
  //   immediately before OCR; no UI-thread canvas/getImageData work is permitted here.
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
    status: android ? 'native-direct' : 'worker-bounded-full-frame',
    nativeSource: android,
    warnings: []
  };
}

globalThis.LuckyBeanRecognitionCore = Object.freeze({
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
  RECOGNITION_RECORD_CANDIDATE_SCHEMA,
  RECOGNITION_RECORD_HYPOTHESIS_SCHEMA,
  RECOGNITION_STRUCTURE_RECOVERY_SCHEMA,
  AI_STRUCTURE_RESULT_SCHEMA,
  MULTI_ENTRY_SCHEMA,
  preparePackageImage,
  recognizeCoffeeBag,
  recognizeImageRegion,
  normalizeRecognitionRegion,
  getRecognitionCapabilities,
  createRecognitionDocument,
  recognitionDocumentFromText,
  groupRecognitionRecordCandidates,
  buildRecognitionRecordHypothesis,
  splitRecognitionEntries,
  normalizeAiStructureProposal,
  recoverRecognitionStructureLocal,
  recoverRecognitionStructure,
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
