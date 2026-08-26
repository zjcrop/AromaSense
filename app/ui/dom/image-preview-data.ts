/**
 * Recognition must never decode or re-encode full camera images on the UI thread.
 *
 * The old preview generator used createImageBitmap + Canvas + toDataURL before
 * OCR. On high-resolution phone photos that duplicated the same expensive image
 * work already performed by the OCR engine and could stall or exhaust a WebView.
 *
 * Emergency policy: recognition rows do not persist an image preview. Android
 * reads its retained content:// URI directly; web passes the original Blob to
 * LuckyBean's PP-OCR Worker. A future thumbnail implementation must be native or
 * Worker/off-main-thread before it can be re-enabled here.
 */
export function compactImagePreview(_file: File, _maxEdge = 560): Promise<string> {
  return Promise.resolve("");
}
