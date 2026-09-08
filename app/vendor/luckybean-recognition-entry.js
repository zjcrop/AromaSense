// AromaSense consumes LuckyBean's audited browser-safe PP-OCR implementation.
// Chromium/Android Web use the restored SIMD module-Worker fast path; WebKit keeps
// the bounded direct-WASM/no-SIMD compatibility mode. ROI preprocessing remains
// Worker-only. No Tesseract or unknown OCR fallback is permitted.
import 'luckybean-static-app/src/recognition-paddle-ocr-fast.js';

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
const WEB_OCR_MAX_EDGE = 2200;

function hasAndroidNativeOcr() {
  return globalThis.__LUCKYBEAN_ANDROID__ === true &&
    typeof globalThis.LuckyBeanRecognitionBridge?.recognizeCoffeeBag === 'function';
}

async function recognizeCoffeeBag(images, options = {}) {
  if (hasAndroidNativeOcr()) return recognizeCoffeeBagUpstream(images, options);

  // Keep high-resolution camera decoding off the UI thread, but do not repeat the
  // former 1280/960px precision regression. The Foundation ROI worker decodes and
  // orientation-normalizes the frame, then bounds it to the full 2200px detector
  // budget before the restored PP-OCRv5 fast path runs once.
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
      message: `正在 Worker 中准备第 ${resultIndex}/${source.length} 张原图后识别`
    });
    const result = await recognizeImageRegion(image, FULL_FRAME_REGION, {
      locale: options.locale,
      maxEdge: WEB_OCR_MAX_EDGE
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
    engine: engine || 'PP-OCRv5-worker-full-detail',
    blocks,
    fullText: textGroups.join('\n\n'),
    results,
    serial: true,
    queueConcurrency: 1,
    batch: {
      mode: 'worker-full-detector-budget',
      maxEdge: WEB_OCR_MAX_EDGE,
      imageCount: source.length
    }
  };
}

async function preparePackageImage(file) {
  if (!(file instanceof Blob)) throw new TypeError('需要有效的图片文件');
  const android = hasAndroidNativeOcr();

  // Android keeps the original content:// URI contract. Web keeps the File opaque
  // on the UI thread; decode/orientation/resize happen in the Foundation Worker.
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
    status: android ? 'native-direct' : 'worker-full-detector-budget',
    nativeSource: android,
    warnings: []
  };
}

async function beginOcrSession(reason = 'aromasense-add-flow') {
  if (hasAndroidNativeOcr()) return null;
  const provider = globalThis.LuckyBeanPaddleOCR;
  if (typeof provider?.beginSession === 'function') return provider.beginSession(reason);
  return provider?.warmForRecognition?.() ?? provider?.preload?.() ?? null;
}
async function endOcrSession(reason = 'aromasense-add-flow') {
  if (hasAndroidNativeOcr()) return;
  const provider = globalThis.LuckyBeanPaddleOCR;
  if (typeof provider?.endSession === 'function') { await provider.endSession(reason); return; }
  await provider?.dispose?.();
}
async function warmOcr() {
  if (hasAndroidNativeOcr()) return null;
  const provider = globalThis.LuckyBeanPaddleOCR;
  return provider?.warmForRecognition?.() ?? provider?.preload?.() ?? null;
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
  beginOcrSession,
  endOcrSession,
  warmOcr,
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
