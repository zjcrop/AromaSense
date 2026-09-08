const PREVIEW_MAX_EDGE = 1280;

const WORKER_SOURCE = String.raw`
const HEADER_PROBE_BYTES = 1024 * 1024;
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
self.onmessage = async (event) => {
  const { blob, maxEdge } = event.data || {};
  let bitmap;
  try {
    if (!(blob instanceof Blob)) throw new Error('invalid preview blob');
    const limit = Math.max(640, Math.min(1600, Number(maxEdge) || 1280));
    const dimensions = await encodedDimensions(blob);
    if (dimensions) {
      const target = boundedSize(dimensions.width, dimensions.height, limit);
      bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image', resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high'
      });
    } else {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    }
    let width = bitmap.width, height = bitmap.height;
    if (Math.max(width,height) > limit) {
      const target = boundedSize(width,height,limit);
      const source = bitmap;
      const canvas = new OffscreenCanvas(target.width,target.height);
      const context = canvas.getContext('2d',{ alpha:false });
      if (!context) throw new Error('preview 2d context unavailable');
      context.drawImage(source,0,0,target.width,target.height);
      source.close();
      bitmap = undefined;
      const preview = await canvas.convertToBlob({ type:'image/jpeg', quality:0.82 });
      self.postMessage({ ok:true, preview, width:target.width, height:target.height });
      return;
    }
    const canvas = new OffscreenCanvas(width,height);
    const context = canvas.getContext('2d',{ alpha:false });
    if (!context) throw new Error('preview 2d context unavailable');
    context.drawImage(bitmap,0,0,width,height);
    bitmap.close(); bitmap = undefined;
    const preview = await canvas.convertToBlob({ type:'image/jpeg', quality:0.82 });
    self.postMessage({ ok:true, preview, width, height });
  } catch (error) {
    try { bitmap?.close?.(); } catch {}
    self.postMessage({ ok:false, error:String(error?.message || error || 'preview failed') });
  }
};
`;

export interface SegmentationImagePreview {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Creates only a low-resolution review image. Header dimensions are inspected
 * before decode whenever possible, so a 12/48 MP JPEG never has to become a
 * full-size RGBA bitmap. This Worker is visual-review only: OCR always consumes
 * the untouched original File through the Foundation ROI Worker.
 */
export async function createSegmentationImagePreview(
  source: File,
  maxEdge = PREVIEW_MAX_EDGE
): Promise<SegmentationImagePreview | undefined> {
  if (typeof Worker !== "function" || typeof URL?.createObjectURL !== "function" || typeof Blob !== "function") return undefined;
  const workerBlob = new Blob([WORKER_SOURCE], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(workerBlob);
  const worker = new Worker(workerUrl);
  try {
    const result = await new Promise<{ ok: boolean; preview?: Blob; width?: number; height?: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("生成分割预览超时")), 12_000);
      worker.onmessage = (event: MessageEvent) => { clearTimeout(timer); resolve(event.data ?? { ok: false }); };
      worker.onerror = () => { clearTimeout(timer); reject(new Error("分割预览 Worker 失败")); };
      worker.postMessage({ blob: source, maxEdge: Math.max(640, Math.min(1600, Math.round(maxEdge))) });
    });
    if (!result.ok || !(result.preview instanceof Blob) || !Number(result.width) || !Number(result.height)) return undefined;
    return { blob: result.preview, width: Number(result.width), height: Number(result.height) };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}
