package expo.modules.screentranslator

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Google ML Kit 端侧离线翻译管理引擎
 * 特性：
 * 1. 0 网络请求，完全运行在设备本地（需首次下载对应离线语言包，约 30MB）
 * 2. 毫秒级极速响应 (20~50ms / 句)
 * 3. 自动复用 Translator 客户端与并发协程批处理
 */
object MlKitTranslator {
  private val translators = ConcurrentHashMap<String, Translator>()

  /**
   * 将多变的前端语言标识转换为 Google ML Kit 标准 TranslateLanguage
   */
  fun mapLanguageCode(code: String?): String {
    val clean = (code ?: "").lowercase().trim()
    return when {
      clean == "ja" || clean.startsWith("jap") -> TranslateLanguage.JAPANESE
      clean == "zh" || clean.startsWith("zh") || clean.startsWith("chi") -> TranslateLanguage.CHINESE
      clean == "en" || clean.startsWith("eng") -> TranslateLanguage.ENGLISH
      clean == "ko" || clean.startsWith("kor") -> TranslateLanguage.KOREAN
      clean == "fr" || clean.startsWith("fre") -> TranslateLanguage.FRENCH
      clean == "de" || clean.startsWith("ger") -> TranslateLanguage.GERMAN
      clean == "es" || clean.startsWith("spa") -> TranslateLanguage.SPANISH
      clean == "ru" || clean.startsWith("rus") -> TranslateLanguage.RUSSIAN
      else -> TranslateLanguage.fromLanguageTag(clean) ?: TranslateLanguage.JAPANESE
    }
  }

  @Synchronized
  fun getOrCreateTranslator(sourceLang: String, targetLang: String): Translator {
    val src = mapLanguageCode(sourceLang)
    val tgt = mapLanguageCode(targetLang)
    val key = "${src}_$tgt"
    return translators.getOrPut(key) {
      val options = TranslatorOptions.Builder()
        .setSourceLanguage(src)
        .setTargetLanguage(tgt)
        .build()
      Translation.getClient(options)
    }
  }

  /**
   * 检查指定语言的端侧离线模型是否已经下载就绪
   */
  suspend fun isModelDownloaded(langCode: String): Boolean = suspendCancellableCoroutine { cont ->
    try {
      val lang = mapLanguageCode(langCode)
      val model = TranslateRemoteModel.Builder(lang).build()
      RemoteModelManager.getInstance().isModelDownloaded(model)
        .addOnSuccessListener { downloaded ->
          if (cont.isActive) cont.resume(downloaded)
        }
        .addOnFailureListener {
          if (cont.isActive) cont.resume(false)
        }
    } catch (e: Exception) {
      if (cont.isActive) cont.resume(false)
    }
  }

  /**
   * 检查源语言与目标语言模型是否均已就绪
   */
  suspend fun checkModels(sourceLang: String = "ja", targetLang: String = "zh"): Map<String, Any> {
    val src = mapLanguageCode(sourceLang)
    val tgt = mapLanguageCode(targetLang)
    val srcDownloaded = isModelDownloaded(src)
    val tgtDownloaded = isModelDownloaded(tgt)
    return mapOf(
      "sourceDownloaded" to srcDownloaded,
      "targetDownloaded" to tgtDownloaded,
      "ready" to (srcDownloaded && tgtDownloaded),
      "sourceLang" to src,
      "targetLang" to tgt
    )
  }

  /**
   * 显式触发离线翻译语言包下载
   */
  suspend fun downloadModel(
    sourceLang: String = "ja",
    targetLang: String = "zh",
    requireWifi: Boolean = false
  ): Boolean = suspendCancellableCoroutine { cont ->
    try {
      val src = mapLanguageCode(sourceLang)
      val tgt = mapLanguageCode(targetLang)
      val translator = getOrCreateTranslator(src, tgt)
      val conditionsBuilder = DownloadConditions.Builder()
      if (requireWifi) {
        conditionsBuilder.requireWifi()
      }
      val conditions = conditionsBuilder.build()

      translator.downloadModelIfNeeded(conditions)
        .addOnSuccessListener {
          if (cont.isActive) cont.resume(true)
        }
        .addOnFailureListener { e ->
          if (cont.isActive) cont.resumeWithException(e)
        }
    } catch (e: Exception) {
      if (cont.isActive) cont.resumeWithException(e)
    }
  }

  /**
   * 删除本地已下载的 Google ML Kit 离线翻译语言包以释放存储
   */
  suspend fun deleteModel(langCode: String): Boolean = suspendCancellableCoroutine { cont ->
    try {
      val lang = mapLanguageCode(langCode)
      val model = TranslateRemoteModel.Builder(lang).build()
      RemoteModelManager.getInstance().deleteDownloadedModel(model)
        .addOnSuccessListener {
          translators.clear()
          if (cont.isActive) cont.resume(true)
        }
        .addOnFailureListener {
          if (cont.isActive) cont.resume(false)
        }
    } catch (e: Exception) {
      if (cont.isActive) cont.resume(false)
    }
  }

  /**
   * 单句端侧离线翻译
   */
  suspend fun translate(
    text: String,
    sourceLang: String = "ja",
    targetLang: String = "zh"
  ): String = suspendCancellableCoroutine { cont ->
    val trimmed = text.trim()
    if (trimmed.isEmpty()) {
      cont.resume("")
      return@suspendCancellableCoroutine
    }

    try {
      val src = mapLanguageCode(sourceLang)
      val tgt = mapLanguageCode(targetLang)
      val translator = getOrCreateTranslator(src, tgt)

      translator.downloadModelIfNeeded()
        .addOnSuccessListener {
          translator.translate(trimmed)
            .addOnSuccessListener { result ->
              if (cont.isActive) cont.resume(result)
            }
            .addOnFailureListener { e ->
              if (cont.isActive) cont.resumeWithException(e)
            }
        }
        .addOnFailureListener { e ->
          if (cont.isActive) cont.resumeWithException(e)
        }
    } catch (e: Exception) {
      if (cont.isActive) cont.resumeWithException(e)
    }
  }

  /**
   * 批量端侧离线翻译 (全屏气泡并发加速)
   */
  suspend fun translateBatch(
    items: Map<String, String>,
    sourceLang: String = "ja",
    targetLang: String = "zh"
  ): Map<String, String> = withContext(Dispatchers.IO) {
    if (items.isEmpty()) return@withContext emptyMap<String, String>()

    val src = mapLanguageCode(sourceLang)
    val tgt = mapLanguageCode(targetLang)
    val translator = getOrCreateTranslator(src, tgt)

    // 确保离线包就绪
    suspendCancellableCoroutine<Unit> { cont ->
      translator.downloadModelIfNeeded()
        .addOnSuccessListener { if (cont.isActive) cont.resume(Unit) }
        .addOnFailureListener { e -> if (cont.isActive) cont.resumeWithException(e) }
    }

    // 协程并行翻译所有气泡文本
    coroutineScope {
      val deferreds = items.map { (id, text) ->
        id to async {
          if (text.isBlank()) ""
          else {
            try {
              suspendCancellableCoroutine<String> { cont ->
                translator.translate(text.trim())
                  .addOnSuccessListener { res -> if (cont.isActive) cont.resume(res) }
                  .addOnFailureListener { e -> if (cont.isActive) cont.resume(text) }
              }
            } catch (e: Exception) {
              text
            }
          }
        }
      }
      deferreds.associate { (id, deferred) -> id to deferred.await() }
    }
  }

  /**
   * 释放底层资源
   */
  fun close() {
    translators.values.forEach {
      try {
        it.close()
      } catch (e: Exception) {}
    }
    translators.clear()
  }
}
