// Audited Foundation OCR fast-path snapshot from zjcrop/luckybean commit
// 8d088f4c30772ec4d5c1316abd5c84985dba55cb. Keep this file byte-for-byte
// aligned with src/recognition-paddle-ocr-fast.js until the immutable dependency
// pin is advanced after producer CI passes.
const VERSION = '0.5.1-fastpath';
const ENGINE = `PP-OCRv5-browser-${VERSION}-self-hosted`;

function isAppleMobileLike() {
  const ua = String(globalThis.navigator?.userAgent || '');
  return /iPhone|iPad|iPod/i.test(ua)
    || (globalThis.navigator?.platform === 'MacIntel' && Number(globalThis.navigator?.maxTouchPoints || 0) > 1);
}
function isWebKitFamily() {
  const ua = String(globalThis.navigator?.userAgent || '');
  return /AppleWebKit/i.test(ua) && !/(Chrome|Chromium|CriOS|Edg|OPR|SamsungBrowser)/i.test(ua);
}

const APPLE_MOBILE = isAppleMobileLike();
const WEBKIT = isWebKitFamily();
const DEVICE_MEMORY_GB = Number(globalThis.navigator?.deviceMemory || 0);
const LOW_MEMORY = APPLE_MOBILE || (DEVICE_MEMORY_GB > 0 && DEVICE_MEMORY_GB <= 4);
const LIMIT_SIDE = LOW_MEMORY ? 736 : 960;
const MAX_SIDE = 2200;
const ENGINE_INIT_TIMEOUT_MS = WEBKIT ? 30000 : 60000;
const PREDICT_TIMEOUT_MS = WEBKIT ? 30000 : 45000;
const ROI_CROP_TIMEOUT_MS = 20000;
const OUTSIDE_SESSION_IDLE_MS = 120000;

let modulePromise = null;
let enginePromise = null;
let engineGeneration = 0;
let engineMode = WEBKIT ? 'webkit-direct-wasm-no-simd' : 'worker-simd-fastpath';
let busy = false;
let disposeTimer = 0;
let sessionDepth = 0;
let pendingEnd = false;
let forceCompatibility = false;
let roiRequestSequence = 0;
const activeWorkers = new Set();

function diagnosticNow() { return Number(globalThis.performance?.now?.() ?? Date.now()); }
function recordDiagnostic(phase, startedAt, detail = {}) {
  const sink = globalThis.__LUCKYBEAN_RECOGNITION_DIAGNOSTICS__;
  if (typeof sink?.record !== 'function') return;
  try { sink.record({ scope:'ocr', phase:String(phase), durationMs:Math.max(0, diagnosticNow() - Number(startedAt || 0)), ...detail }); } catch {}
}
function emit(status, progress = 0) {
  const detail = { status:String(status || ''), progress:Math.max(0, Math.min(100, Number(progress) || 0)) };
  globalThis.dispatchEvent(new CustomEvent('luckybean:ocr-progress', { detail }));
  globalThis.dispatchEvent(new CustomEvent('coffee-foundation:ocr-progress', { detail }));
}
function timeoutError(message) { const error = new Error(message); error.name = 'RecognitionTimeoutError'; return error; }
function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timer = 0;
  const timeout = new Promise((_, reject) => { timer = globalThis.setTimeout(() => { try { onTimeout?.(); } catch {} reject(timeoutError(message)); }, timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timer));
}
function delay(ms) { return new Promise(resolve => globalThis.setTimeout(resolve, ms)); }
function clamp01(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback; }
function normalizeRegion(input) {
  const source = input && typeof input === 'object' ? input : {};
  const left = clamp01(source.left), top = clamp01(source.top), right = clamp01(source.right, 1), bottom = clamp01(source.bottom, 1);
  if (right - left < 0.01 || bottom - top < 0.01) throw new Error('ROI 范围过小或无效');
  return Object.freeze({ left, top, right, bottom });
}

function defaultRuntimeBase() { return new URL('../../public/vendor/paddleocr/', import.meta.url); }
function runtimeBase() {
  const configured = String(globalThis.CoffeeFoundationOcrAssetBase || '').trim();
  if (configured) { try { return new URL(configured, globalThis.location?.href || 'http://localhost/'); } catch {} }
  return defaultRuntimeBase();
}
function assetUrl(relativePath) { return new URL(relativePath, runtimeBase()).href; }

async function cropRegionInWorker(blob, regionInput, options = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('ROI 原图不可用');
  const startedAt = diagnosticNow();
  const region = normalizeRegion(regionInput);
  const requestId = `roi-${Date.now().toString(36)}-${(++roiRequestSequence).toString(36)}`;
  const worker = new Worker(assetUrl('roi-worker.js'), { type:'classic', name:'luckybean-roi-crop' });
  let settled = false;
  const cleanup = () => { if (settled) return; settled = true; try { worker.terminate(); } catch {} };
  const operation = new Promise((resolve, reject) => {
    worker.onmessage = event => {
      if (String(event.data?.requestId || '') !== requestId) return;
      if (event.data?.ok !== true) { cleanup(); reject(new Error(String(event.data?.error || 'ROI Worker 裁剪失败'))); return; }
      const result = event.data; cleanup(); resolve(result);
    };
    worker.onerror = event => { cleanup(); reject(new Error(`ROI Worker 运行失败：${event.message || 'unknown error'}`)); };
    worker.postMessage({ requestId, blob, region, maxEdge:Number(options.maxEdge || MAX_SIDE) });
  });
  try { return await withTimeout(operation, ROI_CROP_TIMEOUT_MS, 'ROI Worker 裁剪超时，已终止本次局部识别', cleanup); }
  finally { recordDiagnostic('roi-crop', startedAt); }
}

async function loadModule() {
  if (!modulePromise) {
    emit('正在加载本地 PP-OCRv5 运行时', 2);
    modulePromise = import(assetUrl('sdk.mjs')).catch(error => { modulePromise = null; throw new Error(`本地 PP-OCRv5 SDK 加载失败：${error.message}`); });
  }
  return modulePromise;
}
function trackWorker(worker) { activeWorkers.add(worker); return worker; }
function terminateWorkers() { for (const worker of activeWorkers) { try { worker.terminate(); } catch {} } activeWorkers.clear(); }
function createModuleWorker() { return trackWorker(new Worker(assetUrl('worker.js'), { type:'module', name:'luckybean-ppocr-v5-fast' })); }
function ocrCreateOptions({ compatibility = false, forceWorker = false } = {}) {
  return {
    lang:'ch', ocrVersion:'PP-OCRv5',
    textDetectionModelName:'PP-OCRv5_mobile_det', textDetectionModelAsset:{ url:assetUrl('models/PP-OCRv5_mobile_det_onnx_infer.tar') },
    textRecognitionModelName:'PP-OCRv5_mobile_rec', textRecognitionModelAsset:{ url:assetUrl('models/PP-OCRv5_mobile_rec_onnx_infer.tar') },
    ...((forceWorker || !compatibility) ? { worker:{ createWorker:createModuleWorker } } : {}),
    textDetectionBatchSize:1, textRecognitionBatchSize:1,
    ortOptions:{ backend:'wasm', wasmPaths:assetUrl('ort/'), numThreads:1, simd:!compatibility }
  };
}
async function createWorkerEngine({ compatibility = false } = {}) {
  const module = await loadModule(); if (!module?.PaddleOCR?.create) throw new Error('PP-OCRv5 SDK 接口不可用');
  return module.PaddleOCR.create(ocrCreateOptions({ compatibility, forceWorker:true }));
}
async function createWebKitEngine() {
  const module = await loadModule(); if (!module?.PaddleOCR?.create) throw new Error('PP-OCRv5 SDK 接口不可用');
  return module.PaddleOCR.create(ocrCreateOptions({ compatibility:true, forceWorker:false }));
}
function looksLikeCompatibilityFailure(error) {
  return /Unknown worker error|Failed to construct.*Worker|SecurityError|WebAssembly|WASM|out of memory|could not allocate memory|InferenceSession|ONNX session|No available adapters/iu.test(String(error?.message || error || ''));
}
function disposeInstance(ocr) { if (ocr?.dispose) Promise.resolve(ocr.dispose()).catch(() => {}); }
function detachEngine() {
  const current = enginePromise; enginePromise = null; engineGeneration += 1; terminateWorkers();
  if (current) current.then(disposeInstance).catch(() => {});
}
async function startWorkerWithMode(compatibility, generation, startedAt, reason = '') {
  engineMode = compatibility ? 'worker-no-simd-fallback' : 'worker-simd-fastpath';
  const raw = createWorkerEngine({ compatibility });
  try {
    const label = compatibility ? 'PP-OCRv5 无 SIMD Worker 初始化超时' : 'PP-OCRv5 Worker 初始化超时';
    const ocr = await withTimeout(raw, ENGINE_INIT_TIMEOUT_MS, label, terminateWorkers);
    if (generation !== engineGeneration) { disposeInstance(ocr); throw new Error('PP-OCRv5 初始化结果已失效'); }
    recordDiagnostic(compatibility ? 'runtime-init-fallback' : 'runtime-init', startedAt, { mode:engineMode, sessionDepth, lowMemory:LOW_MEMORY, reason });
    return ocr;
  } catch (error) { raw.then(disposeInstance).catch(() => {}); terminateWorkers(); throw error; }
}
async function startEngine() {
  const generation = ++engineGeneration; const startedAt = diagnosticNow();
  if (WEBKIT) {
    engineMode = 'webkit-direct-wasm-no-simd';
    const raw = createWebKitEngine();
    try {
      const ocr = await withTimeout(raw, ENGINE_INIT_TIMEOUT_MS, 'PP-OCRv5 Safari 初始化超时', () => {});
      if (generation !== engineGeneration) { disposeInstance(ocr); throw new Error('PP-OCRv5 初始化结果已失效'); }
      recordDiagnostic('runtime-init', startedAt, { mode:engineMode, sessionDepth, lowMemory:LOW_MEMORY }); return ocr;
    } catch (error) { raw.then(disposeInstance).catch(() => {}); throw error; }
  }
  if (forceCompatibility) {
    emit('正在使用本次录入会话已确认需要的无 SIMD Worker', 10);
    return startWorkerWithMode(true, generation, startedAt, 'sticky-after-real-runtime-failure');
  }
  try { return await startWorkerWithMode(false, generation, startedAt); }
  catch (error) {
    if (!looksLikeCompatibilityFailure(error) || generation !== engineGeneration) throw error;
    forceCompatibility = true;
    emit('PP-OCRv5 SIMD Worker 不可用，正在使用同一模型的无 SIMD Worker 兜底', 10);
    await delay(80);
    return startWorkerWithMode(true, generation, startedAt, String(error?.message || error));
  }
}
async function ensureEngine() {
  globalThis.clearTimeout(disposeTimer); if (enginePromise) return enginePromise;
  emit(sessionDepth > 0 ? '正在为本次添加流程预热 PP-OCRv5' : '正在准备 PP-OCRv5', 7);
  const pending = startEngine();
  const tracked = pending.then(ocr => { emit('PP-OCRv5 已就绪', 18); return ocr; }).catch(error => {
    if (enginePromise === tracked) enginePromise = null;
    throw new Error(`PP-OCRv5 初始化失败：${error.message}`);
  });
  enginePromise = tracked; return tracked;
}
async function dispose(force = false) {
  globalThis.clearTimeout(disposeTimer);
  if (!force && sessionDepth > 0) return;
  if (busy && !force) { pendingEnd = true; return; }
  const current = enginePromise; enginePromise = null; engineGeneration += 1; terminateWorkers();
  if (!current) return;
  try { const ocr = await current; await ocr?.dispose?.(); } catch {}
  emit('PP-OCRv5 已释放', 0);
}
function scheduleOutsideSessionDispose() {
  globalThis.clearTimeout(disposeTimer);
  if (sessionDepth > 0 || busy) return;
  disposeTimer = globalThis.setTimeout(() => { void dispose(); }, OUTSIDE_SESSION_IDLE_MS);
}
function meaningful(text) {
  const chars = [...String(text || '')]; if (!chars.length) return 0;
  return chars.filter(char => /[\p{Script=Han}A-Za-z0-9年月日海拔处理烘焙庄园产区豆种%°./:+-]/u.test(char)).length / chars.length;
}
function normalizeItems(result, imageId) {
  return (result?.items || []).map(item => ({ text:String(item?.text || '').trim(), confidence:Number(item?.score ?? 0), polygon:item?.poly || null, imageId, engine:ENGINE }))
    .filter(item => item.text && item.confidence >= 0.28 && meaningful(item.text) >= 0.55)
    .sort((a,b) => Number(a.polygon?.[0]?.[1] || 0) - Number(b.polygon?.[0]?.[1] || 0) || Number(a.polygon?.[0]?.[0] || 0) - Number(b.polygon?.[0]?.[0] || 0));
}
function predictOptions() {
  return { textDetLimitSideLen:LIMIT_SIDE, textDetLimitType:'min', textDetMaxSideLimit:MAX_SIDE, textDetThresh:0.22, textDetBoxThresh:0.35, textDetUnclipRatio:1.55, textRecScoreThresh:0.28 };
}
async function predictWithRuntimeRecovery(image, index, imageCount) {
  let ocr = await ensureEngine(); const options = predictOptions();
  try {
    return await withTimeout(ocr.predict(image.blob, options), PREDICT_TIMEOUT_MS, `PP-OCRv5 第 ${index + 1} 张图片识别超时`, detachEngine);
  } catch (error) {
    if (WEBKIT || forceCompatibility || !looksLikeCompatibilityFailure(error)) throw error;
    const startedAt = diagnosticNow(); forceCompatibility = true;
    recordDiagnostic('predict-runtime-recovery', startedAt, { imageIndex:index, imageCount, reason:String(error?.message || error), fromMode:engineMode });
    detachEngine(); emit('预测阶段运行时异常，正在切换同一 PP-OCRv5 无 SIMD Worker 重试一次', 12); await delay(80);
    ocr = await ensureEngine();
    const result = await withTimeout(ocr.predict(image.blob, options), PREDICT_TIMEOUT_MS, `PP-OCRv5 第 ${index + 1} 张图片兼容模式重试超时`, detachEngine);
    recordDiagnostic('predict-runtime-recovery-success', startedAt, { imageIndex:index, imageCount, mode:engineMode }); return result;
  }
}
async function predict(images) {
  const blocks = [], groups = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]; emit(`PP-OCRv5 正在识别第 ${index + 1}/${images.length} 张图片`, 20 + Math.round(index / Math.max(1, images.length) * 70));
    const startedAt = diagnosticNow(); const results = await predictWithRuntimeRecovery(image, index, images.length);
    const current = normalizeItems(results?.[0], image.id);
    recordDiagnostic('ocr-predict', startedAt, { imageIndex:index, imageCount:images.length, mode:engineMode, limitSide:LIMIT_SIDE, maxSide:MAX_SIDE });
    blocks.push(...current); if (current.length) groups.push(current.map(item => item.text).join('\n')); await delay(0);
  }
  if (!blocks.length) throw new Error('PP-OCRv5 没有得到可信文字。请靠近文字区域拍摄或先框选有效区域。');
  emit('PP-OCRv5 中英文识别完成', 100);
  return { engine:`${ENGINE}-${engineMode}`, blocks, fullText:groups.join('\n\n') };
}
async function predictRegion(blob, region, options = {}) {
  emit('正在裁剪待识别区域', 10);
  const crop = await cropRegionInWorker(blob, region, options), imageId = String(options.imageId || 'roi');
  const result = await predict([{ id:imageId, blob:crop.blob }]);
  return { ...result, regionProtocol:'recognition-roi/1.0', region:crop.region, sourceWidth:Number(crop.sourceWidth || 0), sourceHeight:Number(crop.sourceHeight || 0), cropX:Number(crop.cropX || 0), cropY:Number(crop.cropY || 0), cropWidth:Number(crop.cropWidth || 0), cropHeight:Number(crop.cropHeight || 0), outputWidth:Number(crop.outputWidth || 0), outputHeight:Number(crop.outputHeight || 0) };
}
async function run(task) {
  if (busy) throw new Error('识别任务正在运行，请勿重复点击'); busy = true;
  try { return await task(); }
  catch (error) { detachEngine(); emit(`识别失败：${error.message}`, 0); throw error; }
  finally {
    busy = false;
    if (pendingEnd && sessionDepth === 0) { pendingEnd = false; void dispose(true); }
    else scheduleOutsideSessionDispose();
  }
}
async function beginSession(reason = 'add-flow') {
  sessionDepth += 1; globalThis.clearTimeout(disposeTimer); recordDiagnostic('session-begin', diagnosticNow(), { reason, sessionDepth });
  if (globalThis.__LUCKYBEAN_ANDROID__) return null;
  try { return await ensureEngine(); } catch (error) { emit(`PP-OCRv5 预热未完成：${error.message}`, 0); return null; }
}
async function endSession(reason = 'add-flow') {
  sessionDepth = Math.max(0, sessionDepth - 1); recordDiagnostic('session-end', diagnosticNow(), { reason, sessionDepth });
  if (sessionDepth === 0) {
    forceCompatibility = false;
    if (busy) pendingEnd = true; else await dispose(true);
  }
}
async function warmForRecognition() {
  if (globalThis.__LUCKYBEAN_ANDROID__) return null;
  try { const ocr = await ensureEngine(); scheduleOutsideSessionDispose(); return ocr; }
  catch (error) { emit(`PP-OCRv5 预热未完成：${error.message}`, 0); return null; }
}
const paddleOcrApi = Object.freeze({
  version:VERSION, engine:ENGINE, lowMemory:LOW_MEMORY, appleMobile:APPLE_MOBILE,
  browserSafe:true, workerOnly:false, primaryIsolation:WEBKIT ? 'webkit-direct-wasm-no-simd' : 'module-worker',
  compatibilityFallback:WEBKIT ? 'webkit-direct-wasm-no-simd' : 'module-worker-no-simd-on-real-failure',
  memoryFallback:WEBKIT ? 'webkit-direct-wasm-no-simd' : 'worker-simd-fastpath->worker-no-simd-on-real-failure',
  predictRuntimeRecovery:true, autoPreload:false, disposePolicy:'capture-session', roiWorkerOnly:true,
  regionRecognition:'recognition-roi/1.0', runtimeOrigin:'same-origin-vendored', inputPolicy:`${LIMIT_SIDE}/${MAX_SIDE}`,
  get sessionDepth() { return sessionDepth; }, get compatibilityActive() { return forceCompatibility; },
  runtimeBase() { return runtimeBase().href; },
  recognizeCoffeeBag(images) { return run(() => predict(images)); },
  recognizeRegion(blob, region, options = {}) { return run(() => predictRegion(blob, region, options)); },
  async recognize(blob) { const result = await run(() => predict([{ id:'single', blob }])); return { blocks:result.blocks }; },
  preload:warmForRecognition, warmForRecognition, beginSession, endSession, dispose
});
globalThis.LuckyBeanPaddleOCR = paddleOcrApi;
globalThis.CoffeeFoundationPaddleOCR = paddleOcrApi;
document.addEventListener('visibilitychange', () => { if (document.hidden && sessionDepth === 0 && !busy) void dispose(); });
globalThis.addEventListener('pagehide', () => { if (!busy) void dispose(true); });
document.documentElement.dataset.webOcr = `ppocr-v5-${VERSION}-session-fastpath`;
