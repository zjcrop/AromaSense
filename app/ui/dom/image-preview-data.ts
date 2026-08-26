let previewTail: Promise<void> = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
  const task = previewTail.then(work, work);
  previewTail = task.then(() => undefined, () => undefined);
  return task;
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.()
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("样品图片预览解码失败"));
      node.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url)
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function compactImagePreviewInternal(file: File, maxEdge: number): Promise<string> {
  const decoded = await decodeImage(file);
  try {
    const longest = Math.max(decoded.width, decoded.height);
    if (!longest) throw new Error("样品图片尺寸无效");
    const scale = Math.min(1, maxEdge / longest);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("样品图片预览画布不可用");
    context.drawImage(decoded.source, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.66);
  } finally {
    decoded.close();
  }
}

/**
 * Generates a deliberately small persisted preview. Calls are serialized even
 * when callers use Promise.all so a batch selection cannot decode many full
 * camera images at once and exhaust a mobile WebView heap.
 */
export function compactImagePreview(file: File, maxEdge = 560): Promise<string> {
  return queued(() => compactImagePreviewInternal(file, maxEdge));
}
