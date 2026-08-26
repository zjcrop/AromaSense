package com.zjcrop.aromasense

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.webkit.JavascriptInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.LinkedHashMap
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android OCR transport compatible with LuckyBean's production android/native-bridge.js.
 *
 * The JavascriptInterface call is intentionally fire-and-return. Image decoding and ML Kit
 * execution never wait synchronously for a result; completion is delivered through the same
 * LuckyBeanNativeRecognition.resolve/reject callback contract used by LuckyBean itself.
 */
class AromaSenseRecognitionBridge(
    private val activity: Activity,
    private val sourceForRequest: (String, String) -> Uri?,
    private val evaluateJavascript: (String) -> Unit
) {
    private val chineseRecognizer: TextRecognizer = TextRecognition.getClient(
        ChineseTextRecognizerOptions.Builder().build()
    )
    private val latinRecognizer: TextRecognizer = TextRecognition.getClient(
        TextRecognizerOptions.DEFAULT_OPTIONS
    )
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "AromaSense-OCR").apply { isDaemon = true }
    }
    private val closed = AtomicBoolean(false)

    /**
     * LuckyBean production native contract. Returns immediately to WebView JS.
     */
    @JavascriptInterface
    fun recognizeImage(requestId: String, imageId: String, imageRole: String, dataUrl: String) {
        if (closed.get()) {
            rejectRecognition(requestId, "Android 本地 OCR 已关闭")
            return
        }
        worker.execute {
            startRecognition(requestId, imageId, imageRole, dataUrl)
        }
    }

    private fun startRecognition(requestId: String, imageId: String, imageRole: String, dataUrl: String) {
        var decodedBitmap: Bitmap? = null
        try {
            if (closed.get()) throw IllegalStateException("Android 本地 OCR 已关闭")
            val source = sourceForRequest(imageId, "")
            decodedBitmap = decodeDataUrl(dataUrl)

            val input: InputImage
            val sourceBinding: String
            if (decodedBitmap != null) {
                input = InputImage.fromBitmap(decodedBitmap, 0)
                sourceBinding = "luckybean-prepared-data-url"
            } else if (source != null) {
                input = InputImage.fromFilePath(activity, source)
                sourceBinding = "android-uri"
            } else {
                throw IllegalArgumentException("无法读取照片数据，LuckyBean 预处理图和 Android 原图均不可用")
            }

            val chineseTask = chineseRecognizer.process(input)
            val latinTask = latinRecognizer.process(input)
            val bitmapToRecycle = decodedBitmap
            decodedBitmap = null

            com.google.android.gms.tasks.Tasks.whenAllComplete(chineseTask, latinTask)
                .addOnCompleteListener(worker) {
                    try {
                        if (closed.get()) return@addOnCompleteListener
                        val unique = LinkedHashMap<String, JSONObject>()
                        if (chineseTask.isSuccessful) appendLines(unique, chineseTask.result, imageId, imageRole, "zh")
                        if (latinTask.isSuccessful) appendLines(unique, latinTask.result, imageId, imageRole, "latin")
                        if (unique.isEmpty()) {
                            val failure = chineseTask.exception ?: latinTask.exception
                            throw IllegalStateException(failure?.message ?: "未识别到清晰文字", failure)
                        }

                        val lines = unique.values.toList()
                        val fullText = lines.joinToString("\n") { it.optString("text") }
                        val payload = JSONObject()
                            .put("engine", "android-mlkit-bundled-16.0.1")
                            .put("sourceBinding", sourceBinding)
                            .put("fullText", fullText)
                            .put("sourceWidth", input.width)
                            .put("sourceHeight", input.height)
                            .put("blocks", JSONArray(lines))
                        resolveRecognition(requestId, payload)
                    } catch (error: Exception) {
                        rejectRecognition(requestId, error.message ?: "Android 本地 OCR 失败")
                    } finally {
                        bitmapToRecycle?.takeIf { !it.isRecycled }?.recycle()
                    }
                }
        } catch (error: Exception) {
            decodedBitmap?.takeIf { !it.isRecycled }?.recycle()
            rejectRecognition(requestId, error.message ?: "Android 本地 OCR 失败")
        }
    }

    private fun resolveRecognition(requestId: String, payload: JSONObject) {
        if (closed.get()) return
        val script = "globalThis.LuckyBeanNativeRecognition&&globalThis.LuckyBeanNativeRecognition.resolve(" +
            JSONObject.quote(requestId) + "," + payload.toString() + ");"
        evaluateJavascript(script)
    }

    private fun rejectRecognition(requestId: String, message: String) {
        if (closed.get()) return
        val script = "globalThis.LuckyBeanNativeRecognition&&globalThis.LuckyBeanNativeRecognition.reject(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(message.ifBlank { "Android 本地 OCR 失败" }) + ");"
        evaluateJavascript(script)
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        worker.shutdownNow()
        chineseRecognizer.close()
        latinRecognizer.close()
    }

    private fun decodeDataUrl(dataUrl: String): Bitmap? {
        if (dataUrl.isBlank()) return null
        return runCatching {
            val encoded = dataUrl.substringAfter(',', dataUrl)
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            if (bytes.isEmpty()) null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }

    private fun appendLines(
        target: LinkedHashMap<String, JSONObject>,
        result: Text?,
        imageId: String,
        imageRole: String,
        languageHint: String
    ) {
        if (result == null) return
        for ((blockIndex, block) in result.textBlocks.withIndex()) {
            for ((lineIndex, line) in block.lines.withIndex()) {
                val value = line.text.orEmpty().replace(Regex("\\s+"), " ").trim()
                if (value.isEmpty()) continue
                val key = value.lowercase(Locale.ROOT)
                    .replace(Regex("[\\s，,。.;；:：/_\\-·•]+"), "")
                if (key.isEmpty() || target.containsKey(key)) continue

                val polygon = JSONArray()
                val corners = line.cornerPoints
                if (corners != null && corners.isNotEmpty()) {
                    for (corner in corners) polygon.put(JSONArray().put(corner.x).put(corner.y))
                } else {
                    line.boundingBox?.let { rect ->
                        polygon.put(JSONArray().put(rect.left).put(rect.top))
                        polygon.put(JSONArray().put(rect.right).put(rect.top))
                        polygon.put(JSONArray().put(rect.right).put(rect.bottom))
                        polygon.put(JSONArray().put(rect.left).put(rect.bottom))
                    }
                }

                target[key] = JSONObject()
                    .put("id", "$languageHint-$blockIndex-$lineIndex")
                    .put("blockId", "$languageHint-block-$blockIndex")
                    .put("text", value)
                    .put("confidence", 0.86)
                    .put("language", languageHint)
                    .put("imageId", imageId)
                    .put("imageRole", imageRole)
                    .put("polygon", polygon)
            }
        }
    }
}
