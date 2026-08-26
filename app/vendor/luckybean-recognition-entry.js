// Load LuckyBean's actual production browser OCR providers in the same order used
// by LuckyBean. Android uses a separate build entry which additionally loads
// LuckyBean's own android/native-bridge.js transport.
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
