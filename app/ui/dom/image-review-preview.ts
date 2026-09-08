const PREVIEW_MAX_EDGE = 1280;

const WORKER_SOURCE = String.raw`
self.onmessage = async (event) => {
  const { blob, maxEdge } = event.data || {};
  let bitmap;
  try {
    if (!(blob instanceof Blob)) throw new Error('invalid preview blob');
    const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, Math.max(1, Number(maxEdge) || 1280) / Math.max(probe.width, probe.height));
    const width = Math.max(1, Math.round(probe.width * scale));
    const height = Math.max(1, Math.round(probe.height * scale));
    probe.close();
    bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high'
    });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('preview 2d context unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    bitmap = undefined;
    const preview = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    self.postMessage({ ok: true, preview, width, height });
  } catch (error) {
    try { bitmap?.close?.(); } catch {}
    self.postMessage({ ok: false, error: String(error?.message || error || 'preview failed') });
  }
};
`;

export interface SegmentationImagePreview {
  blob: Blob;
  width: number;
  height: number;
  dispose(): void;
}

/**
 * Creates only a low-resolution review image. OCR never consumes this preview;
 * accepted regions are always cropped again from the untouched original File.
 */
export async function createSegmentationImagePreview(
  source: File,
  maxEdge = PREVIEW_MAX_EDGE
): Promise<SegmentationImagePreview | undefined> {
  if (
    typeof Worker !== "function" ||
    typeof URL?.createObjectURL !== "function" ||
    typeof Blob !== "function"
  ) return undefined;

  const workerBlob = new Blob([WORKER_SOURCE], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(workerBlob);
  const worker = new Worker(workerUrl);
  try {
    const result = await new Promise<{ ok: boolean; preview?: Blob; width?: number; height?: number; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("生成分割预览超时")), 12_000);
      worker.onmessage = (event: MessageEvent) => {
        clearTimeout(timer);
        resolve(event.data ?? { ok: false, error: "empty preview response" });
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("分割预览 Worker 失败"));
      };
      worker.postMessage({ blob: source, maxEdge: Math.max(640, Math.min(1600, Math.round(maxEdge))) });
    });
    if (!result.ok || !(result.preview instanceof Blob) || !Number(result.width) || !Number(result.height)) return undefined;
    const previewUrl = URL.createObjectURL(result.preview);
    return {
      blob: result.preview,
      width: Number(result.width),
      height: Number(result.height),
      dispose() { URL.revokeObjectURL(previewUrl); }
    };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}

export function segmentationPreviewUrl(preview: SegmentationImagePreview): string {
  return URL.createObjectURL(preview.blob);
}
