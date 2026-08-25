import {
  RECOGNITION_DOCUMENT_SCHEMA,
  RECOGNITION_PIPELINE_VERSION,
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
