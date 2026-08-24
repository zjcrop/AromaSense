package com.zjcrop.aromasense

import android.app.Activity
import android.net.Uri
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
    private val sourceForImageId: (String) -> Uri?
) {
    private val chineseRecognizer: TextRecognizer = TextRecognition.getClient(
        ChineseTextRecognizerOptions.Builder().build()
    )
    private val latinRecognizer: TextRecognizer = TextRecognition.getClient(
        TextRecognizerOptions.DEFAULT_OPTIONS
    )

    @JavascriptInterface
    fun recognizeSampleImage(payloadJson: String): String {
        return try {
            val request = JSONObject(payloadJson)
            val imageId = request.optString("id", "")
            val source = sourceForImageId(imageId)
                ?: throw IllegalArgumentException("Android 原图引用不可用，请重新选择照片")
            val input = InputImage.fromFilePath(activity, source)

            val chineseTask = chineseRecognizer.process(input)
            val latinTask = latinRecognizer.process(input)
            Tasks.await(Tasks.whenAllComplete(chineseTask, latinTask), 30, TimeUnit.SECONDS)

            val unique = LinkedHashMap<String, JSONObject>()
            if (chineseTask.isSuccessful) appendLines(unique, chineseTask.result)
            if (latinTask.isSuccessful) appendLines(unique, latinTask.result)
            if (unique.isEmpty()) {
                val failure = chineseTask.exception ?: latinTask.exception
                throw IllegalStateException(failure?.message ?: "未识别到清晰文字", failure)
            }

            val fullText = unique.values.joinToString("\n") { it.optString("text") }
            JSONObject()
                .put("engine", "android-mlkit-bundled-16.0.1")
                .put("fullText", fullText)
                .put("blocks", JSONArray(unique.values))
                .toString()
        } catch (error: Exception) {
            JSONObject()
                .put("error", error.message ?: "Android 本地 OCR 失败")
                .toString()
        }
    }

    fun close() {
        chineseRecognizer.close()
        latinRecognizer.close()
    }

    private fun appendLines(target: LinkedHashMap<String, JSONObject>, result: Text?) {
        if (result == null) return
        for (block in result.textBlocks) {
            for (line in block.lines) {
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
                    .put("text", value)
                    .put("confidence", 0.86)
                    .put("polygon", polygon)
            }
        }
    }
}
