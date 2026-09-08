import type { SegmentationReviewRegion } from "./sample-segmentation-review";
import { REVIEWED_REGION_MAX_EDGE } from "./sample-roi-refinement";

const BATCH_DECODE_MAX_EDGE = 3000;

const WORKER_SOURCE = String.raw`
const HEADER_PROBE_BYTES = 1024 * 1024;
const MIN_REGION_SPAN = 0.01;
function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}
function normalizeRegion(input) {
  const source = input && typeof input === 'object' ? input : {};
  const left = clamp01(source.left), top = clamp01(source.top), right = clamp01(source.right, 1), bottom = clamp01(source.bottom, 1);
  if (right - left < MIN_REGION_SPAN || bottom - top < MIN_REGION_SPAN) throw new Error('ROI 范围过小或无效');
  return { left, top, right, bottom };
}
function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}
function pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  const signature = [137,80,78,71,13,10,26,10];
  if (!signature.every((value,index) => bytes[index] === value)) return null;
  const width = readUint32BE(bytes,16), height = readUint32BE(bytes,20);
  return width > 0 && height > 0 ? { width, height } : null;
}
const JPEG_SOF_MARKERS = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
function jpegDimensions(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (JPEG_SOF_MARKERS.has(marker) && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}
function webpDimensions(bytes) {
  if (bytes.length < 30) return null;
  const ascii = (offset,length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0,4) !== 'RIFF' || ascii(8,4) !== 'WEBP' || ascii(12,4) !== 'VP8X') return null;
  const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
  const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
  return width > 0 && height > 0 ? { width, height } : null;
}
async function encodedDimensions(blob) {
  try {
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, HEADER_PROBE_BYTES)).arrayBuffer());
    return pngDimensions(bytes) || jpegDimensions(bytes) || webpDimensions(bytes);
  } catch { return null; }
}
function boundedSize(width,height,maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width,height));
  return { width: Math.max(1,Math.round(width * scale)), height: Math.max(1,Math.round(height * scale)) };
}
function cropGeometry(width,height,region) {
  const left = Math.max(0, Math.min(width - 1, Math.floor(region.left * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(region.top * height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(region.right * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(region.bottom * height)));
  return { x:left, y:top, width:right-left, height:bottom-top };
}
async function decodeOnce(blob, decodeMaxEdge) {
  const dimensions = await encodedDimensions(blob);
  if (dimensions && Math.max(dimensions.width, dimensions.height) > decodeMaxEdge) {
    const target = boundedSize(dimensions.width, dimensions.height, decodeMaxEdge);
    try {
      return await createImageBitmap(blob, { imageOrientation:'from-image', resizeWidth:target.width, resizeHeight:target.height, resizeQuality:'high' });
    } catch {}
  }
  return createImageBitmap(blob, { imageOrientation:'from-image' });
}
self.onmessage = async event => {
  const { blob, regions, maxEdge, decodeMaxEdge } = event.data || {};
  let bitmap;
  try {
    if (!(blob instanceof Blob) || !Array.isArray(regions) || !regions.length) throw new Error('批量 ROI 原图或分区无效');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('当前浏览器不支持 Worker-only 批量 ROI 裁剪');
    const normalized = regions.map(normalizeRegion);
    bitmap = await decodeOnce(blob, Math.max(maxEdge, decodeMaxEdge));
    const sourceWidth = bitmap.width, sourceHeight = bitmap.height;
    const crops = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const region = normalized[index];
      const crop = cropGeometry(sourceWidth, sourceHeight, region);
      const output = boundedSize(crop.width, crop.height, maxEdge);
      const canvas = new OffscreenCanvas(output.width, output.height);
      const context = canvas.getContext('2d', { alpha:false });
      if (!context) throw new Error('批量 ROI Worker 无法建立 2D 画布');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
      const cropBlob = await canvas.convertToBlob({ type:'image/jpeg', quality:0.9 });
      crops.push({ blob:cropBlob, width:output.width, height:output.height, region });
    }
    bitmap.close?.(); bitmap = undefined;
    self.postMessage({ ok:true, sourceWidth, sourceHeight, crops });
  } catch (error) {
    try { bitmap?.close?.(); } catch {}
    self.postMessage({ ok:false, error:String(error?.message || error || '批量 ROI 裁剪失败') });
  }
};
`;

export interface ReviewedRegionCrop {
  blob: Blob;
  width: number;
  height: number;
}

export async function createReviewedRegionCropBatch(
  file: File,
  regions: readonly SegmentationReviewRegion[]
): Promise<ReviewedRegionCrop[] | undefined> {
  if (!regions.length) return [];
  if (typeof Worker !== "function" || typeof Blob !== "function" || typeof URL?.createObjectURL !== "function") return undefined;
  const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  try {
    const result = await new Promise<{ ok: boolean; error?: string; crops?: ReviewedRegionCrop[] }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("批量分区裁剪超时")), 12_000);
      worker.onmessage = (event: MessageEvent) => { clearTimeout(timer); resolve(event.data ?? { ok: false }); };
      worker.onerror = () => { clearTimeout(timer); reject(new Error("批量分区裁剪 Worker 失败")); };
      worker.postMessage({
        blob: file,
        regions: regions.map((region) => region.box),
        maxEdge: REVIEWED_REGION_MAX_EDGE,
        decodeMaxEdge: BATCH_DECODE_MAX_EDGE
      });
    });
    if (!result.ok || !Array.isArray(result.crops) || result.crops.length !== regions.length) {
      if (result.error) throw new Error(result.error);
      return undefined;
    }
    return result.crops;
  } finally {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}
