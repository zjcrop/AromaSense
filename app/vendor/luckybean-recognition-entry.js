// AromaSense consumes the audited Foundation PP-OCR fast-path snapshot below.
// The snapshot is pinned to the producer commit recorded in recognition-paddle-ocr-fast.js;
// the existing LuckyBean package continues to provide recognition-core and runtime assets
// until producer CI passes and the immutable package pin is advanced.
import './recognition-paddle-ocr-fast.js';

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
let ocrSessionOwned = false;

function hasAndroidNativeOcr() {
  return globalThis.__LUCKYBEAN_ANDROID__ === true &&
    typeof globalThis.LuckyBeanRecognitionBridge?.recognizeCoffeeBag === 'function';
}

async function recognizeCoffeeBag(images, options = {}) {
  if (hasAndroidNativeOcr()) return recognizeCoffeeBagUpstream(images, options);

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
  if (ocrSessionOwned) return provider?.warmForRecognition?.() ?? provider?.preload?.() ?? null;
  ocrSessionOwned = true;
  try {
    if (typeof provider?.beginSession === 'function') return await provider.beginSession(reason);
    return await (provider?.warmForRecognition?.() ?? provider?.preload?.() ?? null);
  } catch (error) {
    ocrSessionOwned = false;
    throw error;
  }
}
async function endOcrSession(reason = 'aromasense-add-flow') {
  if (hasAndroidNativeOcr() || !ocrSessionOwned) return;
  ocrSessionOwned = false;
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
