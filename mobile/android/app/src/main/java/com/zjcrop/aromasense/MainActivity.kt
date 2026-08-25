package com.zjcrop.aromasense

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.ArrayDeque
import java.util.LinkedHashMap

class MainActivity : Activity() {
    companion object {
        private const val FILE_CHOOSER_REQUEST = 4107
    }

    private lateinit var webView: WebView
    private lateinit var database: android.database.sqlite.SQLiteDatabase
    private lateinit var recognitionBridge: AromaSenseRecognitionBridge
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null
    private val sourceByImageId = LinkedHashMap<String, Uri>()
    private val sourcesByFileName = LinkedHashMap<String, ArrayDeque<Uri>>()
    private val sourceQueue = ArrayDeque<Uri>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        database = openOrCreateDatabase("aromasense.sqlite", MODE_PRIVATE, null)
        database.execSQL("PRAGMA foreign_keys = ON")
        recognitionBridge = AromaSenseRecognitionBridge(this) { imageId, fileName ->
            resolveOriginalSource(imageId, fileName)
        }

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)
        webView.addJavascriptInterface(AromaSenseSQLiteBridge(database), "AromaSenseSQLite")
        webView.addJavascriptInterface(recognitionBridge, "AromaSenseRecognitionBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return true
                if (url.scheme == "file") return false
                if (url.scheme == "https" || url.scheme == "http") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    launchImageChooser(fileChooserParams)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }
        setContentView(webView)

        if (savedInstanceState == null) {
            webView.loadUrl("file:///android_asset/www/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun launchImageChooser(params: WebChromeClient.FileChooserParams?) {
        val captureOnly = params?.isCaptureEnabled == true
        val cameraIntent = createCameraIntent()
        if (captureOnly && cameraIntent != null) {
            startActivityForResult(cameraIntent, FILE_CHOOSER_REQUEST)
            return
        }

        val galleryIntent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(galleryIntent, "选择咖啡豆图片")
        if (cameraIntent != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cameraIntent))
        startActivityForResult(chooser, FILE_CHOOSER_REQUEST)
    }

    private fun createCameraIntent(): Intent? {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "AromaSense_${System.currentTimeMillis()}.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        }
        val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        pendingCameraUri = uri
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    @Deprecated("Deprecated in Activity; retained for WebChromeClient compatibility on minSdk 26")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != FILE_CHOOSER_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }

        val callback = filePathCallback
        filePathCallback = null
        if (callback == null) return
        if (resultCode != RESULT_OK) {
            pendingCameraUri?.let { runCatching { contentResolver.delete(it, null, null) } }
            pendingCameraUri = null
            callback.onReceiveValue(null)
            return
        }

        val selected = mutableListOf<Uri>()
        val clipData = data?.clipData
        if (clipData != null) {
            for (index in 0 until clipData.itemCount) selected += clipData.getItemAt(index).uri
        } else if (data?.data != null) {
            selected += data.data!!
        } else if (pendingCameraUri != null) {
            selected += pendingCameraUri!!
        }
        pendingCameraUri = null

        if (selected.isEmpty()) {
            callback.onReceiveValue(null)
            return
        }
        selected.forEach { persistReadPermission(it) }
        rememberOriginalSources(selected)
        callback.onReceiveValue(selected.toTypedArray())
    }

    private fun persistReadPermission(uri: Uri) {
        if (uri.scheme != "content") return
        runCatching {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun rememberOriginalSources(uris: List<Uri>) {
        sourceQueue.clear()
        sourcesByFileName.clear()
        for (uri in uris) {
            sourceQueue.addLast(uri)
            val fileName = displayName(uri)
            if (fileName.isNotBlank()) sourcesByFileName.getOrPut(fileName) { ArrayDeque() }.addLast(uri)
        }
    }

    @Synchronized
    private fun resolveOriginalSource(imageId: String, fileName: String): Uri? {
        if (imageId.isNotBlank()) sourceByImageId[imageId]?.let { return it }
        var source: Uri? = null
        if (fileName.isNotBlank()) {
            val byName = sourcesByFileName[fileName]
            if (byName != null && byName.isNotEmpty()) source = byName.removeFirst()
        }
        if (source == null && sourceQueue.isNotEmpty()) source = sourceQueue.removeFirst()
        if (source != null && imageId.isNotBlank()) sourceByImageId[imageId] = source
        return source
    }

    private fun displayName(uri: Uri): String {
        if (uri.scheme != "content") return uri.lastPathSegment.orEmpty()
        return runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else ""
            }.orEmpty()
        }.getOrDefault(uri.lastPathSegment.orEmpty())
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Activity")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("AromaSenseSQLite")
            webView.removeJavascriptInterface("AromaSenseRecognitionBridge")
            webView.destroy()
        }
        if (::recognitionBridge.isInitialized) recognitionBridge.close()
        if (::database.isInitialized) database.close()
        super.onDestroy()
    }
}
