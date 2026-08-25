// Load LuckyBean's actual production browser OCR providers in the same order used
// by LuckyBean. The quality controller wraps LuckyBeanWebOCR, and the PP-OCRv5
// provider remains the preferred browser provider in recognition-bridge.js.
import 'luckybean-static-app/src/recognition-web-ocr.js';
import 'luckybean-static-app/src/recognition-quality-controller.js';
import 'luckybean-static-app/src/recognition-paddle-ocr.js';

import {
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
} from 'luckybean-static-app/src/recognition-core.js';

function parseNativePayload(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); }
  catch { return { fullText:String(value || '') }; }
}

if (typeof globalThis.AromaSenseRecognitionBridge?.recognizeSampleImage === 'function') {
  globalThis.LuckyBeanRecognitionBridge = {
    engine:'aromasense-native-adapter',
    async recognizeCoffeeBag(payload = {}) {
      const images = Array.isArray(payload.images) ? payload.images : [];
      const blocks = [];
      const texts = [];
      let engine = 'android-mlkit-bundled-16.0.1';
      for (const image of images) {
        const raw = await globalThis.AromaSenseRecognitionBridge.recognizeSampleImage(JSON.stringify({
          id:String(image?.id || ''),
          fileName:String(image?.fileName || image?.id || ''),
          mimeType:String(image?.mimeType || 'image/jpeg'),
          dataUrl:String(image?.dataUrl || ''),
          locale:'zh-CN'
        }));
        const result = parseNativePayload(raw);
        if (result?.error) throw new Error(String(result.error));
        engine = String(result?.engine || engine);
        const sourceBlocks = Array.isArray(result?.lines) ? result.lines : Array.isArray(result?.blocks) ? result.blocks : [];
        for (const block of sourceBlocks) {
          blocks.push({
            ...block,
            imageId:String(image?.id || block?.imageId || ''),
            imageRole:String(image?.role || block?.imageRole || 'front')
          });
        }
        const text = String(result?.fullText || '').trim();
        if (text) texts.push(text);
      }
      return { engine, blocks, fullText:texts.join('\n\n') };
    }
  };
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
