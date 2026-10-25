package expo.modules.screentranslator

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ScreenTranslatorOverlayModule : Module() {

  companion object {
    var instance: ScreenTranslatorOverlayModule? = null
      private set

    private var pendingStartPromise: Promise? = null

    fun onServiceStartResult(success: Boolean, errorMessage: String?) {
      val promise = pendingStartPromise
      pendingStartPromise = null
      if (success) {
        promise?.resolve(true)
      } else {
        promise?.reject("PERMISSION_DENIED", errorMessage ?: "未能开启悬浮翻译服务", null)
      }
    }

    fun emitScreenCaptured(
      filePath: String,
      width: Int,
      height: Int,
      detectedBubbles: List<Map<String, Any>> = emptyList()
    ) {
      instance?.sendEvent(
        "onScreenCaptured",
        mapOf(
          "uri" to "file://$filePath",
          "width" to width,
          "height" to height,
          "timestamp" to System.currentTimeMillis(),
          "detectedBubbles" to detectedBubbles
        )
      )
    }

    fun emitServiceStateChanged(running: Boolean) {
      instance?.sendEvent(
        "onServiceStateChanged",
        mapOf("running" to running)
      )
    }

    fun emitHudCleared() {
      instance?.sendEvent(
        "onHudCleared",
        emptyMap<String, Any>()
      )
    }

    fun emitHudDisplayModeChanged(mode: String) {
      instance?.sendEvent(
        "onHudDisplayModeChanged",
        mapOf("mode" to mode)
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ScreenTranslatorOverlay")

    Events("onScreenCaptured", "onServiceStateChanged", "onHudCleared", "onHudDisplayModeChanged")

    OnCreate {
      instance = this@ScreenTranslatorOverlayModule
      appContext.reactContext?.let { ctx ->
        CoroutineScope(Dispatchers.IO).launch {
          try {
            ComicTextDetector.init(ctx)
            MangaOcrModel.init(ctx)
            OnnxTranslator.init(ctx)
          } catch (e: Exception) {}
        }
      }
    }

    OnDestroy {
      if (instance == this@ScreenTranslatorOverlayModule) {
        instance = null
      }
      try {
        OnnxTranslator.close()
        MlKitTranslator.close()
      } catch (e: Exception) {}
    }

    Function("isSupported") {
      true
    }

    Function("isOverlayPermissionGranted") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
      } else {
        true
      }
    }

    Function("requestOverlayPermission") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        if (!Settings.canDrawOverlays(context)) {
          val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}")
          ).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
          }
          context.startActivity(intent)
          return@Function false
        }
      }
      true
    }

    Function("isServiceRunning") {
      ScreenCaptureOverlayService.isRunning()
    }

    AsyncFunction("startOverlayService") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("CONTEXT_NULL", "React 上下文不可用", null)
        return@AsyncFunction
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
        promise.reject("OVERLAY_PERMISSION_REQUIRED", "请先在系统设置中授予【在其他应用上层显示】悬浮窗权限", null)
        return@AsyncFunction
      }

      if (ScreenCaptureOverlayService.isRunning()) {
        promise.resolve(true)
        return@AsyncFunction
      }

      pendingStartPromise = promise

      // 启动透明 Activity 弹出 Android 系统的 MediaProjection 录屏截屏授权对话框
      val intent = Intent(context, ScreenCapturePermissionActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
    }

    Function("stopOverlayService") {
      val context = appContext.reactContext ?: return@Function false
      ScreenCaptureOverlayService.stop(context)
      true
    }

    Function("exitApp") {
      val context = appContext.reactContext ?: return@Function false
      ScreenCaptureOverlayService.stop(context)
      ScreenCaptureOverlayService.killAllAppProcesses(context)
      true
    }

    AsyncFunction("recognizeImage") { imageUri: String, lang: String?, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("CONTEXT_NULL", "React Context 不可用", null)
        return@AsyncFunction
      }

      CoroutineScope(Dispatchers.IO).launch {
        var bitmap: Bitmap? = null
        try {
          // 稳健支持 content://, file:// 及本地绝对路径
          bitmap = try {
            if (imageUri.startsWith("content://")) {
              context.contentResolver.openInputStream(Uri.parse(imageUri))?.use {
                BitmapFactory.decodeStream(it)
              }
            } else {
              val cleanPath = if (imageUri.startsWith("file://")) {
                Uri.parse(imageUri).path ?: imageUri.removePrefix("file://")
              } else {
                imageUri
              }
              val file = java.io.File(cleanPath)
              if (file.exists()) {
                BitmapFactory.decodeFile(file.absolutePath)
              } else {
                context.contentResolver.openInputStream(Uri.parse(imageUri))?.use {
                  BitmapFactory.decodeStream(it)
                }
              }
            }
          } catch (e: Exception) {
            null
          }

          if (bitmap == null) {
            promise.reject("DECODE_FAILED", "无法解码指定图片: $imageUri", null)
            return@launch
          }

          val bubbles = MangaOcrProcessor.processImage(bitmap, lang ?: "ja", context = context)
          val response = mapOf(
            "width" to bitmap.width,
            "height" to bitmap.height,
            "bubbles" to bubbles
          )
          promise.resolve(response)
        } catch (e: Exception) {
          promise.reject("OCR_ERROR", e.message ?: "文字定位识别发生异常", e)
        } finally {
          try {
            bitmap?.recycle()
          } catch (e: Exception) {}
        }
      }
    }

    AsyncFunction("recognizeRegion") { imageUri: String, cx: Int, cy: Int, radiusW: Int?, radiusH: Int?, lang: String?, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("CONTEXT_NULL", "React Context 不可用", null)
        return@AsyncFunction
      }

      CoroutineScope(Dispatchers.IO).launch {
        var bitmap: Bitmap? = null
        try {
          bitmap = try {
            if (imageUri.startsWith("content://")) {
              context.contentResolver.openInputStream(Uri.parse(imageUri))?.use {
                BitmapFactory.decodeStream(it)
              }
            } else {
              val cleanPath = if (imageUri.startsWith("file://")) {
                Uri.parse(imageUri).path ?: imageUri.removePrefix("file://")
              } else {
                imageUri
              }
              val file = java.io.File(cleanPath)
              if (file.exists()) {
                BitmapFactory.decodeFile(file.absolutePath)
              } else {
                context.contentResolver.openInputStream(Uri.parse(imageUri))?.use {
                  BitmapFactory.decodeStream(it)
                }
              }
            }
          } catch (e: Exception) { null }

          if (bitmap == null) {
            promise.resolve(null)
            return@launch
          }

          val result = MangaOcrProcessor.processRegion(
            bitmap,
            cx,
            cy,
            radiusW ?: 140,
            radiusH ?: 180,
            lang ?: "ja",
            context = context
          )
          promise.resolve(result)
        } catch (e: Exception) {
          promise.reject("REGION_OCR_ERROR", e.message ?: "局部OCR识别发生异常", e)
        } finally {
          try { bitmap?.recycle() } catch (e: Exception) {}
        }
      }
    }

    Function("isMangaOcrReady") {
      MangaOcrModel.isModelReady
    }

    Function("getMangaOcrStatus") {
      MangaOcrModel.statusMessage
    }

    AsyncFunction("recognizeMangaCrop") { imageUri: String, x: Int, y: Int, width: Int, height: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("CONTEXT_NULL", "React Context 不可用", null)
        return@AsyncFunction
      }

      CoroutineScope(Dispatchers.IO).launch {
        var bitmap: Bitmap? = null
        var crop: Bitmap? = null
        try {
          bitmap = try {
            if (imageUri.startsWith("content://")) {
              context.contentResolver.openInputStream(Uri.parse(imageUri))?.use {
                BitmapFactory.decodeStream(it)
              }
            } else {
              val cleanPath = if (imageUri.startsWith("file://")) {
                Uri.parse(imageUri).path ?: imageUri.removePrefix("file://")
              } else {
                imageUri
              }
              val file = java.io.File(cleanPath)
              if (file.exists()) {
                BitmapFactory.decodeFile(file.absolutePath)
              } else {
                context.contentResolver.openInputStream(Uri.parse(imageUri))?.use {
                  BitmapFactory.decodeStream(it)
                }
              }
            }
          } catch (e: Exception) { null }

          if (bitmap == null) {
            promise.resolve("")
            return@launch
          }

          if (!MangaOcrModel.isModelReady) {
            MangaOcrModel.init(context)
          }

          val cx = x.coerceIn(0, bitmap.width - 1)
          val cy = y.coerceIn(0, bitmap.height - 1)
          val cw = width.coerceIn(1, bitmap.width - cx)
          val ch = height.coerceIn(1, bitmap.height - cy)

          crop = Bitmap.createBitmap(bitmap, cx, cy, cw, ch)
          val text = MangaOcrModel.recognize(crop)
          promise.resolve(text)
        } catch (e: Exception) {
          promise.reject("OCR_ERROR", e.message ?: "Manga OCR 识别发生异常", e)
        } finally {
          try {
            crop?.recycle()
            bitmap?.recycle()
          } catch (e: Exception) {}
        }
      }
    }

    Function("captureScreen") {
      if (ScreenCaptureOverlayService.isRunning()) {
        ScreenCaptureOverlayService.triggerScreenCapture()
        true
      } else {
        false
      }
    }

    Function("updateTranslationResult") { bubblesJson: String ->
      if (ScreenCaptureOverlayService.isRunning()) {
        ScreenCaptureOverlayService.updateTranslationResult(bubblesJson)
        true
      } else {
        false
      }
    }

    Function("setRealtimeMode") { enabled: Boolean ->
      ScreenCaptureOverlayService.setRealtimeEnabled(enabled)
      true
    }

    Function("isRealtimeMode") {
      ScreenCaptureOverlayService.isRealtimeEnabled()
    }

    Function("setHudVisible") { visible: Boolean ->
      ScreenCaptureOverlayService.setHudVisibility(visible)
      true
    }

    Function("setHudDisplayMode") { mode: String ->
      ScreenCaptureOverlayService.setHudDisplayMode(mode)
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("hud_display_mode", mode.lowercase().trim()).apply()
      }
      emitHudDisplayModeChanged(mode.lowercase().trim())
      true
    }

    Function("getHudDisplayMode") {
      val serviceMode = ScreenCaptureOverlayService.getHudDisplayMode()
      if (serviceMode.isNotBlank()) {
        serviceMode
      } else {
        val context = appContext.reactContext
        if (context != null) {
          val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
          prefs.getString("hud_display_mode", "ocr") ?: "ocr"
        } else {
          "ocr"
        }
      }
    }

    Function("setSourceLanguageFilter") { lang: String ->
      ScreenCaptureOverlayService.setSourceLanguageFilter(lang)
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("source_language_filter", lang).apply()
      }
      true
    }

    Function("getSourceLanguageFilter") {
      val serviceLang = ScreenCaptureOverlayService.getSourceLanguageFilter()
      if (serviceLang.isNotBlank()) {
        serviceLang
      } else {
        val context = appContext.reactContext
        if (context != null) {
          val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
          prefs.getString("source_language_filter", "ja") ?: "ja"
        } else {
          "ja"
        }
      }
    }

    Function("clearHudText") {
      ScreenCaptureOverlayService.clearAllHudText()
      true
    }

    Function("setTargetApp") { packageName: String?, appName: String? ->
      ScreenCaptureOverlayService.setTargetApp(packageName, appName)
      true
    }

    Function("getTargetApp") {
      mapOf(
        "packageName" to ScreenCaptureOverlayService.getTargetAppPackage(),
        "appName" to ScreenCaptureOverlayService.getTargetAppName()
      )
    }

    Function("lockCurrentApp") {
      val res = ScreenCaptureOverlayService.currentService?.lockCurrentForegroundApp()
      if (res != null) {
        mapOf("success" to true, "packageName" to res.first, "appName" to res.second)
      } else {
        mapOf("success" to false)
      }
    }

    Function("unlockTargetApp") {
      ScreenCaptureOverlayService.setTargetApp(null, null)
      true
    }

    Function("setDestroyOnAppSwitch") { destroy: Boolean ->
      ScreenCaptureOverlayService.setDestroyBubblesOnAppSwitch(destroy)
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.edit().putBoolean("destroy_bubbles_on_app_switch", destroy).apply()
      }
      true
    }

    Function("isDestroyOnAppSwitch") {
      val serviceSetting = ScreenCaptureOverlayService.isDestroyBubblesOnAppSwitch()
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.getBoolean("destroy_bubbles_on_app_switch", serviceSetting)
      } else {
        serviceSetting
      }
    }

    Function("setOutsideAppBallBehavior") { behavior: String ->
      ScreenCaptureOverlayService.setOutsideAppBallBehavior(behavior)
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("outside_app_ball_behavior", behavior).apply()
      }
      true
    }

    Function("getOutsideAppBallBehavior") {
      val serviceSetting = ScreenCaptureOverlayService.getOutsideAppBallBehavior()
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.getString("outside_app_ball_behavior", serviceSetting) ?: serviceSetting
      } else {
        serviceSetting
      }
    }

    Function("setViewportMode") { mode: String ->
      ScreenCaptureOverlayService.setViewportMode(mode)
      val context = appContext.reactContext
      if (context != null) {
        val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("viewport_mode", mode).apply()
      }
      true
    }

    Function("getViewportMode") {
      val serviceMode = ScreenCaptureOverlayService.getViewportMode()
      if (serviceMode.isNotBlank()) {
        serviceMode
      } else {
        val context = appContext.reactContext
        if (context != null) {
          val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
          prefs.getString("viewport_mode", "golden") ?: "golden"
        } else {
          "golden"
        }
      }
    }

    Function("getForegroundPackageName") {
      ScreenCaptureOverlayService.currentService?.getForegroundPackageName()
    }

    Function("hasUsageStatsPermission") {
      val context = appContext.reactContext ?: return@Function false
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? android.app.AppOpsManager ?: return@Function false
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName)
      } else {
        @Suppress("DEPRECATION")
        appOps.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName)
      }
      mode == android.app.AppOpsManager.MODE_ALLOWED
    }

    Function("requestUsageStatsPermission") {
      val context = appContext.reactContext ?: return@Function false
      try {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("getInstalledApps") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, String>>()
      val pm = context.packageManager
      val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      }
      val resolveInfos = pm.queryIntentActivities(mainIntent, 0)
      val list = mutableListOf<Map<String, String>>()
      for (ri in resolveInfos) {
        val pkg = ri.activityInfo.packageName
        if (pkg == context.packageName) continue
        val label = try { ri.loadLabel(pm).toString() } catch (e: Exception) { pkg }
        list.add(mapOf("packageName" to pkg, "appName" to label))
      }
      list.sortedBy { it["appName"]?.lowercase() ?: "" }
    }

    Function("getStringSetting") { key: String, defaultValue: String ->
      val context = appContext.reactContext ?: return@Function defaultValue
      val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
      prefs.getString(key, defaultValue) ?: defaultValue
    }

    Function("setStringSetting") { key: String, value: String ->
      val context = appContext.reactContext ?: return@Function false
      val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
      prefs.edit().putString(key, value).apply()
      true
    }

    Function("setBallLoading") { isLoading: Boolean, statusText: String? ->
      ScreenCaptureOverlayService.setBallLoading(isLoading, statusText ?: if (isLoading) "翻译中" else "就绪")
      true
    }

    Function("setBallState") { statusText: String, isProcessing: Boolean ->
      ScreenCaptureOverlayService.setBallLoading(isProcessing, statusText)
      true
    }

    Function("isMlKitTranslateSupported") {
      true
    }

    AsyncFunction("mlkitCheckModel") { sourceLang: String?, targetLang: String?, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val res = MlKitTranslator.checkModels(sourceLang ?: "ja", targetLang ?: "zh")
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("CHECK_ERROR", e.message ?: "检查端侧翻译模型失败", e)
        }
      }
    }

    AsyncFunction("mlkitDownloadModel") { sourceLang: String?, targetLang: String?, requireWifi: Boolean?, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val ok = MlKitTranslator.downloadModel(sourceLang ?: "ja", targetLang ?: "zh", requireWifi ?: false)
          promise.resolve(ok)
        } catch (e: Exception) {
          promise.reject("DOWNLOAD_ERROR", e.message ?: "下载端侧翻译模型失败", e)
        }
      }
    }

    AsyncFunction("mlkitTranslate") { text: String, sourceLang: String?, targetLang: String?, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val res = MlKitTranslator.translate(text, sourceLang ?: "ja", targetLang ?: "zh")
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("TRANSLATE_ERROR", e.message ?: "端侧翻译失败", e)
        }
      }
    }

    AsyncFunction("mlkitTranslateBatch") { items: Map<String, String>, sourceLang: String?, targetLang: String?, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val res = MlKitTranslator.translateBatch(items, sourceLang ?: "ja", targetLang ?: "zh")
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("BATCH_TRANSLATE_ERROR", e.message ?: "端侧批量翻译失败", e)
        }
      }
    }

    Function("isOnnxTranslateSupported") {
      true
    }

    Function("isOnnxTranslateReady") {
      OnnxTranslator.isModelReady
    }

    Function("getOnnxTranslateStatus") {
      OnnxTranslator.statusMessage
    }

    AsyncFunction("onnxCheckModel") { promise: Promise ->
      val context = appContext.reactContext
      if (context != null) {
        if (!OnnxTranslator.isModelReady) {
          OnnxTranslator.init(context)
        }
        promise.resolve(OnnxTranslator.checkModelDetails(context))
      } else {
        promise.resolve(mapOf("ready" to false, "statusMessage" to "Context不可用"))
      }
    }

    AsyncFunction("onnxTranslate") { text: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val res = OnnxTranslator.translate(text)
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("ONNX_TRANSLATE_ERROR", e.message ?: "ONNX端侧翻译失败", e)
        }
      }
    }

    AsyncFunction("onnxTranslateBatch") { items: Map<String, String>, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val res = OnnxTranslator.translateBatch(items)
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("ONNX_BATCH_ERROR", e.message ?: "ONNX端侧批量翻译失败", e)
        }
      }
    }

    AsyncFunction("onnxDownloadModel") { url: String, targetFileName: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val ok = OnnxTranslator.downloadModel(context, url, targetFileName)
          promise.resolve(ok)
        } catch (e: Exception) {
          promise.reject("ONNX_DOWNLOAD_ERROR", e.message ?: "下载模型失败", e)
        }
      }
    }

    Function("onnxGetDownloadProgress") {
      OnnxTranslator.getDownloadProgress()
    }

    Function("onnxCancelDownload") {
      OnnxTranslator.cancelDownload()
    }

    AsyncFunction("onnxDeleteModelFile") { fileName: String?, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val ok = OnnxTranslator.deleteModelFiles(context, fileName)
      promise.resolve(ok)
    }

    Function("onnxListModelFiles") {
      val context = appContext.reactContext
      if (context != null) {
        OnnxTranslator.listModelFiles(context)
      } else {
        emptyList<Map<String, Any>>()
      }
    }

    AsyncFunction("onnxSetActiveModel") { modelFileName: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val ok = OnnxTranslator.setActiveModel(context, modelFileName)
          promise.resolve(ok)
        } catch (e: Exception) {
          promise.reject("SET_ACTIVE_MODEL_ERROR", e.message ?: "切换端侧模型失败", e)
        }
      }
    }

    Function("onnxGetActiveModel") {
      val context = appContext.reactContext
      if (context != null) {
        OnnxTranslator.getActiveModelFileName(context)
      } else {
        ""
      }
    }

    AsyncFunction("onnxReloadModel") { promise: Promise ->
      val context = appContext.reactContext
      if (context != null) {
        val ok = OnnxTranslator.init(context)
        promise.resolve(ok)
      } else {
        promise.resolve(false)
      }
    }

    AsyncFunction("mlkitDeleteModel") { sourceLang: String, targetLang: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val srcOk = MlKitTranslator.deleteModel(sourceLang)
          val tgtOk = MlKitTranslator.deleteModel(targetLang)
          promise.resolve(srcOk || tgtOk)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    }
  }
}
