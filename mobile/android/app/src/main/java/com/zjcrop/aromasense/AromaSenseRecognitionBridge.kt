package com.zjcrop.aromasense

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.webkit.JavascriptInterface
import com.google.android.gms.tasks.Tasks
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
import java.util.concurrent.TimeUnit

class AromaSenseRecognitionBridge(
    private val activity: Activity,
    private val sourceForRequest: (String, String) -> Uri?
) {
    private val chineseRecognizer: TextRecognizer = TextRecognition.getClient(
        ChineseTextRecognizerOptions.Builder().build()
    )
    private val latinRecognizer: TextRecognizer = TextRecognition.getClient(
        TextRecognizerOptions.DEFAULT_OPTIONS
    )

    @JavascriptInterface
    fun recognizeSampleImage(payloadJson: String): String {
        var decodedBitmap: Bitmap? = null
        return try {
            val request = JSONObject(payloadJson)
            val imageId = request.optString("id", "")
            val fileName = request.optString("fileName", "")
            val source = sourceForRequest(imageId, fileName)

            val input: InputImage
            val sourceBinding: String
            if (source != null) {
                // Prefer the Android URI because InputImage.fromFilePath preserves the
                // original file and its orientation metadata. The Web data URL remains
                // an exact-image fallback if URI binding is unavailable.
                input = InputImage.fromFilePath(activity, source)
                sourceBinding = "android-uri"
            } else {
                decodedBitmap = decodeDataUrl(request.optString("dataUrl", ""))
                    ?: throw IllegalArgumentException("Android 原图引用不可用，且图片数据回退失败，请重新选择照片")
                input = InputImage.fromBitmap(decodedBitmap!!, 0)
                sourceBinding = "web-data-url"
            }

            val chineseTask = chineseRecognizer.process(input)
            val latinTask = latinRecognizer.process(input)
            Tasks.await(Tasks.whenAllComplete(chineseTask, latinTask), 30, TimeUnit.SECONDS)

            val unique = LinkedHashMap<String, JSONObject>()
            if (chineseTask.isSuccessful) appendLines(unique, chineseTask.result, "zh")
            if (latinTask.isSuccessful) appendLines(unique, latinTask.result, "latin")
            if (unique.isEmpty()) {
                val failure = chineseTask.exception ?: latinTask.exception
                throw IllegalStateException(failure?.message ?: "未识别到清晰文字", failure)
            }

            val lines = unique.values.toList()
                .sortedWith(compareBy<JSONObject> { polygonTop(it.optJSONArray("polygon")) }
                    .thenBy { polygonLeft(it.optJSONArray("polygon")) })
            val fullText = lines.joinToString("\n") { it.optString("text") }
            JSONObject()
                .put("engine", "android-mlkit-bundled-16.0.1")
                .put("sourceBinding", sourceBinding)
                .put("fullText", fullText)
                .put("sourceWidth", input.width)
                .put("sourceHeight", input.height)
                .put("lines", JSONArray(lines))
                .toString()
        } catch (error: Exception) {
            JSONObject()
                .put("error", error.message ?: "Android 本地 OCR 失败")
                .toString()
        } finally {
            decodedBitmap?.takeIf { !it.isRecycled }?.recycle()
        }
    }

    fun close() {
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

    private fun appendLines(target: LinkedHashMap<String, JSONObject>, result: Text?, languageHint: String) {
        if (result == null) return
        for ((blockIndex, block) in result.textBlocks.withIndex()) {
            for ((lineIndex, line) in block.lines.withIndex()) {
                val value = line.text.orEmpty().replace(Regex("\\s+"), " ").trim()
                if (value.isEmpty()) continue
                val key = value.lowercase(Locale.ROOT)
                    .replace(Regex("[\\s，,。.;；:：/_\\-·•]+"), "")
                if (key.isEmpty()) continue

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

                val next = JSONObject()
                    .put("id", "$languageHint-$blockIndex-$lineIndex")
                    .put("blockId", "$languageHint-block-$blockIndex")
                    .put("text", value)
                    .put("confidence", 0.86)
                    .put("language", languageHint)
                    .put("polygon", polygon)

                val existing = target[key]
                if (existing == null || polygonArea(next.optJSONArray("polygon")) > polygonArea(existing.optJSONArray("polygon"))) {
                    target[key] = next
                }
            }
        }
    }

    private fun polygonLeft(points: JSONArray?): Int {
        if (points == null || points.length() == 0) return Int.MAX_VALUE
        var value = Int.MAX_VALUE
        for (index in 0 until points.length()) value = minOf(value, points.optJSONArray(index)?.optInt(0, Int.MAX_VALUE) ?: Int.MAX_VALUE)
        return value
    }

    private fun polygonTop(points: JSONArray?): Int {
        if (points == null || points.length() == 0) return Int.MAX_VALUE
        var value = Int.MAX_VALUE
        for (index in 0 until points.length()) value = minOf(value, points.optJSONArray(index)?.optInt(1, Int.MAX_VALUE) ?: Int.MAX_VALUE)
        return value
    }

    private fun polygonArea(points: JSONArray?): Long {
        if (points == null || points.length() < 2) return 0
        var minX = Int.MAX_VALUE
        var minY = Int.MAX_VALUE
        var maxX = Int.MIN_VALUE
        var maxY = Int.MIN_VALUE
        for (index in 0 until points.length()) {
            val point = points.optJSONArray(index) ?: continue
            val x = point.optInt(0)
            val y = point.optInt(1)
            minX = minOf(minX, x)
            minY = minOf(minY, y)
            maxX = maxOf(maxX, x)
            maxY = maxOf(maxY, y)
        }
        if (minX == Int.MAX_VALUE || minY == Int.MAX_VALUE) return 0
        return (maxX - minX).toLong().coerceAtLeast(0) * (maxY - minY).toLong().coerceAtLeast(0)
    }
}
