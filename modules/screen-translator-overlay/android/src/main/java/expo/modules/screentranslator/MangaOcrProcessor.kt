package expo.modules.screentranslator

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * 漫画端侧多尺度全场景文字识别处理器
 * 融合借鉴 comic-translate 与 overlay-translator 的核心技术方案：
 * 1. 尺度规划 (Target Short Side >= 1200)：放大检测小文字、小气泡、音效 (如 ポフッ)、注音假名。
 * 2. 反相预处理 (Invert Pass)：颠倒深浅色彩，专门攻克黑底白字标语 (如 淫猥母子新シリーズご開帳♥) 与反白台词。
 * 3. 宏观缩小扫描 (Macro Downscale Pass)：将巨幅艺术封面标题 (如 訪問姦誘) 缩放到 OCR 模型感受野 (40~55px)。
 * 4. 高反差去色扫描 (High-Contrast Pass)：突破复杂插画、彩色特效字 (如 ガッ) 的低对比度限制。
 * 5. 跨气泡黑边阻断与精细化聚类 (Border-Aware Regrouping)：严格禁止跨气泡合并，确保相邻的三个独立气泡细致化展示为三个独立点！
 */
object MangaOcrProcessor {

  private val japaneseRecognizer: TextRecognizer by lazy {
    TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
  }

  private val chineseRecognizer: TextRecognizer by lazy {
    TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
  }

  private val latinRecognizer: TextRecognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }

  private val koreanRecognizer: TextRecognizer by lazy {
    TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
  }

  private fun getRecognizer(lang: String): TextRecognizer {
    return when (lang.lowercase()) {
      "zh", "chinese" -> chineseRecognizer
      "en", "latin" -> latinRecognizer
      "ko", "korean" -> koreanRecognizer
      "ja", "japanese" -> japaneseRecognizer
      else -> japaneseRecognizer // 默认为日语引擎 (面向日漫场景核心引擎，完整支持汉字、平片假名与竖排)
    }
  }

  data class TextLineItem(
    val text: String,
    val rect: Rect,
    val isVertical: Boolean,
    val charSize: Float,
    val confidenceWeight: Float = 1.0f,
    val rawConfidence: Float? = null
  )

  data class HistoricalBubble(
    val centerX: Int,
    val width: Int,
    val height: Int,
    var lastY: Int,
    var canonicalText: String,
    var lastTimestamp: Long,
    var hitCount: Int = 1
  )

  private val recentBubbleHistory = mutableListOf<HistoricalBubble>()
  private const val HISTORY_WINDOW_MS = 12000L

  data class LanguageDetectionResult(
    val langCode: String,      // "ja", "en", "zh", "ko", "auto"
    val langName: String,      // "日语", "英语", "中文", "韩语", "文本"
    val badgeColor: String     // "#EC4899", "#0EA5E9", "#10B981", "#8B5CF6", "#64748B"
  )

  // 日本和制汉字 (国字 Kokuji) 与日文独特新字体 (区别于中文字形)
  private val JAPANESE_EXCLUSIVE_CHARACTERS = setOf(
    '峠', '畑', '辻', '込', '咲', '枠', '躾', '働', '匂', '雫', '喰', '笹', '榊', '畠', '栃',
    '樫', '気', '図', '広', '変', '黒', '抜', '払', '沢', '渋', '歩', '転', '伝', '絵', '単',
    '戦', '読', '訳', '経', '験', '対', '楽', '学', '体', '声', '売', '買', '仮', '塩', '实',
    '宝', '寿', '帯', '弁', '桜', '条', '糸', '麦', '糀', '燵', '轡', '鰯', '鱈', '噺', '凧', '毟'
  )

  // 中国现代大陆特有简化字 (在日文常用汉字表/JIS规范中完全不存在的独有简体字)
  private val SIMPLIFIED_CHINESE_EXCLUSIVE = setOf(
    '这', '么', '为', '说', '们', '后', '个', '时', '样', '着', '见', '问', '给', '发', '还',
    '过', '来', '进', '长', '对', '从', '无', '经', '动', '现', '欢', '迎', '谁', '哪', '别',
    '让', '做', '没', '两', '将', '认', '识', '话', '语', '听', '写', '记', '得', '带', '帮',
    '并', '且', '虽', '然', '但', '是', '因', '此', '如', '果', '就', '会', '能', '想', '要',
    '道', '知', '很', '太', '真', '更', '最', '已', '总', '算', '完', '成', '什', '怎', '呢',
    '吧', '啊', '哦', '嗯', '好', '去', '看', '吃', '喝', '玩', '钱', '买', '卖', '东', '西'
  )

  /**
   * 检查文本是否包含日文专属特征 (假名、长音符、叠字符号「々」、和字)
   */
  fun hasJapaneseSpecificFeatures(text: String): Boolean {
    var idx = 0
    while (idx < text.length) {
      val cp = text.codePointAt(idx)
      idx += Character.charCount(cp)

      // 平假名 / 片假名 / 假名扩展 / 半角片假名
      if (cp in 0x3040..0x309F || cp in 0x30A0..0x30FF || cp in 0x31F0..0x31FF || cp in 0xFF65..0xFF9F) {
        return true
      }
      // 日文叠字符号与标点: 々 (0x3005), ゝ (0x309D), ゞ (0x309E), ヽ (0x30FD), ヾ (0x30FE), ー (0x30FC)
      if (cp == 0x3005 || cp == 0x309D || cp == 0x309E || cp == 0x30FD || cp == 0x30FE || cp == 0x30FC) {
        return true
      }
      // 和制汉字 / 日本特有字形
      if (Character.toChars(cp).any { it in JAPANESE_EXCLUSIVE_CHARACTERS }) {
        return true
      }
    }
    return false
  }

  /**
   * 检查是否含有现代大陆特有简化字
   */
  fun hasSimplifiedExclusiveChinese(text: String): Boolean {
    return text.any { it in SIMPLIFIED_CHINESE_EXCLUSIVE }
  }

  /**
   * 基于 Unicode 码点特征 + 上下文感知的全场景语种精准判别
   * 彻底解决日文纯汉字 (Kanji 如「高校生」「先生」「第一話」「契約」「恋愛」等) 被无脑误判为中文的问题！
   */
  fun detectLanguage(
    text: String,
    preferredLang: String = "auto",
    contextHasJapanese: Boolean = false
  ): LanguageDetectionResult {
    val clean = text.trim()
    if (clean.isEmpty()) {
      return LanguageDetectionResult("auto", "文本", "#64748B")
    }

    var kanaCount = 0            // 平假名 & 片假名
    var japaneseSymbolCount = 0  // 々 / ー / 和字
    var hangulCount = 0          // 韩文
    var hanziCount = 0           // 汉字
    var latinCount = 0           // 拉丁字母

    var idx = 0
    while (idx < clean.length) {
      val cp = clean.codePointAt(idx)
      idx += Character.charCount(cp)

      when {
        // 日文假名 (Hiragana 0x3040-0x309F, Katakana 0x30A0-0x30FF, 假名扩展 0x31F0-0x31FF, 半角片假名 0xFF65-0xFF9F)
        cp in 0x3040..0x309F || cp in 0x30A0..0x30FF || cp in 0x31F0..0x31FF || cp in 0xFF65..0xFF9F -> kanaCount++

        // 日文专属叠字「々」及片假名长音符「ー」等
        cp == 0x3005 || cp == 0x30FC || cp == 0x309D || cp == 0x309E || cp == 0x30FD || cp == 0x30FE -> japaneseSymbolCount++

        // 和制汉字与新字体
        Character.toChars(cp).any { it in JAPANESE_EXCLUSIVE_CHARACTERS } -> japaneseSymbolCount++

        // 韩文音节与字母 (Hangul Syllables 0xAC00-0xD7AF, Hangul Jamo 0x1100-0x11FF, 0x3130-0x318F)
        cp in 0xAC00..0xD7AF || cp in 0x1100..0x11FF || cp in 0x3130..0x318F -> hangulCount++

        // 汉字 (CJK Unified Ideographs 0x4E00-0x9FFF, Extension A 0x3400-0x4DBF)
        cp in 0x4E00..0x9FFF || cp in 0x3400..0x4DBF -> hanziCount++

        // 拉丁英文字母 (A-Z, a-z, 及基本拉丁扩充)
        (cp in 0x0041..0x005A) || (cp in 0x0061..0x007A) || (cp in 0x00C0..0x024F) -> latinCount++
      }
    }

    // 1. 若出现日文假名或日文专属符号「々」「ー」/和字，无论包含多少汉字，100% 必然是日文 (如 "お前...本気か", "佐々木", "ラーメン")
    if (kanaCount > 0 || japaneseSymbolCount > 0) {
      return LanguageDetectionResult("ja", "日语", "#EC4899") // 樱花粉
    }

    // 2. 若出现韩文谚文音节或字母，判定为韩文
    if (hangulCount > 0) {
      return LanguageDetectionResult("ko", "韩语", "#8B5CF6") // 优雅紫
    }

    // 3. 汉字处理核心（关键修复！）：
    if (hanziCount > 0 && hanziCount >= latinCount) {
      val isJapaneseContext = (preferredLang.lowercase() in listOf("ja", "japanese")) || contextHasJapanese
      val containsSimplifiedExclusive = hasSimplifiedExclusiveChinese(clean)

      if (isJapaneseContext) {
        // 用户明确选择“日语”，或者同屏环境是日文：
        // 只要没有出现中国特有独有简体字（如“这/么/说/为/们/后/样”），纯汉字均属于标准的日文汉字 (Kanji)！
        if (!containsSimplifiedExclusive) {
          return LanguageDetectionResult("ja", "日语", "#EC4899") // 樱花粉
        } else {
          return LanguageDetectionResult("zh", "中文", "#10B981") // 出现简体专有字才判为中文
        }
      } else {
        // 自动未指定模式：若无简体字且含日文字形，也判定为日文
        if (japaneseSymbolCount > 0) {
          return LanguageDetectionResult("ja", "日语", "#EC4899")
        }
        return LanguageDetectionResult("zh", "中文", "#10B981") // 默认通用汉字标记
      }
    }

    // 4. 若主要是拉丁字母，判定为英文/拉丁语系
    if (latinCount > 0) {
      return LanguageDetectionResult("en", "英语", "#0EA5E9") // 湖水蓝
    }

    // 5. 汉字兜底
    if (hanziCount > 0) {
      if (preferredLang.lowercase() in listOf("ja", "japanese") || contextHasJapanese) {
        return LanguageDetectionResult("ja", "日语", "#EC4899")
      }
      return LanguageDetectionResult("zh", "中文", "#10B981")
    }

    return LanguageDetectionResult("auto", "文本", "#64748B")
  }

  /**
   * 按用户指定的语言精确过滤与自动矫正文本气泡 (仅展示需要被翻译的指定语言文本)
   * 支持: "ja" (日语), "en" (英语), "zh" (中文), "ko" (韩语), "auto"/"all" (全部展示)
   */
  fun filterByTargetLanguage(
    bubbles: List<Map<String, Any>>,
    targetLang: String
  ): List<Map<String, Any>> {
    val filter = targetLang.trim().lowercase()
    if (filter.isEmpty() || filter == "auto" || filter == "all") {
      return bubbles
    }

    return bubbles.mapNotNull { item ->
      val targetText = item["targetText"] as? String ?: ""
      val textType = item["textType"] as? String ?: "bubble"
      val isFromModel = (item["detectorSource"] == "comic_model") || (item["id"] as? String)?.startsWith("comic_det_") == true

      // 核心保护 1：已经翻译成功或带有译文的气泡，绝对严禁被源语言过滤器过滤抛弃！
      if (targetText.isNotBlank()) {
        return@mapNotNull item
      }

      // 核心保护 2：艺术字、拟声词以及模型检出的气泡候选框，绝不提前过滤销毁！
      if (textType == "art_text" || textType == "sfx" || isFromModel) {
        return@mapNotNull item
      }

      val detected = (item["detectedLang"] as? String)?.lowercase() ?: "auto"
      val text = item["sourceText"] as? String ?: ""

      when (filter) {
        "ja", "japanese" -> {
          // 仅日文模式：
          if (detected == "ja") {
            item
          } else if ((detected == "zh" || detected == "auto") && !hasSimplifiedExclusiveChinese(text)) {
            // 将纯汉字标题/词汇矫正为标准的日文 Kanji 标识！
            item.toMutableMap().apply {
              put("detectedLang", "ja")
              put("langName", "日语")
              put("langColor", "#EC4899")
            }
          } else {
            null // 彻底过滤掉非日文
          }
        }
        "en", "latin", "english" -> {
          if (detected == "en") item else null
        }
        "zh", "chinese" -> {
          if (detected == "zh") item else null
        }
        "ko", "korean" -> {
          if (detected == "ko") item else null
        }
        else -> {
          if (detected == filter) item else null
        }
      }
    }
  }

  /**
   * 气泡无重叠与碰撞解耦 (Inter-Bubble Non-Overlap & De-Collision Resolver)
   * 核心体验优化：1:1 还原原作漫画排版中“气泡天然互不重叠”的视觉规则。
   * 1. 深度重合合并 (IoU > 0.20 或 重叠率 > 0.35)：判定为同一对话框或多行拆散片段，智能融合为一个完整气泡包络；
   * 2. 相邻边缘交叠 (像素轻微侵入碰撞)：按交叠中轴线平分退让分割边界，彻底消除气泡间的叠字遮挡！
   */
  fun resolveBubbleOverlaps(bubbles: List<Map<String, Any>>): List<Map<String, Any>> {
    if (bubbles.size <= 1) return bubbles

    val mutableList = bubbles.map { it.toMutableMap() }.toMutableList()
    var hasChanges = true
    var iterations = 0

    // 第一阶段：重度交叠智能合并 (Merge High Overlaps)
    while (hasChanges && iterations < 8) {
      hasChanges = false
      iterations++

      outer@ for (i in 0 until mutableList.size) {
        val bA = mutableList[i]
        val boxA = bA["box"] as? Map<*, *> ?: continue
        val ax1 = (boxA["x"] as? Number)?.toInt() ?: 0
        val ay1 = (boxA["y"] as? Number)?.toInt() ?: 0
        val aw = (boxA["width"] as? Number)?.toInt() ?: 0
        val ah = (boxA["height"] as? Number)?.toInt() ?: 0
        val rA = Rect(ax1, ay1, ax1 + aw, ay1 + ah)

        for (j in i + 1 until mutableList.size) {
          val bB = mutableList[j]
          val boxB = bB["box"] as? Map<*, *> ?: continue
          val bx1 = (boxB["x"] as? Number)?.toInt() ?: 0
          val by1 = (boxB["y"] as? Number)?.toInt() ?: 0
          val bw = (boxB["width"] as? Number)?.toInt() ?: 0
          val bh = (boxB["height"] as? Number)?.toInt() ?: 0
          val rB = Rect(bx1, by1, bx1 + bw, by1 + bh)

          val inter = computeIntersection(rA, rB)
          val minArea = min(rA.width() * rA.height(), rB.width() * rB.height()).toFloat()
          val overlapRatio = if (minArea > 0f) inter / minArea else 0f
          val iou = computeIoU(rA, rB)

          if (iou > 0.20f || overlapRatio > 0.35f) {
            val unionRect = Rect(
              min(rA.left, rB.left),
              min(rA.top, rB.top),
              max(rA.right, rB.right),
              max(rA.bottom, rB.bottom)
            )
            val textA = bA["sourceText"] as? String ?: ""
            val textB = bB["sourceText"] as? String ?: ""
            val preferredText = when {
              textA.contains(textB) -> textA
              textB.contains(textA) -> textB
              textA.length >= textB.length -> textA
              else -> textB
            }
            val preferredLines = if (textA.length >= textB.length) {
              bA["lines"] ?: bB["lines"]
            } else {
              bB["lines"] ?: bA["lines"]
            }

            bA["box"] = mapOf(
              "x" to unionRect.left,
              "y" to unionRect.top,
              "width" to unionRect.width(),
              "height" to unionRect.height()
            )
            bA["sourceText"] = preferredText
            if (preferredLines != null) bA["lines"] = preferredLines

            mutableList.removeAt(j)
            hasChanges = true
            break@outer
          }
        }
      }
    }

    // 第二阶段：轻微边缘交叠解耦 (Edge Separation for slight overlap)
    for (i in 0 until mutableList.size) {
      val bA = mutableList[i]
      val boxA = bA["box"] as? Map<*, *> ?: continue
      var ax1 = (boxA["x"] as? Number)?.toInt() ?: 0
      var ay1 = (boxA["y"] as? Number)?.toInt() ?: 0
      var aw = (boxA["width"] as? Number)?.toInt() ?: 0
      var ah = (boxA["height"] as? Number)?.toInt() ?: 0

      for (j in i + 1 until mutableList.size) {
        val bB = mutableList[j]
        val boxB = bB["box"] as? Map<*, *> ?: continue
        var bx1 = (boxB["x"] as? Number)?.toInt() ?: 0
        var by1 = (boxB["y"] as? Number)?.toInt() ?: 0
        var bw = (boxB["width"] as? Number)?.toInt() ?: 0
        var bh = (boxB["height"] as? Number)?.toInt() ?: 0

        val rA = Rect(ax1, ay1, ax1 + aw, ay1 + ah)
        val rB = Rect(bx1, by1, bx1 + bw, by1 + bh)

        if (Rect.intersects(rA, rB)) {
          val interW = min(rA.right, rB.right) - max(rA.left, rB.left)
          val interH = min(rA.bottom, rB.bottom) - max(rA.top, rB.top)

          if (interW < interH) {
            // 水平方向交叠较小：沿水平中轴线平分退让
            val shift = interW / 2 + 1
            if (rA.centerX() < rB.centerX()) {
              aw = max(14, aw - shift)
              bx1 += shift
              bw = max(14, bw - shift)
            } else {
              ax1 += shift
              aw = max(14, aw - shift)
              bw = max(14, bw - shift)
            }
          } else {
            // 垂直方向交叠较小：沿垂直中轴线平分退让
            val shift = interH / 2 + 1
            if (rA.centerY() < rB.centerY()) {
              ah = max(14, ah - shift)
              by1 += shift
              bh = max(14, bh - shift)
            } else {
              ay1 += shift
              ah = max(14, ah - shift)
              bh = max(14, bh - shift)
            }
          }

          bA["box"] = mapOf("x" to ax1, "y" to ay1, "width" to aw, "height" to ah)
          bB["box"] = mapOf("x" to bx1, "y" to by1, "width" to bw, "height" to bh)
        }
      }
    }

    return mutableList
  }

  /**
   * 实时悬浮窗专用多尺度/多通道高精度 OCR 检测 (耗时 ~50-80ms)
   * 包含：
   * 1. 基准尺度快速扫描 (1.0x)
   * 2. 自适应放大高清扫描 (Upscale Pass)：大幅提升小气泡、小字注音 (如「初めてで」「悪い？」「…ん？」) 的检出率
   * 3. 高反差增强扫描 (High-Contrast Pass)：消除发丝遮挡干扰、背景网点和放射状阴影 (如「あれ？鮮血…？」)
   * 4. 色彩反相扫描 (Invert Pass)：捕捉黑底白字标语与深色气泡
   */
  suspend fun processImageFast(
    bitmap: Bitmap,
    lang: String = "auto",
    filterLang: String = "auto",
    viewportMode: String = "full",
    context: Context? = null
  ): List<Map<String, Any>> {
    val screenW = bitmap.width
    val screenH = bitmap.height
    val aspectRatio = screenH.toFloat() / max(1, screenW)

    // 用户需求：整个屏幕识别 (full 模式下 topMarginRatio=0, bottomMarginRatio=0, 零裁剪完整扫描)
    val (topMarginRatio, bottomMarginRatio) = when (viewportMode.lowercase()) {
      "center50", "half", "center" -> Pair(0.25f, 0.25f) // 中央 50%
      "golden" -> { // 黄金阅读视口
        if (aspectRatio >= 1.6f) {
          Pair(0.12f, 0.12f)
        } else if (aspectRatio >= 1.3f) {
          Pair(0.06f, 0.06f)
        } else {
          Pair(0.0f, 0.0f)
        }
      }
      else -> Pair(0.0f, 0.0f) // 默认全屏 100% 完整扫描
    }

    val roiTop = (screenH * topMarginRatio).toInt()
    val roiBottom = (screenH * (1.0f - bottomMarginRatio)).toInt()
    val roiHeight = roiBottom - roiTop
    val roiWidth = screenW

    val isCropped = roiTop > 0 || roiBottom < screenH
    var workingBitmap: Bitmap? = null
    val targetBitmap = if (isCropped && roiHeight >= 120) {
      try {
        workingBitmap = Bitmap.createBitmap(bitmap, 0, roiTop, roiWidth, roiHeight)
        workingBitmap
      } catch (e: Exception) {
        bitmap
      }
    } else {
      bitmap
    }

    val effectiveLang = if (lang.lowercase() in listOf("auto", "all", "ja")) "ja" else lang
    val recognizer = getRecognizer(effectiveLang)
    val allDetectedLines = mutableListOf<TextLineItem>()

    context?.let { ctx ->
      if (!MangaOcrModel.isModelReady) {
        MangaOcrModel.init(ctx)
      }
    }

    try {
      // 1. 基准尺度扫描 (1.0x, 权重 1.0f)
      val baseLines = recognizeSingleBitmap(recognizer, targetBitmap, 1.0f, 1.0f, confidenceWeight = 1.0f)
      allDetectedLines.addAll(baseLines)

      // 2. 自适应放大 + Unsharp Mask 笔画边缘增强 + 笔画分离对比 (Upscale & USM Pass, 核心权重 3.2f)
      val shortSide = min(targetBitmap.width, targetBitmap.height)
      if (shortSide < 1600) {
        val upscaleFactor = if (shortSide < 600) 2.2f else if (shortSide < 900) 1.85f else 1.5f
        val upW = (targetBitmap.width * upscaleFactor).toInt()
        val upH = (targetBitmap.height * upscaleFactor).toInt()
        var upscaledBitmap: Bitmap? = null
        var unsharpBitmap: Bitmap? = null
        var sharpenedUpscaled: Bitmap? = null
        try {
          upscaledBitmap = Bitmap.createScaledBitmap(targetBitmap, upW, upH, true)
          unsharpBitmap = createUnsharpMaskedBitmap(upscaledBitmap, radius = 2, amount = 1.2f)
          sharpenedUpscaled = createStrokeSharpenedBitmap(unsharpBitmap)
          val upLines = recognizeSingleBitmap(recognizer, sharpenedUpscaled, upscaleFactor, upscaleFactor, confidenceWeight = 3.2f)
          allDetectedLines.addAll(upLines)
        } catch (e: Exception) {
        } finally {
          upscaledBitmap?.recycle()
          unsharpBitmap?.recycle()
          sharpenedUpscaled?.recycle()
        }
      }

      // 3. 高反差增强扫描 (High-Contrast Pass, 权重 2.2f)
      var contrastBitmap: Bitmap? = null
      try {
        contrastBitmap = createHighContrastBitmap(targetBitmap)
        val contrastLines = recognizeSingleBitmap(recognizer, contrastBitmap, 1.0f, 1.0f, confidenceWeight = 2.2f)
        allDetectedLines.addAll(contrastLines)
      } catch (e: Exception) {
      } finally {
        contrastBitmap?.recycle()
      }

      // 4. 色彩反相扫描 (Invert Pass, 权重 2.0f)
      var invertedBitmap: Bitmap? = null
      try {
        invertedBitmap = createInvertedBitmap(targetBitmap)
        val invLines = recognizeSingleBitmap(recognizer, invertedBitmap, 1.0f, 1.0f, confidenceWeight = 2.0f)
        allDetectedLines.addAll(invLines)
      } catch (e: Exception) {
      } finally {
        invertedBitmap?.recycle()
      }

      // 5. 空心描边艺术字闭合实心化扫描 (Stroke Infilled Pass, 权重 2.5f)
      var infilledBitmap: Bitmap? = null
      try {
        infilledBitmap = MangaBubbleSegmenter.createStrokeInfilledBitmap(targetBitmap)
        if (infilledBitmap != null) {
          val infilledLines = recognizeSingleBitmap(recognizer, infilledBitmap, 1.0f, 1.0f, confidenceWeight = 2.5f)
          allDetectedLines.addAll(infilledLines)
        }
      } catch (e: Exception) {
      } finally {
        infilledBitmap?.recycle()
      }

      // 6. 宏观缩小扫描 (Macro Downscale Pass, 权重 2.0f) - 适配大标题与巨型艺术字感受野
      if (targetBitmap.width >= 540 && targetBitmap.height >= 700) {
        val downFactor = max(0.38f, min(0.65f, 540f / targetBitmap.width))
        val downW = (targetBitmap.width * downFactor).toInt()
        val downH = (targetBitmap.height * downFactor).toInt()
        var downscaledBmp: Bitmap? = null
        try {
          downscaledBmp = Bitmap.createScaledBitmap(targetBitmap, downW, downH, true)
          val downLines = recognizeSingleBitmap(recognizer, downscaledBmp, downFactor, downFactor, confidenceWeight = 2.0f)
          allDetectedLines.addAll(downLines)
        } catch (e: Exception) {
        } finally {
          downscaledBmp?.recycle()
        }
      }

      // 跨尺度与多通道去重融合
      val deduplicated = deduplicateLines(allDetectedLines)
      val rawBubbles = clusterAndFormatBubbles(deduplicated, targetBitmap, preferredLang = filterLang)

      // 7. 方法 2 核心：漫画专用端侧深度学习检测器融合 (ComicTextDetector - 分类别动态置信度)
      // 专门检出常规 OCR 漏检的艺术字、拟声词 (SFX) 与特殊气泡，并进行局部靶向 OCR
      val comicDetections = try {
        ComicTextDetector.detect(targetBitmap, context = context, scoreThreshold = 0.28f, artScoreThreshold = 0.18f)
      } catch (e: Exception) {
        emptyList()
      }

      val fusedBubbles = fuseComicDetections(
        recognizer = recognizer,
        sourceBitmap = targetBitmap,
        baseBubbles = rawBubbles,
        detections = comicDetections,
        preferredLang = filterLang
      )

      val filtered = filterByTargetLanguage(fusedBubbles, filterLang)
      // 气泡无重叠与碰撞解耦：彻底杜绝多个框在原图上相互重叠
      val decollided = resolveBubbleOverlaps(filtered)

      // 关键坐标映射：若启用了黄金视口截取，无缝偏移映射回手机物理全屏的原位绝对坐标！
      return if (isCropped && targetBitmap != bitmap && roiTop > 0) {
        decollided.map { b ->
          val boxMap = b["box"] as? Map<*, *> ?: return@map b
          val bx = (boxMap["x"] as? Number)?.toInt() ?: 0
          val by = (boxMap["y"] as? Number)?.toInt() ?: 0
          val bw = (boxMap["width"] as? Number)?.toInt() ?: 0
          val bh = (boxMap["height"] as? Number)?.toInt() ?: 0
          val mutable = b.toMutableMap()
          mutable["box"] = mapOf(
            "x" to bx,
            "y" to by + roiTop,
            "width" to bw,
            "height" to bh
          )
          mutable
        }
      } else {
        decollided
      }
    } finally {
      if (workingBitmap != null && workingBitmap != bitmap) {
        workingBitmap.recycle()
      }
    }
  }

  /**
   * 异步多尺度识别 Bitmap 中的全量文字
   */
  suspend fun processImage(
    bitmap: Bitmap,
    lang: String = "ja",
    filterLang: String = "auto",
    context: Context? = null
  ): List<Map<String, Any>> {
    val recognizer = getRecognizer(lang)
    val allDetectedLines = mutableListOf<TextLineItem>()

    context?.let { ctx ->
      if (!MangaOcrModel.isModelReady) {
        MangaOcrModel.init(ctx)
      }
    }

    // 1. 基准尺度扫描 (1.0x, 权重 1.0f)
    val baseLines = recognizeSingleBitmap(recognizer, bitmap, 1.0f, 1.0f, confidenceWeight = 1.0f)
    allDetectedLines.addAll(baseLines)

    // 2. 自适应放大 + Unsharp Mask 笔画边缘增强 + 笔画分离对比 (Upscale & USM Pass, 核心权重 3.2f)
    val shortSide = min(bitmap.width, bitmap.height)
    if (shortSide < 1200) {
      val upscaleFactor = min(2.5f, max(1.4f, 1300f / shortSide))
      val upW = (bitmap.width * upscaleFactor).toInt()
      val upH = (bitmap.height * upscaleFactor).toInt()
      var upscaledBitmap: Bitmap? = null
      var unsharpBitmap: Bitmap? = null
      var sharpenedUpscaled: Bitmap? = null
      try {
        upscaledBitmap = Bitmap.createScaledBitmap(bitmap, upW, upH, true)
        unsharpBitmap = createUnsharpMaskedBitmap(upscaledBitmap, radius = 2, amount = 1.2f)
        sharpenedUpscaled = createStrokeSharpenedBitmap(unsharpBitmap)
        val upscaledLines = recognizeSingleBitmap(recognizer, sharpenedUpscaled, upscaleFactor, upscaleFactor, confidenceWeight = 3.2f)
        allDetectedLines.addAll(upscaledLines)
      } catch (e: Exception) {
      } finally {
        upscaledBitmap?.recycle()
        unsharpBitmap?.recycle()
        sharpenedUpscaled?.recycle()
      }
    }

    // 3. 色彩反相扫描 (Invert Pass)
    var invertedBitmap: Bitmap? = null
    try {
      invertedBitmap = createInvertedBitmap(bitmap)
      val invertedLines = recognizeSingleBitmap(recognizer, invertedBitmap, 1.0f, 1.0f)
      allDetectedLines.addAll(invertedLines)

      if (shortSide < 1200) {
        val upscaleFactor = min(2.5f, max(1.4f, 1300f / shortSide))
        val upW = (bitmap.width * upscaleFactor).toInt()
        val upH = (bitmap.height * upscaleFactor).toInt()
        var upscaledInverted: Bitmap? = null
        try {
          upscaledInverted = Bitmap.createScaledBitmap(invertedBitmap, upW, upH, true)
          val upInvertedLines = recognizeSingleBitmap(recognizer, upscaledInverted, upscaleFactor, upscaleFactor)
          allDetectedLines.addAll(upInvertedLines)
        } catch (e: Exception) {
        } finally {
          upscaledInverted?.recycle()
        }
      }
    } catch (e: Exception) {
    } finally {
      invertedBitmap?.recycle()
    }

    // 4. 针对巨型封面艺术标题的宏观缩小扫描 (Macro Downscale Pass)
    if (bitmap.width >= 540 && bitmap.height >= 700) {
      val downscaleFactor = max(0.36f, min(0.65f, 540f / bitmap.width))
      val downW = (bitmap.width * downscaleFactor).toInt()
      val downH = (bitmap.height * downscaleFactor).toInt()
      var downscaledBitmap: Bitmap? = null
      try {
        downscaledBitmap = Bitmap.createScaledBitmap(bitmap, downW, downH, true)
        val downscaledLines = recognizeSingleBitmap(recognizer, downscaledBitmap, downscaleFactor, downscaleFactor)
        allDetectedLines.addAll(downscaledLines)
      } catch (e: Exception) {
      } finally {
        downscaledBitmap?.recycle()
      }
    }

    // 5. 针对彩色/弱对比度特效字的高反差扫描 (High-Contrast Pass)
    var contrastBitmap: Bitmap? = null
    try {
      contrastBitmap = createHighContrastBitmap(bitmap)
      val contrastLines = recognizeSingleBitmap(recognizer, contrastBitmap, 1.0f, 1.0f)
      allDetectedLines.addAll(contrastLines)
    } catch (e: Exception) {
    } finally {
      contrastBitmap?.recycle()
    }

    // 6. Sauvola 局部自适应二值化扫描
    var binarizedBitmap: Bitmap? = null
    try {
      binarizedBitmap = createSauvolaBinarizedBitmap(bitmap)
      val binarizedLines = recognizeSingleBitmap(recognizer, binarizedBitmap, 1.0f, 1.0f)
      allDetectedLines.addAll(binarizedLines)
    } catch (e: Exception) {
    } finally {
      binarizedBitmap?.recycle()
    }

    // 7. 跨尺度去重融合 (IoU / Overlap Deduplication)
    val deduplicatedLines = deduplicateLines(allDetectedLines)

    // 8. 边界感知 (Border-Aware) 独立气泡聚类与细致化重构
    val rawBubbles = clusterAndFormatBubbles(deduplicatedLines, bitmap, preferredLang = filterLang)

    // 9. 方法 2 核心：漫画专用端侧深度学习检测器融合 (ComicTextDetector - 分类别动态置信度)
    val comicDetections = try {
      ComicTextDetector.detect(bitmap, context = context, scoreThreshold = 0.28f, artScoreThreshold = 0.18f)
    } catch (e: Exception) {
      emptyList()
    }

    val fusedBubbles = fuseComicDetections(
      recognizer = recognizer,
      sourceBitmap = bitmap,
      baseBubbles = rawBubbles,
      detections = comicDetections,
      preferredLang = filterLang
    )

    val filtered = filterByTargetLanguage(fusedBubbles, filterLang)
    return resolveBubbleOverlaps(filtered)
  }

  /**
   * 判定某识别文本是否属于纯图像噪点/伪字符 (如分格线、速度线误检为一长串横线，或将纸张杂点误判为孤立标点)
   */
  private fun isJunkNoiseLine(text: String, rect: Rect): Boolean {
    val clean = text.replace(Regex("[\\s\\r\\n]+"), "")
    if (clean.isEmpty()) return true

    // 1. 纯线条噪点过滤：用户痛点“OCR 一次性返回 10 几个 ----”
    // 漫画中大量网点线、速度线、分格框线、排线会被误识别为一串横线或长音符 (如 ---------------- 或 ―――――――― 或 ーーーーーーーー)
    val pureLineChars = setOf('-', '—', '―', 'ー', '─', '━', '_', '=', '~', '〜')
    val isAllLineChars = clean.all { it in pureLineChars }
    if (isAllLineChars) {
      // 纯横线、减号、长音符、波浪线、下划线，100% 为画面线条噪点，彻底拦截过滤！
      return true
    }

    // 2. 纯标点噪点过滤：仅包含常见标点符号且无任何实质文字
    val lineAndPunctuationChars = setOf(
      '-', '—', '―', 'ー', '─', '━', '_', '=', '~', '〜', '.', '·', '・', '…', '。', '、', '，',
      '|', '丨', 'l', 'I', '/', '\\', '^', '\'', '"', '°', '`', ':', ';', '!', '?', '！', '？', '⋮'
    )
    val isAllLineOrPunct = clean.all { it in lineAndPunctuationChars }
    if (isAllLineOrPunct) {
      // 允许标准的日漫对话省略号 (长度>=2，如 "……" 或 "...")，过滤孤立单点/长横线/杂项符号噪点
      val isEllipsis = clean.length in 2..8 && (clean.contains("…") || clean.contains("...") || clean.contains("···") || clean.contains("⋮"))
      if (!isEllipsis || (rect.width() < 24 && rect.height() < 24)) {
        return true
      }
    }

    // 3. 实质文字内容检测：必须包含至少一个合法的汉字、平假名、真正片假名（排除单独的长音符ー）、韩文字符、英文字母或数字
    val hasMeaningfulContent = clean.any { ch ->
      (ch in '\u4E00'..'\u9FFF') || // 汉字
      (ch in '\u3040'..'\u309F') || // 平假名
      (ch in '\u30A0'..'\u30FA' && ch != 'ー') || // 片假名（排除单独的长音符）
      (ch in '\uAC00'..'\uD7AF') || // 韩文字符
      (ch in 'a'..'z') || (ch in 'A'..'Z') || (ch in '0'..'9')
    }
    if (!hasMeaningfulContent) {
      // 没有任何实质文字，仅为各种杂项符号堆叠，彻底过滤
      return true
    }

    // 4. 极端宽高比线条过滤 (画框边缘、长条网点误检)
    val w = rect.width()
    val h = rect.height()
    if ((h <= 14 && w >= 60 && w.toFloat() / max(1, h) > 5.0f) ||
        (w <= 14 && h >= 60 && h.toFloat() / max(1, w) > 5.0f)) {
      if (clean.length <= 4 && !clean.any { ch -> (ch in '\u4E00'..'\u9FFF') || (ch in '\u3040'..'\u309F') }) {
        return true
      }
    }

    // 5. 极微型尺寸噪点 (面积 < 120px² 且字符数 <= 1)
    if (clean.length == 1 && (w * h < 120)) {
      val c = clean[0]
      val isImportantKanjiOrKana = (c in '\u3040'..'\u30FF' && c != 'ー') || (c in '\u4E00'..'\u9FFF')
      if (!isImportantKanjiOrKana || w < 11 || h < 11) {
        return true
      }
    }

    return false
  }

  /**
   * 针对未识别出文字的艺术字/拟声词候选区域进行定向靶向 ROI 识别
   * (采用局部多尺度放大/缩小、高反差、反相、微旋转，耗时极短且具备极高敏感度)
   */
  private suspend fun enhanceCandidateRegion(
    recognizer: TextRecognizer,
    sourceBitmap: Bitmap,
    regionRect: Rect,
    preferredLang: String = "auto",
    screenHasJapanese: Boolean = true
  ): Map<String, Any>? {
    val srcW = sourceBitmap.width
    val srcH = sourceBitmap.height

    // 增加 12% 外边距安全缓冲，确保边界处的假名、标点、长音符不被裁切
    val padX = max(8, (regionRect.width() * 0.12f).toInt())
    val padY = max(8, (regionRect.height() * 0.12f).toInt())
    val cropLeft = max(0, regionRect.left - padX)
    val cropTop = max(0, regionRect.top - padY)
    val cropRight = min(srcW, regionRect.right + padX)
    val cropBottom = min(srcH, regionRect.bottom + padY)
    val cropW = cropRight - cropLeft
    val cropH = cropBottom - cropTop

    if (cropW < 14 || cropH < 14) return null

    var cropBmp: Bitmap? = null
    var colorBmp: Bitmap? = null
    var infilledBmp: Bitmap? = null
    var contrastBmp: Bitmap? = null
    var invertBmp: Bitmap? = null

    try {
      cropBmp = Bitmap.createBitmap(sourceBitmap, cropLeft, cropTop, cropW, cropH)

      // 0. 优先调用漫画端侧专用模型 (Manga-OCR Mobile) 识别原始切片
      if (MangaOcrModel.isModelReady) {
        val mangaOcrText = MangaOcrModel.recognize(cropBmp)
        if (mangaOcrText.isNotBlank() && !isJunkNoiseLine(mangaOcrText, regionRect)) {
          val isVertical = regionRect.height() > regionRect.width() * 1.15f
          val disambiguated = disambiguateMangaCharacters(mangaOcrText)
          val langInfo = detectLanguage(disambiguated, preferredLang, screenHasJapanese)
          return mapOf(
            "sourceText" to disambiguated,
            "lines" to listOf(disambiguated),
            "direction" to if (isVertical) "vertical" else "horizontal",
            "detectedLang" to langInfo.langCode,
            "langName" to langInfo.langName,
            "langColor" to langInfo.badgeColor,
            "ocrEngine" to "manga_ocr"
          )
        }
      }

      val detectedLines = mutableListOf<TextLineItem>()

      // 1. 基准切片扫描 (1.0x)
      val baseLines = recognizeSingleBitmap(recognizer, cropBmp, 1.0f, 1.0f, confidenceWeight = 1.0f)
      detectedLines.addAll(baseLines)

      // 2. 自适应尺度优化扫描 (包含小字与常规气泡的 2.0x 局部超分辨率放大、大字体的多阶动态降采样)
      val maxDim = max(cropW, cropH)
      val minDim = min(cropW, cropH)
      if (cropW < 380 || cropH < 380) {
        val upScale = 2.0f
        val upW = (cropW * upScale).toInt()
        val upH = (cropH * upScale).toInt()
        var upBmp: Bitmap? = null
        try {
          upBmp = Bitmap.createScaledBitmap(cropBmp, upW, upH, true)
          val upLines = recognizeSingleBitmap(recognizer, upBmp, upScale, upScale, confidenceWeight = 2.5f)
          detectedLines.addAll(upLines)
        } catch (e: Exception) {
        } finally {
          upBmp?.recycle()
        }
      }
      if (maxDim > 140) {
        // 大字体自适应降采样：动态将字高缩放至 36~48px 黄金感受野，突破大标题感受野限制
        val downScale = min(0.65f, max(0.24f, 44f / max(1, minDim)))
        val dW = max(20, (cropW * downScale).toInt())
        val dH = max(20, (cropH * downScale).toInt())
        var downBmp: Bitmap? = null
        try {
          downBmp = Bitmap.createScaledBitmap(cropBmp, dW, dH, true)
          val downLines = recognizeSingleBitmap(recognizer, downBmp, downScale, downScale, confidenceWeight = 2.6f)
          detectedLines.addAll(downLines)
        } catch (e: Exception) {
        } finally {
          downBmp?.recycle()
        }
      }

      // 3. 高反差与反相预处理扫描 (黑底白字或高噪插画背景)
      try {
        contrastBmp = createHighContrastBitmap(cropBmp)
        val cLines = recognizeSingleBitmap(recognizer, contrastBmp, 1.0f, 1.0f, confidenceWeight = 2.0f)
        detectedLines.addAll(cLines)
      } catch (e: Exception) {}

      try {
        invertBmp = createInvertedBitmap(cropBmp)
        val iLines = recognizeSingleBitmap(recognizer, invertBmp, 1.0f, 1.0f, confidenceWeight = 2.0f)
        detectedLines.addAll(iLines)
      } catch (e: Exception) {}

      // 4. 方法 4：色彩通道差分分离滤镜扫描 (针对红/黄/绿彩色艺术字)
      try {
        colorBmp = createColorContrastBitmap(cropBmp)
        if (colorBmp != null) {
          val colorLines = recognizeSingleBitmap(recognizer, colorBmp, 1.0f, 1.0f, confidenceWeight = 2.8f)
          detectedLines.addAll(colorLines)
        }
      } catch (e: Exception) {}

      // 5. 方法 4：空心描边字 (袋文字 / 白抜き) 实心化闭合扫描
      try {
        infilledBmp = createCropStrokeInfilledBitmap(cropBmp, radius = 2)
        if (infilledBmp != null) {
          val infilledLines = recognizeSingleBitmap(recognizer, infilledBmp, 1.0f, 1.0f, confidenceWeight = 2.6f)
          detectedLines.addAll(infilledLines)
        }
      } catch (e: Exception) {}

      // 6. 若上述常规扫描未出字，尝试微旋转扫描 (针对倾斜 15°~25° 的拟声词/艺术字)
      if (detectedLines.isEmpty()) {
        for (angle in listOf(-18f, 18f)) {
          var rotBmp: Bitmap? = null
          try {
            val matrix = Matrix().apply { postRotate(angle) }
            rotBmp = Bitmap.createBitmap(cropBmp, 0, 0, cropBmp.width, cropBmp.height, matrix, true)
            val rotLines = recognizeSingleBitmap(recognizer, rotBmp, 1.0f, 1.0f, confidenceWeight = 1.5f)
            if (rotLines.isNotEmpty()) {
              detectedLines.addAll(rotLines)
              break
            }
          } catch (e: Exception) {
          } finally {
            rotBmp?.recycle()
          }
        }
      }

      // 7. Manga-OCR 针对增强切片的多通道重试 (若首轮原切片为空，利用实心化/色彩通道重试激活 ViT 深度能力)
      if (detectedLines.isEmpty() && MangaOcrModel.isModelReady) {
        val retryCandidates = listOfNotNull(colorBmp, infilledBmp, contrastBmp, invertBmp)
        for (cand in retryCandidates) {
          val retryText = MangaOcrModel.recognize(cand)
          if (retryText.isNotBlank() && !isJunkNoiseLine(retryText, regionRect)) {
            val isVertical = regionRect.height() > regionRect.width() * 1.15f
            val disambiguated = disambiguateMangaCharacters(retryText)
            val langInfo = detectLanguage(disambiguated, preferredLang, screenHasJapanese)
            return mapOf(
              "sourceText" to disambiguated,
              "lines" to listOf(disambiguated),
              "direction" to if (isVertical) "vertical" else "horizontal",
              "detectedLang" to langInfo.langCode,
              "langName" to langInfo.langName,
              "langColor" to langInfo.badgeColor,
              "ocrEngine" to "manga_ocr_retry"
            )
          }
        }
      }

      if (detectedLines.isEmpty()) return null

      val deduplicated = deduplicateLines(detectedLines)
      if (deduplicated.isEmpty()) return null

      // 判断纵横排方向
      val verticalCount = deduplicated.count { it.isVertical || it.rect.height() > it.rect.width() * 1.15f }
      val isVertical = verticalCount * 2 >= deduplicated.size

      // 排序与列流转：竖排从右往左 (RTL: centerX 降序)，横排从上往下 (centerY 升序)
      val sortedLines = if (isVertical) {
        deduplicated.sortedByDescending { it.rect.centerX() }
      } else {
        deduplicated.sortedBy { it.rect.centerY() }
      }

      val linesText = sortedLines.map { it.text.trim() }.filter { it.isNotEmpty() && !isJunkNoiseLine(it, regionRect) }
      if (linesText.isEmpty()) return null

      val disambiguatedLines = linesText.map { disambiguateMangaCharacters(it) }
      val fullText = disambiguatedLines.joinToString(if (isVertical) "\n" else " ")

      val langInfo = detectLanguage(fullText, preferredLang, screenHasJapanese)
      val avgRawConf = deduplicated.mapNotNull { it.rawConfidence }.takeIf { it.isNotEmpty() }?.average()?.toFloat()
      val avgWeight = deduplicated.map { it.confidenceWeight }.average().toFloat()
      val weightConf = (0.70f + min(0.25f, (avgWeight / 6.0f) * 0.25f))
      val baseConf = avgRawConf ?: weightConf
      val roundedConf = Math.round(baseConf.coerceIn(0.35f, 0.98f) * 100) / 100.0f

      return mapOf(
        "sourceText" to fullText,
        "lines" to disambiguatedLines,
        "columnCount" to maxOf(1, disambiguatedLines.size),
        "direction" to if (isVertical) "vertical" else "horizontal",
        "detectedLang" to langInfo.langCode,
        "langName" to langInfo.langName,
        "langColor" to langInfo.badgeColor,
        "confidence" to roundedConf
      )
    } catch (e: Exception) {
      return null
    } finally {
      cropBmp?.recycle()
      colorBmp?.recycle()
      infilledBmp?.recycle()
      contrastBmp?.recycle()
      invertBmp?.recycle()
    }
  }

  /**
   * 将漫画专用深度学习检测器 (ComicTextDetector) 产出的目标框与全屏 OCR 结果深度融合
   * 1. 弥补全屏 ML Kit 漏检的拟声词 (SFX)、艺术字 (描き文字) 与异形气泡；
   * 2. 对每个未匹配上的专用检测框进行局部切片靶向增强 OCR，最大化文字产出率；
   * 3. 标记正确的 textType ('art_text', 'sfx', 'bubble')
   */
  private suspend fun fuseComicDetections(
    recognizer: TextRecognizer,
    sourceBitmap: Bitmap,
    baseBubbles: List<Map<String, Any>>,
    detections: List<ComicTextDetector.ComicDetection>,
    preferredLang: String = "auto"
  ): List<Map<String, Any>> {
    if (detections.isEmpty()) return baseBubbles

    val resultList = baseBubbles.toMutableList()
    var nextId = 1000

    val textDetections = detections.filter { it.category == 1 || it.category == 2 }

    for (det in textDetections) {
      val dRect = det.bounds

      var matchedExistingIndex = -1
      for (i in resultList.indices) {
        val bBox = resultList[i]["box"] as? Map<*, *> ?: continue
        val bx = (bBox["x"] as? Number)?.toInt() ?: 0
        val by = (bBox["y"] as? Number)?.toInt() ?: 0
        val bw = (bBox["width"] as? Number)?.toInt() ?: 0
        val bh = (bBox["height"] as? Number)?.toInt() ?: 0
        val existingRect = Rect(bx, by, bx + bw, by + bh)

        val iou = computeIoU(existingRect, dRect)
        val inter = computeIntersection(existingRect, dRect)
        val minArea = min(existingRect.width() * existingRect.height(), dRect.width() * dRect.height()).toFloat()
        val overlapRatio = if (minArea > 0f) inter / minArea else 0f

        if (iou > 0.25f || overlapRatio > 0.45f) {
          matchedExistingIndex = i
          break
        }
      }

      if (matchedExistingIndex >= 0) {
        val existing = resultList[matchedExistingIndex].toMutableMap()
        existing["detectorSource"] = "comic_model"

        val curLines = (existing["lines"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
        val curText = existing["sourceText"] as? String ?: ""
        val curConf = (existing["confidence"] as? Number)?.toFloat() ?: 0.85f
        val aspect = dRect.height().toFloat() / max(1, dRect.width())
        // 关键判定：若全屏初筛只识别出了 1 列，但该气泡物理框具备多列特征，或置信度偏低 (< 0.70)，或疑似残破文本：
        // 自动触发局部 2.0x 靶向切片精扫，在第一遍识别中就立刻拆分多列排版并提升文字精度！
        val isLikelyMultiCol = (curLines.size <= 1) && (dRect.width() >= 40 && dRect.height() >= 55 && aspect in 0.8f..3.8f)
        if (isLikelyMultiCol || curConf < 0.70f || curText.length <= 4 || curText.contains("?") || curText.contains("！") || curText.contains("…")) {
          val enhanced = enhanceCandidateRegion(
            recognizer = recognizer,
            sourceBitmap = sourceBitmap,
            regionRect = dRect,
            preferredLang = preferredLang,
            screenHasJapanese = true
          )
          val enhancedLines = (enhanced?.get("lines") as? List<*>)?.mapNotNull { it as? String }
          if (enhancedLines != null && enhancedLines.isNotEmpty()) {
            val enhancedText = enhanced["sourceText"] as? String ?: ""
            if (enhancedLines.size > curLines.size || (enhancedLines.size >= curLines.size && enhancedText.length >= curText.length)) {
              existing["sourceText"] = enhancedText
              existing["lines"] = enhancedLines
              existing["columnCount"] = enhancedLines.size
              existing["direction"] = enhanced["direction"] as? String ?: existing["direction"] ?: "vertical"
              existing["confidence"] = enhanced["confidence"] as? Float ?: 0.94f
            }
          } else if (MangaOcrModel.isModelReady && (curText.length <= 4 || curText.contains("?") || curText.contains("！"))) {
            // 端侧 Manga-OCR 模型兜底增强
            val pad = 8
            val cl = max(0, dRect.left - pad)
            val ct = max(0, dRect.top - pad)
            val cr = min(sourceBitmap.width, dRect.right + pad)
            val cb = min(sourceBitmap.height, dRect.bottom + pad)
            if (cr - cl >= 14 && cb - ct >= 14) {
              var cropBmp: Bitmap? = null
              try {
                cropBmp = Bitmap.createBitmap(sourceBitmap, cl, ct, cr - cl, cb - ct)
                val mangaText = MangaOcrModel.recognize(cropBmp)
                if (mangaText.isNotBlank() && mangaText.length >= curText.length && !isJunkNoiseLine(mangaText, dRect)) {
                  val disambiguated = disambiguateMangaCharacters(mangaText)
                  existing["sourceText"] = disambiguated
                  existing["lines"] = listOf(disambiguated)
                  existing["ocrEngine"] = "manga_ocr"
                  existing["confidence"] = 0.92f
                }
              } catch (e: Exception) {
              } finally {
                cropBmp?.recycle()
              }
            }
          }
        }

        val existingConf = (existing["confidence"] as? Number)?.toFloat() ?: 0.80f
        val fusedConf = Math.round((existingConf * 0.5f + det.score * 0.5f) * 100) / 100.0f
        existing["confidence"] = max(existingConf, fusedConf)

        if (det.category == 2) {
          val currentType = existing["textType"] as? String ?: "bubble"
          if (currentType == "bubble" || currentType == "free_text") {
            val aspect = dRect.width().toFloat() / max(1, dRect.height())
            val isSfx = (aspect > 1.4f || aspect < 0.6f) && (dRect.width() * dRect.height() < sourceBitmap.width * sourceBitmap.height * 0.08f)
            existing["textType"] = if (isSfx) "sfx" else "art_text"
          }
        }
        resultList[matchedExistingIndex] = existing
      } else {
        if (isClippedByScreenEdge(dRect, sourceBitmap.width, sourceBitmap.height)) {
          continue
        }

        val aspect = dRect.width().toFloat() / max(1, dRect.height())
        val isSfx = det.category == 2 && ((aspect > 1.4f || aspect < 0.6f) || (dRect.width() * dRect.height() < sourceBitmap.width * sourceBitmap.height * 0.06f))
        val textType = if (det.category == 2) (if (isSfx) "sfx" else "art_text") else "bubble"

        val targetEnhancement = enhanceCandidateRegion(
          recognizer = recognizer,
          sourceBitmap = sourceBitmap,
          regionRect = dRect,
          preferredLang = preferredLang,
          screenHasJapanese = true
        )

        val recognizedText = targetEnhancement?.get("sourceText") as? String ?: ""
        val hasValidOcr = recognizedText.isNotBlank() && !isJunkNoiseLine(recognizedText, dRect)

        // 方法 2 防丢弃机制：
        // 若局部 OCR 暂时未能提取出纯文本，但该框由模型高置信度检出为艺术字/拟声词 (category == 2 且 score >= 0.18f)：
        // 绝不直接粗暴丢弃！保留该检测框，在 HUD Box 模式中高亮展示，在翻译模式中打上艺术字占位，支持用户手动点选交互
        if (!hasValidOcr) {
          val minDim = min(dRect.width(), dRect.height())
          val maxDim = max(dRect.width(), dRect.height())
          val aspect = maxDim.toFloat() / max(1, minDim)
          if (minDim < 14 || aspect > 8.0f || det.score < 0.18f) {
            continue
          }
        }

        val langCode = if (hasValidOcr) (targetEnhancement?.get("detectedLang") as? String ?: "ja") else "ja"
        val langName = if (hasValidOcr) (targetEnhancement?.get("langName") as? String ?: (if (textType == "sfx") "拟声词" else "艺术字")) else (if (textType == "sfx") "拟声词" else "艺术字")
        val langColor = if (hasValidOcr) (targetEnhancement?.get("langColor") as? String ?: (if (textType == "sfx") "#10B981" else "#F59E0B")) else (if (textType == "sfx") "#10B981" else "#F59E0B")
        val displaySourceText = if (hasValidOcr) recognizedText else (if (textType == "sfx") "[拟声词]" else "[艺术字]")

        val detectedLinesList = (targetEnhancement?.get("lines") as? List<*>)?.mapNotNull { it as? String }
          ?: if (hasValidOcr) listOf(recognizedText) else emptyList()
        val detectedCols = (targetEnhancement?.get("columnCount") as? Number)?.toInt()
          ?: maxOf(1, detectedLinesList.size)

        val ocrConf = (targetEnhancement?.get("confidence") as? Number)?.toFloat()
          ?: (Math.round((det.score * 0.4f + 0.50f) * 100) / 100.0f)
        val finalConf = if (hasValidOcr) ocrConf else (Math.round(det.score * 100) / 100.0f)

        val newBubble = mutableMapOf<String, Any>(
          "id" to "comic_det_${nextId++}",
          "box" to mapOf(
            "x" to dRect.left,
            "y" to dRect.top,
            "width" to dRect.width(),
            "height" to dRect.height()
          ),
          "sourceText" to displaySourceText,
          "targetText" to "",
          "direction" to (targetEnhancement?.get("direction") as? String ?: if (dRect.height() > dRect.width() * 1.15f) "vertical" else "horizontal"),
          "columnCount" to if (hasValidOcr) detectedCols else 1,
          "lines" to detectedLinesList,
          "textType" to textType,
          "detectedLang" to langCode,
          "langName" to langName,
          "langColor" to langColor,
          "detectedBgColor" to "#18000000",
          "detectedTextColor" to "#FFFFFF",
          "fontSize" to max(12, (dRect.height() * 0.65f).toInt()),
          "detectorSource" to "comic_model",
          "confidence" to finalConf
        )

        resultList.add(newBubble)
      }
    }

    android.util.Log.i(
      "MangaOcr",
      "▶ [文本检出统计] MLKit通用检出: ${baseBubbles.size}个, 漫画专用模型检出: ${detections.size}个 (文字=${detections.count { it.category == 1 }}, 艺术字/拟声词=${detections.count { it.category == 2 }}), 融合最终呈现: ${resultList.size}个"
    )

    return resultList
  }

  /**
   * 单个尺度 Bitmap 的文字识别，并将边界框安全映射回原图坐标空间
   */
  private suspend fun recognizeSingleBitmap(
    recognizer: TextRecognizer,
    bitmap: Bitmap,
    scaleX: Float,
    scaleY: Float,
    confidenceWeight: Float = 1.0f
  ): List<TextLineItem> = suspendCancellableCoroutine { continuation ->
    val inputImage = InputImage.fromBitmap(bitmap, 0)

    recognizer.process(inputImage)
      .addOnSuccessListener { visionText ->
        val lines = mutableListOf<TextLineItem>()
        for (block in visionText.textBlocks) {
          if (block.lines.isEmpty()) {
            val blockBox = block.boundingBox ?: continue
            val blockText = block.text.trim()
            if (blockText.isNotEmpty()) {
              val mappedRect = mapRect(blockBox, scaleX, scaleY)
              val isVertical = mappedRect.height() > mappedRect.width() * 1.2f
              val charCount = max(1, blockText.replace(" ", "").length)
              val charSize = if (isVertical) mappedRect.height().toFloat() / charCount else mappedRect.height().toFloat()
              val rawConf = try {
                block.lines.mapNotNull { it.confidence }.takeIf { it.isNotEmpty() }?.average()?.toFloat()
              } catch (e: Exception) { null }
              lines.add(TextLineItem(blockText, mappedRect, isVertical, charSize, confidenceWeight, rawConf))
            }
            continue
          }

          for (line in block.lines) {
            val box = line.boundingBox ?: block.boundingBox ?: continue
            val text = line.text.trim()
            if (text.isEmpty()) continue

            val rawConf = try {
              line.confidence ?: line.elements.mapNotNull { it.confidence }.takeIf { it.isNotEmpty() }?.average()?.toFloat()
            } catch (e: Exception) { null }

            val mappedRect = mapRect(box, scaleX, scaleY)
            val isVertical = mappedRect.height() > mappedRect.width() * 1.2f
            val charCount = max(1, text.replace(" ", "").length)
            val charSize = if (isVertical) mappedRect.height().toFloat() / charCount else mappedRect.height().toFloat()
            lines.add(TextLineItem(text, mappedRect, isVertical, charSize, confidenceWeight, rawConf))
          }
        }
        continuation.resume(lines)
      }
      .addOnFailureListener {
        continuation.resume(emptyList())
      }
  }

  /**
   * 将缩放尺度的 Rect 映射回原图坐标系
   */
  private fun mapRect(rect: Rect, scaleX: Float, scaleY: Float): Rect {
    if (scaleX == 1.0f && scaleY == 1.0f) return rect
    return Rect(
      (rect.left / scaleX).toInt(),
      (rect.top / scaleY).toInt(),
      (rect.right / scaleX).toInt(),
      (rect.bottom / scaleY).toInt()
    )
  }

  /**
   * 创建反相灰度位图 (Invert Preprocessing)
   * 将黑底白字反相为白底黑字，让 ML Kit 能完美识别反白标语与黑底独白
   */
  private fun createInvertedBitmap(src: Bitmap): Bitmap {
    val dest = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(dest)
    val paint = Paint()
    val cm = ColorMatrix(floatArrayOf(
      -1f, 0f, 0f, 0f, 255f,
      0f, -1f, 0f, 0f, 255f,
      0f, 0f, -1f, 0f, 255f,
      0f, 0f, 0f, 1f, 0f
    ))
    paint.colorFilter = ColorMatrixColorFilter(cm)
    canvas.drawBitmap(src, 0f, 0f, paint)
    return dest
  }

  /**
   * 创建高对比度灰度位图，增强弱对比度描边和彩色背景下的文字线条
   */
  private fun createHighContrastBitmap(src: Bitmap): Bitmap {
    val dest = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(dest)
    val paint = Paint()
    val cm = ColorMatrix().apply {
      setSaturation(0f)
      val contrast = 1.55f
      val translate = (-0.5f * contrast + 0.5f) * 255f
      val matrix = floatArrayOf(
        contrast, 0f, 0f, 0f, translate,
        0f, contrast, 0f, 0f, translate,
        0f, 0f, contrast, 0f, translate,
        0f, 0f, 0f, 1f, 0f
      )
      postConcat(ColorMatrix(matrix))
    }
    paint.colorFilter = ColorMatrixColorFilter(cm)
    canvas.drawBitmap(src, 0f, 0f, paint)
    return dest
  }

  /**
   * 高频笔画锐化与边缘分离滤镜 (Stroke-Sharpening & Separation Filter)
   * 专门针对 12~20 画的高密度复杂汉字 (如「凛」「鬱」「魔」「警」「麗」等)：
   * 消除手机截图中子像素抗锯齿与双线性缩放导致的笔画粘连 (Stroke Bridging)，
   * 增强 1px 细微笔画间隙的对比度，让 ML Kit 能清晰辨识内部复杂部首与偏旁！
   */
  private fun createStrokeSharpenedBitmap(src: Bitmap): Bitmap {
    val dest = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(dest)
    val paint = Paint()

    // 组合高反差 S-Curve 动态提纯：提升黑白反差到 1.85x，将模糊灰阶笔画边缘直接二值化切开，保留纯净留白
    val cm = ColorMatrix().apply {
      setSaturation(0f)
      val contrast = 1.85f
      val translate = (-0.5f * contrast + 0.5f) * 255f
      val matrix = floatArrayOf(
        contrast, 0f, 0f, 0f, translate,
        0f, contrast, 0f, 0f, translate,
        0f, 0f, contrast, 0f, translate,
        0f, 0f, 0f, 1f, 0f
      )
      postConcat(ColorMatrix(matrix))
    }
    paint.colorFilter = ColorMatrixColorFilter(cm)
    canvas.drawBitmap(src, 0f, 0f, paint)
    return dest
  }

  /**
   * Sauvola 局部自适应二值化 (替代全局 Otsu)
   * 对每个像素 (x,y) 计算局部窗口内的灰度均值 μ 和标准差 σ，
   * 阈值 T(x,y) = μ(x,y) * (1 + k * (σ(x,y) / R - 1))
   * k=0.20, R=128 (灰度最大值的一半)
   *
   * 优势：完美适应光照不均、插画背景渐变与气泡局部阴影，
   * 不像全局 Otsu 那样在半亮像素上随机二值化笔画间距，
   * 能清晰分离复杂汉字（凛/鬱/警等）的 1~2px 笔画间隙。
   *
   * 性能优化：使用二维积分图（Summed Area Table）将每个像素的局部窗口统计量
   * 从 O(w²) 降低到 O(1)，整图处理时间与 Otsu 相当。
   */
  private fun createSauvolaBinarizedBitmap(src: Bitmap, windowRadius: Int = 16, k: Float = 0.20f): Bitmap {
    val width = src.width
    val height = src.height
    val R = 128f  // 灰度范围的一半，Sauvola 公式标准参数

    val pixels = IntArray(width * height)
    src.getPixels(pixels, 0, width, 0, 0, width, height)

    // 1. 灰度化
    val grays = IntArray(pixels.size)
    for (i in pixels.indices) {
      val c = pixels[i]
      val r = (c shr 16) and 0xFF
      val g = (c shr 8) and 0xFF
      val b = c and 0xFF
      grays[i] = ((299 * r + 587 * g + 114 * b) / 1000).coerceIn(0, 255)
    }

    // 2. 构建二维积分图：sum[y+1][x+1] = ∑gray(0..y, 0..x)
    //    使用 Long 防止溢出（最大值 = 255 * 2160 * 3840 ≈ 21亿，超过 Int 上限）
    val sumTable = LongArray((width + 1) * (height + 1)) { 0L }
    val sumSqTable = LongArray((width + 1) * (height + 1)) { 0L }

    val stride = width + 1
    for (y in 0 until height) {
      for (x in 0 until width) {
        val g = grays[y * width + x].toLong()
        val idx = (y + 1) * stride + (x + 1)
        sumTable[idx] = g +
          sumTable[y * stride + (x + 1)] +
          sumTable[(y + 1) * stride + x] -
          sumTable[y * stride + x]
        sumSqTable[idx] = g * g +
          sumSqTable[y * stride + (x + 1)] +
          sumSqTable[(y + 1) * stride + x] -
          sumSqTable[y * stride + x]
      }
    }

    // 3. 对每个像素用积分图 O(1) 计算局部窗口内的均值和标准差，得到自适应阈值
    val binPixels = IntArray(pixels.size)
    for (y in 0 until height) {
      for (x in 0 until width) {
        val x1 = max(0, x - windowRadius)
        val y1 = max(0, y - windowRadius)
        val x2 = min(width - 1, x + windowRadius)
        val y2 = min(height - 1, y + windowRadius)
        val count = ((x2 - x1 + 1) * (y2 - y1 + 1)).toLong()

        // 用积分图快速求窗口内的灰度总和与平方总和
        val s  = sumTable[(y2 + 1) * stride + (x2 + 1)] -
                 sumTable[y1 * stride + (x2 + 1)] -
                 sumTable[(y2 + 1) * stride + x1] +
                 sumTable[y1 * stride + x1]
        val sq = sumSqTable[(y2 + 1) * stride + (x2 + 1)] -
                 sumSqTable[y1 * stride + (x2 + 1)] -
                 sumSqTable[(y2 + 1) * stride + x1] +
                 sumSqTable[y1 * stride + x1]

        val mean = s.toFloat() / count
        val variance = (sq.toFloat() / count) - mean * mean
        val stdDev = if (variance > 0f) sqrt(variance) else 0f

        // Sauvola 自适应阈值公式
        val threshold = mean * (1f + k * (stdDev / R - 1f))
        val g = grays[y * width + x]
        binPixels[y * width + x] = if (g < threshold) Color.BLACK else Color.WHITE
      }
    }

    val dest = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    dest.setPixels(binPixels, 0, width, 0, 0, width, height)
    return dest
  }

  /**
   * Unsharp Mask 锐化滤镜（高频笔画边缘增强）
   * 原理：sharpenedPixel = original + amount * (original - blurred)
   * 对放大后图片应用，专门增强复杂汉字笔画之间的 1~2px 边缘，
   * 比线性对比拉伸更精准：只增强高频边缘，不影响低频背景区域。
   *
   * 使用 Box Blur 近似高斯模糊（速度是高斯的 3~4 倍），对 OCR 预处理足够精确。
   */
  private fun createUnsharpMaskedBitmap(src: Bitmap, radius: Int = 2, amount: Float = 1.2f): Bitmap {
    val width = src.width
    val height = src.height
    val pixels = IntArray(width * height)
    src.getPixels(pixels, 0, width, 0, 0, width, height)

    // 先去色转灰度（避免彩色信息干扰笔画边缘检测）
    val grays = IntArray(pixels.size)
    for (i in pixels.indices) {
      val c = pixels[i]
      val r = (c shr 16) and 0xFF
      val g = (c shr 8) and 0xFF
      val b = c and 0xFF
      grays[i] = ((299 * r + 587 * g + 114 * b) / 1000).coerceIn(0, 255)
    }

    // Box Blur（水平方向）
    val blurH = IntArray(width * height)
    for (y in 0 until height) {
      var windowSum = 0L
      // 初始化第一个窗口
      for (kx in 0..radius) {
        windowSum += grays[y * width + min(kx, width - 1)]
      }
      for (x in 0 until width) {
        blurH[y * width + x] = (windowSum / (radius * 2 + 1)).toInt()
        val removeX = x - radius
        val addX = x + radius + 1
        if (removeX >= 0) windowSum -= grays[y * width + removeX]
        if (addX < width) windowSum += grays[y * width + addX]
      }
    }

    // Box Blur（垂直方向）
    val blurred = IntArray(width * height)
    for (x in 0 until width) {
      var windowSum = 0L
      for (ky in 0..radius) {
        windowSum += blurH[min(ky, height - 1) * width + x]
      }
      for (y in 0 until height) {
        blurred[y * width + x] = (windowSum / (radius * 2 + 1)).toInt()
        val removeY = y - radius
        val addY = y + radius + 1
        if (removeY >= 0) windowSum -= blurH[removeY * width + x]
        if (addY < height) windowSum += blurH[addY * width + x]
      }
    }

    // Unsharp Mask：sharpen = original + amount * (original - blurred)，夹紧到 [0, 255]
    val resultPixels = IntArray(pixels.size)
    for (i in pixels.indices) {
      val orig = grays[i]
      val blur = blurred[i]
      val sharpened = (orig + amount * (orig - blur)).toInt().coerceIn(0, 255)
      resultPixels[i] = Color.rgb(sharpened, sharpened, sharpened)
    }

    val dest = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    dest.setPixels(resultPixels, 0, width, 0, 0, width, height)
    return dest
  }

  /**
   * 方法 4 核心：彩色艺术字与拟声词 (SFX) 色彩通道差分分离滤镜 (Color-Aware Channel Separation)
   * 针对日漫中的红/黄/绿/蓝彩色艺术字、标题或音效：提取像素色彩饱和度 (Chroma) 与深色描边，
   * 消除彩色背景与彩色笔画在普通灰度化下明度相近而消失的问题，产出黑白高对比二值图像。
   */
  private fun createColorContrastBitmap(src: Bitmap): Bitmap? {
    if (src.width < 10 || src.height < 10) return null
    return try {
      val w = src.width
      val h = src.height
      val total = w * h
      val pixels = IntArray(total)
      src.getPixels(pixels, 0, w, 0, 0, w, h)

      var maxChroma = 0
      var sumChroma = 0L
      val chroma = IntArray(total)
      val lum = IntArray(total)

      for (i in 0 until total) {
        val c = pixels[i]
        val r = (c shr 16) and 0xFF
        val g = (c shr 8) and 0xFF
        val b = c and 0xFF

        val maxVal = max(r, max(g, b))
        val minVal = min(r, min(g, b))
        val ch = maxVal - minVal
        chroma[i] = ch
        sumChroma += ch
        if (ch > maxChroma) maxChroma = ch

        lum[i] = (299 * r + 587 * g + 114 * b) / 1000
      }

      val avgChroma = (sumChroma / total).toInt()
      // 若该区域几乎全为纯黑白/灰度画面 (最大彩度小于 24)，无需色彩通道分离
      if (maxChroma < 24) return null

      // 彩度阈值：自适应区分有色笔画与中性背景
      val chromaThreshold = max(22, avgChroma + 10)

      // 提取笔画掩膜：1) 像素本身彩度显著高 (彩色字主体) 或 2) 像素为深色描边/阴影 (lum < 70)
      val strokeMask = BooleanArray(total) { idx ->
        chroma[idx] >= chromaThreshold || lum[idx] < 70
      }

      // 形态学闭运算：融合笔画内部由于色彩渐变或网点产生的孔洞
      val closed = applyMorphologicalClose(strokeMask, w, h, radius = 2)

      val outPixels = IntArray(total)
      for (i in 0 until total) {
        outPixels[i] = if (closed[i]) Color.BLACK else Color.WHITE
      }

      val destBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      destBmp.setPixels(outPixels, 0, w, 0, 0, w, h)
      destBmp
    } catch (e: Exception) {
      null
    }
  }

  /**
   * 方法 4 核心：局部切片双重描边/空心字 (袋文字 / 白抜き) 实心化闭合滤镜 (Stroke Infilled Filter)
   * 自动探测深浅边界，对中空笔画进行形态学闭合熔融，将空心双线转化为单粗笔画，极大激活 OCR 感受野
   */
  private fun createCropStrokeInfilledBitmap(src: Bitmap, radius: Int = 2): Bitmap? {
    if (src.width < 10 || src.height < 10) return null
    return try {
      val w = src.width
      val h = src.height
      val total = w * h
      val pixels = IntArray(total)
      src.getPixels(pixels, 0, w, 0, 0, w, h)

      val lum = IntArray(total)
      var sumLum = 0L
      for (i in 0 until total) {
        val c = pixels[i]
        val l = ((c shr 16 and 0xFF) * 299 + (c shr 8 and 0xFF) * 587 + (c and 0xFF) * 114) / 1000
        lum[i] = l
        sumLum += l
      }
      val avgLum = (sumLum / total).toInt()
      // 判断主体是深色描边还是浅色描边
      val isDarkBorder = avgLum > 115
      val threshold = if (isDarkBorder) max(75, min(150, avgLum - 18)) else min(180, avgLum + 22)

      val strokeMask = BooleanArray(total) {
        if (isDarkBorder) lum[it] < threshold else lum[it] > threshold
      }

      val infilledMask = applyMorphologicalClose(strokeMask, w, h, radius = radius)

      val outPixels = IntArray(total)
      for (i in 0 until total) {
        outPixels[i] = if (infilledMask[i]) Color.BLACK else Color.WHITE
      }

      val destBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      destBmp.setPixels(outPixels, 0, w, 0, 0, w, h)
      destBmp
    } catch (e: Exception) {
      null
    }
  }

  /**
   * 形态学闭运算 (Dilation followed by Erosion)：闭合空心笔画、连接断裂笔划
   */
  private fun applyMorphologicalClose(mask: BooleanArray, w: Int, h: Int, radius: Int = 2): BooleanArray {
    val dilated = BooleanArray(mask.size)
    for (y in 0 until h) {
      val row = y * w
      for (x in 0 until w) {
        if (!mask[row + x]) continue
        val yMin = max(0, y - radius)
        val yMax = min(h - 1, y + radius)
        val xMin = max(0, x - radius)
        val xMax = min(w - 1, x + radius)
        for (ny in yMin..yMax) {
          val nrow = ny * w
          for (nx in xMin..xMax) {
            dilated[nrow + nx] = true
          }
        }
      }
    }

    val closed = BooleanArray(mask.size)
    for (y in 0 until h) {
      val row = y * w
      for (x in 0 until w) {
        if (!dilated[row + x]) continue
        var allTrue = true
        val yMin = max(0, y - radius)
        val yMax = min(h - 1, y + radius)
        val xMin = max(0, x - radius)
        val xMax = min(w - 1, x + radius)
        for (ny in yMin..yMax) {
          val nrow = ny * w
          for (nx in xMin..xMax) {
            if (!dilated[nrow + nx]) {
              allTrue = false
              break
            }
          }
          if (!allTrue) break
        }
        if (allTrue) {
          closed[row + x] = true
        }
      }
    }

    return closed
  }

  /**
   * 跨尺度去重与融合：保留更精准或包含更多字符的检测结果，绝不误吞并同气泡内不同行/列文字
   */
  private fun deduplicateLines(lines: List<TextLineItem>): List<TextLineItem> {
    val result = mutableListOf<TextLineItem>()
    for (line in lines) {
      var merged = false
      for (i in result.indices) {
        val existing = result[i]
        val iou = computeIoU(line.rect, existing.rect)
        val inter = computeIntersection(line.rect, existing.rect)
        val minArea = min(line.rect.width() * line.rect.height(), existing.rect.width() * existing.rect.height()).toFloat()
        val overlapRatio = if (minArea > 0f) inter / minArea else 0f

        val isSameOrContained = line.text.contains(existing.text) || existing.text.contains(line.text)

        // 仅在确认属于同一个文字实例在不同尺度/通道下的重复检出时才融合：
        // 1) 文本相互包含 (如「あれ？鮮血…？」包含「鮮血…？」)，且物理区域有明显交叠 (iou > 0.30 或 overlapRatio > 0.45)
        // 2) 物理边界极其重叠 (iou > 0.60)，说明是同一坐标下的不同通道识别结果
        if ((isSameOrContained && (iou > 0.30f || overlapRatio > 0.45f)) || iou > 0.60f) {
          val unionRect = Rect(
            min(line.rect.left, existing.rect.left),
            min(line.rect.top, existing.rect.top),
            max(line.rect.right, existing.rect.right),
            max(line.rect.bottom, existing.rect.bottom)
          )
          val preferredLine = when {
            line.text.contains(existing.text) -> line
            existing.text.contains(line.text) -> existing
            line.text.length > existing.text.length -> line
            existing.text.length > line.text.length -> existing
            // 核心修复：相同长度候选词时，优先采纳高分辨率锐化通道 (Pass 2, Weight=3.2f) 的高保真识别结果！
            line.confidenceWeight > existing.confidenceWeight -> line
            else -> existing
          }
          val accumulatedWeight = existing.confidenceWeight + line.confidenceWeight
          val maxRawConf = listOfNotNull(existing.rawConfidence, line.rawConfidence).maxOrNull()
          result[i] = preferredLine.copy(rect = unionRect, confidenceWeight = accumulatedWeight, rawConfidence = maxRawConf)
          merged = true
          break
        }
      }
      if (!merged) {
        result.add(line)
      }
    }
    return result
  }

  private fun computeIntersection(a: Rect, b: Rect): Float {
    val left = max(a.left, b.left)
    val top = max(a.top, b.top)
    val right = min(a.right, b.right)
    val bottom = min(a.bottom, b.bottom)
    if (right <= left || bottom <= top) return 0f
    return (right - left) * (bottom - top).toFloat()
  }

  private fun computeIoU(a: Rect, b: Rect): Float {
    val inter = computeIntersection(a, b)
    if (inter <= 0f) return 0f
    val areaA = a.width() * a.height().toFloat()
    val areaB = b.width() * b.height().toFloat()
    val union = areaA + areaB - inter
    return if (union > 0f) inter / union else 0f
  }

  /**
   * 将去重后的全量 TextLines 聚类为独立对话气泡与文本块
   */
  /**
   * 判定文本块是否紧贴或跨越屏幕物理上下边缘（残缺出界文本）
   * 用户明确要求：上下边缘文字被物理截断、上下文残缺、识别与翻译效果极差，坚决彻底过滤掉！
   */
  private fun isClippedByScreenEdge(r: Rect, w: Int, h: Int): Boolean {
    if (r.top <= 10) return true // 顶部贴边被切断
    if (r.bottom >= h - 12) return true // 底部贴边被切断
    return false
  }

  private fun clusterAndFormatBubbles(
    rawLines: List<TextLineItem>,
    bitmap: Bitmap,
    preferredLang: String = "auto"
  ): List<Map<String, Any>> {
    if (rawLines.isEmpty()) {
      return emptyList()
    }

    // 1. 严格预过滤紧贴屏幕上下物理极边缘的文字行（上下边缘文字被截断导致上下文残缺、翻译破损）
    val validLines = rawLines.filter { line ->
      line.rect.top > 8 && line.rect.bottom < bitmap.height - 10 &&
        !isJunkNoiseLine(line.text, line.rect)
    }
    if (validLines.isEmpty()) {
      return emptyList()
    }

    // 全局首轮感知：检测当前屏幕有效区域的所有文本行中，是否已经出现了任何日文假名或日文特征
    val screenHasJapanese = (preferredLang.lowercase() in listOf("ja", "japanese")) ||
      validLines.any { hasJapaneseSpecificFeatures(it.text) }

    // 并查集聚合属于同一气泡或段落的文字行 (紧凑文本包络，基于字距、排版与物理黑边阻断)
    val clusters = clusterLines(validLines, bitmap)

    val resultList = mutableListOf<Map<String, Any>>()
    var indexCounter = 1

    for (cluster in clusters) {
      if (cluster.isEmpty()) continue

      var minX = Int.MAX_VALUE
      var minY = Int.MAX_VALUE
      var maxX = Int.MIN_VALUE
      var maxY = Int.MIN_VALUE

      var isPredominantlyVertical = 0
      var totalCharSize = 0f

      for (item in cluster) {
        minX = min(minX, item.rect.left)
        minY = min(minY, item.rect.top)
        maxX = max(maxX, item.rect.right)
        maxY = max(maxY, item.rect.bottom)
        totalCharSize += item.charSize
        if (item.isVertical) isPredominantlyVertical++
      }

      val isVertical = isPredominantlyVertical >= (cluster.size / 2.0)
      val avgCharSize = totalCharSize / cluster.size

      // 文本拼接逻辑：
      // 竖排：按物理 X 坐标聚类归纳真实的日漫竖列 (RTL: 从右往左)
      // 横排：按物理 Y 坐标归纳横排文本行
      val finalColumns: List<String> = if (isVertical) {
        val colGroups = mutableListOf<MutableList<TextLineItem>>()
        val sortedByX = cluster.sortedByDescending { it.rect.centerX() }
        for (item in sortedByX) {
          var matchedGroup: MutableList<TextLineItem>? = null
          for (group in colGroups) {
            val representative = group[0]
            val threshold = max(14f, min(item.rect.width(), representative.rect.width()) * 0.75f)
            if (abs(item.rect.centerX() - representative.rect.centerX()) < threshold) {
              matchedGroup = group
              break
            }
          }
          if (matchedGroup != null) {
            matchedGroup.add(item)
          } else {
            colGroups.add(mutableListOf(item))
          }
        }
        colGroups.map { group ->
          group.sortedBy { it.rect.top }.joinToString("") { it.text.trim() }
        }.filter { it.isNotBlank() }
      } else {
        val rowGroups = mutableListOf<MutableList<TextLineItem>>()
        val sortedByY = cluster.sortedBy { it.rect.centerY() }
        for (item in sortedByY) {
          var matchedGroup: MutableList<TextLineItem>? = null
          for (group in rowGroups) {
            val representative = group[0]
            val threshold = max(12f, min(item.rect.height(), representative.rect.height()) * 0.75f)
            if (abs(item.rect.centerY() - representative.rect.centerY()) < threshold) {
              matchedGroup = group
              break
            }
          }
          if (matchedGroup != null) {
            matchedGroup.add(item)
          } else {
            rowGroups.add(mutableListOf(item))
          }
        }
        rowGroups.map { group ->
          group.sortedBy { it.rect.left }.joinToString(" ") { it.text.trim() }
        }.filter { it.isNotBlank() }
      }

      // 1. 日漫多笔画形近字消歧与高频人名/词汇纠错 (如 漂子/慄子/廪子/稟子/癛子/澟子 -> 凛子)
      val disambiguatedColumns = finalColumns.map { disambiguateMangaCharacters(it) }
      val disambiguatedFullText = if (isVertical) disambiguatedColumns.joinToString("\n") else disambiguatedColumns.joinToString(" ")

      // 适度留白与外扩（不宜过大，防止侵入邻近气泡）
      val paddingX = min(8, max(4, ((maxX - minX) * 0.04).toInt()))
      val paddingY = min(8, max(3, ((maxY - minY) * 0.04).toInt()))
      val finalLeft = max(0, minX - paddingX)
      val finalTop = max(0, minY - paddingY)
      val finalWidth = min(bitmap.width - finalLeft, (maxX - minX) + paddingX * 2)
      val finalHeight = min(bitmap.height - finalTop, (maxY - minY) + paddingY * 2)

      val blockRect = Rect(finalLeft, finalTop, finalLeft + finalWidth, finalTop + finalHeight)

      // 严格检查聚类后的完整文本块是否被屏幕物理边界截断：
      if (isClippedByScreenEdge(blockRect, bitmap.width, bitmap.height)) {
        // 边缘残缺文本：部分文字在屏幕外，上下文不全，坚决省略
        continue
      }

      // 核心去伪：如果文本块仅包含纯标点/微型噪点 (如乳头、皮肤斑点、发丝杂点误识别的单字符)，彻底丢弃！
      if (isJunkNoiseLine(disambiguatedFullText, blockRect)) {
        continue
      }

      // 2. 跨帧/滑动连续识别稳定阻尼处理 (保持连续滑动点击识别时不发生字符随机跳变)
      val stabilizedText = stabilizeBubbleText(blockRect, disambiguatedFullText)
      val finalSourceText = stabilizedText
      val finalColumnsProcessed = if (isVertical) {
        val split = stabilizedText.split("\n")
        if (split.size == disambiguatedColumns.size) split else disambiguatedColumns
      } else {
        disambiguatedColumns
      }

      // 采样背景底色与文字颜色
      val colorAnalysis = sampleColorsAndUniformity(bitmap, blockRect)

      // 智能判定文本类型：气泡(bubble)、标题(title)、旁白嵌字(free_text)、拟声词(sfx)
      val textType = classifyTextType(
        text = finalSourceText,
        box = blockRect,
        bitmap = bitmap,
        avgCharSize = avgCharSize,
        luminance = colorAnalysis.luminance,
        isUniform = colorAnalysis.isUniform
      )

      // 自动精确判别语种 (结合用户指定的语言偏好与全局日文环境)
      val langInfo = detectLanguage(
        text = finalSourceText,
        preferredLang = preferredLang,
        contextHasJapanese = screenHasJapanese
      )

      // 综合置信度计算：结合 ML Kit 原生概率、多通道累计命中权重、文本长度与字符纯净度
      val avgRawConf = cluster.mapNotNull { it.rawConfidence }.takeIf { it.isNotEmpty() }?.average()?.toFloat()
      val avgWeight = cluster.map { it.confidenceWeight }.average().toFloat()
      val weightConf = (0.60f + min(0.35f, (avgWeight / 6.0f) * 0.35f))
      val baseConf = avgRawConf ?: weightConf
      val lengthBonus = when {
        finalSourceText.length >= 6 -> 0.05f
        finalSourceText.length <= 2 -> -0.12f
        else -> 0.0f
      }
      val finalConfidence = (baseConf + lengthBonus).coerceIn(0.20f, 0.99f)
      val roundedConfidence = (Math.round(finalConfidence * 100) / 100.0f)

      val bubbleEntry = mutableMapOf<String, Any>(
        "id" to "b_${indexCounter++}",
        "box" to mapOf(
          "x" to blockRect.left,
          "y" to blockRect.top,
          "width" to blockRect.width(),
          "height" to blockRect.height()
        ),
        "sourceText" to finalSourceText,
        "targetText" to "",
        "direction" to if (isVertical) "vertical" else "horizontal",
        "columnCount" to if (isVertical) finalColumnsProcessed.size else 1,
        "lines" to finalColumnsProcessed,
        "textType" to textType,
        "detectedLang" to langInfo.langCode,
        "langName" to langInfo.langName,
        "langColor" to langInfo.badgeColor,
        "detectedBgColor" to colorAnalysis.bgColorHex,
        "detectedTextColor" to colorAnalysis.textColorHex,
        "fontSize" to avgCharSize.toInt(),
        "confidence" to roundedConfidence
      )

      resultList.add(bubbleEntry)
    }

    // 气泡级 NMS 与高重叠包含融合 (Bubble-Level Deduplication / NMS)
    // 彻底杜绝两个坐标几乎相同的重复气泡/小标 (如 2 和 27)
    return deduplicateBubbleMaps(resultList, preferredLang, screenHasJapanese)
  }

  /**
   * 气泡级 NMS 与包含合并
   */
  private fun deduplicateBubbleMaps(
    bubbles: List<Map<String, Any>>,
    preferredLang: String = "auto",
    contextHasJapanese: Boolean = false
  ): List<Map<String, Any>> {
    val result = mutableListOf<MutableMap<String, Any>>()

    for (b in bubbles) {
      val boxMap = b["box"] as? Map<*, *> ?: continue
      val x = (boxMap["x"] as? Number)?.toInt() ?: 0
      val y = (boxMap["y"] as? Number)?.toInt() ?: 0
      val w = (boxMap["width"] as? Number)?.toInt() ?: 0
      val h = (boxMap["height"] as? Number)?.toInt() ?: 0
      val rect = Rect(x, y, x + w, y + h)
      val text = b["sourceText"] as? String ?: ""
      if (text.isBlank() || isJunkNoiseLine(text, rect)) {
        continue
      }
      val textType = b["textType"] as? String ?: "bubble"

      var merged = false
      for (i in result.indices) {
        val existing = result[i]
        val eBox = existing["box"] as? Map<*, *> ?: continue
        val ex = (eBox["x"] as? Number)?.toInt() ?: 0
        val ey = (eBox["y"] as? Number)?.toInt() ?: 0
        val ew = (eBox["width"] as? Number)?.toInt() ?: 0
        val eh = (eBox["height"] as? Number)?.toInt() ?: 0
        val eRect = Rect(ex, ey, ex + ew, ey + eh)
        val eText = existing["sourceText"] as? String ?: ""
        val eType = existing["textType"] as? String ?: "bubble"

        val iou = computeIoU(rect, eRect)
        val inter = computeIntersection(rect, eRect)
        val minArea = min(rect.width() * rect.height(), eRect.width() * eRect.height()).toFloat()
        val overlapRatio = if (minArea > 0f) inter / minArea else 0f
        val isSameOrContained = text.contains(eText) || eText.contains(text)
        val isExactDuplicateBox = iou > 0.60f

        // 仅在确认是完全相同气泡的重复识别或包含关系时才融合，绝不误吞邻近的独立小气泡 (如「…ん？」「初めてで」「悪い？」)
        if ((isSameOrContained && (iou > 0.30f || overlapRatio > 0.45f)) || isExactDuplicateBox) {
          val unionRect = Rect(
            min(rect.left, eRect.left),
            min(rect.top, eRect.top),
            max(rect.right, eRect.right),
            max(rect.bottom, eRect.bottom)
          )

          val mergedText = when {
            text.contains(eText) -> text
            eText.contains(text) -> eText
            text.length > eText.length -> text
            else -> eText
          }

          val mergedType = if (textType != "bubble" && eType == "bubble") textType else eType

          existing["box"] = mapOf(
            "x" to unionRect.left,
            "y" to unionRect.top,
            "width" to unionRect.width(),
            "height" to unionRect.height()
          )
          existing["sourceText"] = mergedText
          existing["textType"] = mergedType
          val mergedLang = detectLanguage(mergedText, preferredLang, contextHasJapanese)
          existing["detectedLang"] = mergedLang.langCode
          existing["langName"] = mergedLang.langName
          existing["langColor"] = mergedLang.badgeColor
          val col1 = (existing["columnCount"] as? Number)?.toInt() ?: 1
          val col2 = (b["columnCount"] as? Number)?.toInt() ?: 1
          val winnerLines = if (mergedText == text) (b["lines"] as? List<*>) else (existing["lines"] as? List<*>)
          if (winnerLines != null) {
            existing["lines"] = winnerLines
            existing["columnCount"] = winnerLines.size
          } else {
            existing["columnCount"] = max(col1, col2)
          }
          val conf1 = (existing["confidence"] as? Number)?.toFloat() ?: 0.85f
          val conf2 = (b["confidence"] as? Number)?.toFloat() ?: 0.85f
          existing["confidence"] = max(conf1, conf2)
          merged = true
          break
        }
      }

      if (!merged) {
        result.add(b.toMutableMap())
      }
    }

    return result.mapIndexed { index, map ->
      map["id"] = "b_${index + 1}"
      map
    }
  }

  /**
   * 基于几何距离、字体比例及物理黑边阻断的紧凑文本行聚类
   */
  private fun clusterLines(
    lines: List<TextLineItem>,
    bitmap: Bitmap
  ): List<List<TextLineItem>> {
    val parent = IntArray(lines.size) { it }

    fun find(i: Int): Int {
      var root = i
      while (root != parent[root]) {
        root = parent[root]
      }
      var curr = i
      while (curr != root) {
        val nxt = parent[curr]
        parent[curr] = root
        curr = nxt
      }
      return root
    }

    fun union(i: Int, j: Int) {
      val rootI = find(i)
      val rootJ = find(j)
      if (rootI != rootJ) {
        parent[rootI] = rootJ
      }
    }

    for (i in lines.indices) {
      for (j in i + 1 until lines.size) {
        if (shouldMergeLines(lines[i], lines[j], bitmap)) {
          union(i, j)
        }
      }
    }

    val clusterMap = mutableMapOf<Int, MutableList<TextLineItem>>()
    for (i in lines.indices) {
      val root = find(i)
      clusterMap.getOrPut(root) { mutableListOf() }.add(lines[i])
    }

    return clusterMap.values.toList()
  }

  /**
   * 跨气泡边界检测 (借鉴 overlay-translator 与 comic-translate)：
   * 检查两行/两列文字之间是否跨越了气泡黑色边框或插画背景。
   * 支持左右相邻列与上下相邻行两种几何排布，绝不误阻断同气泡内上下堆叠行！
   * 方法 5 优化：对大字体 (isLargeFont) 放宽暗色阻断，避免艺术字自带投影与粗黑外描边误阻止大标题合并
   */
  private fun isSeparatedByBorder(bitmap: Bitmap, ra: Rect, rb: Rect, isLargeFont: Boolean = false): Boolean {
    if (Rect.intersects(ra, rb)) return false
    // 大字体/艺术字本身自带阴影、投影和粗描边，跳过黑边阻断检测
    if (isLargeFont) return false

    val isHorizontalNeighbors = (ra.right < rb.left || rb.right < ra.left)
    val isVerticalNeighbors = (ra.bottom < rb.top || rb.bottom < ra.top)

    // 检查文字所在背景的整体明暗度
    val safeXa = ra.centerX().coerceIn(0, bitmap.width - 1)
    val safeYa = ra.centerY().coerceIn(0, bitmap.height - 1)
    val pA = bitmap.getPixel(safeXa, safeYa)
    val lumA = (0.299 * Color.red(pA) + 0.587 * Color.green(pA) + 0.114 * Color.blue(pA)) / 255.0

    // 如果本身处于深色/黑底气泡 (lumA < 0.45)，深色像素就是普通背景底色，不应作为气泡黑边阻断！
    if (lumA < 0.45) {
      return false
    }

    if (isHorizontalNeighbors) {
      val x1 = min(ra.right, rb.left)
      val x2 = max(ra.right, rb.left)
      if (x2 - x1 >= 2) {
        val yTop = max(ra.top, rb.top)
        val yBottom = min(ra.bottom, rb.bottom)
        if (yBottom > yTop) {
          val testYLines = listOf(
            yTop + (yBottom - yTop) / 4,
            (yTop + yBottom) / 2,
            yBottom - (yBottom - yTop) / 4
          )
          var blockedLines = 0
          for (y in testYLines) {
            if (y !in 0 until bitmap.height) continue
            val step = max(1, (x2 - x1) / 8)
            var darkCount = 0
            for (x in x1..x2 step step) {
              if (x !in 0 until bitmap.width) continue
              val pixel = bitmap.getPixel(x, y)
              val lum = (0.299 * Color.red(pixel) + 0.587 * Color.green(pixel) + 0.114 * Color.blue(pixel)) / 255.0
              if (lum < 0.38) {
                darkCount++
                if (darkCount >= 2) break
              }
            }
            if (darkCount >= 2) blockedLines++
          }
          if (blockedLines >= 2) return true
        }
      }
    }

    if (isVerticalNeighbors) {
      val y1 = min(ra.bottom, rb.top)
      val y2 = max(ra.bottom, rb.top)
      if (y2 - y1 >= 2) {
        val xLeft = max(ra.left, rb.left)
        val xRight = min(ra.right, rb.right)
        if (xRight > xLeft) {
          val testXLines = listOf(
            xLeft + (xRight - xLeft) / 4,
            (xLeft + xRight) / 2,
            xRight - (xRight - xLeft) / 4
          )
          var blockedLines = 0
          for (x in testXLines) {
            if (x !in 0 until bitmap.width) continue
            val step = max(1, (y2 - y1) / 8)
            var darkCount = 0
            for (y in y1..y2 step step) {
              if (y !in 0 until bitmap.height) continue
              val pixel = bitmap.getPixel(x, y)
              val lum = (0.299 * Color.red(pixel) + 0.587 * Color.green(pixel) + 0.114 * Color.blue(pixel)) / 255.0
              if (lum < 0.38) {
                darkCount++
                if (darkCount >= 2) break
              }
            }
            if (darkCount >= 2) blockedLines++
          }
          if (blockedLines >= 2) return true
        }
      }
    }

    return false
  }

  /**
   * 判断两行文字是否属于同一气泡/段落 (基于字距、排版与物理黑边阻断)
   * 方法 5 优化：根据字符尺寸自适应放宽大字体的跨行/跨列聚类间距，杜绝大标题被硬编码阈值拆散
   */
  private fun shouldMergeLines(
    a: TextLineItem,
    b: TextLineItem,
    bitmap: Bitmap
  ): Boolean {
    val ra = a.rect
    val rb = b.rect

    // 1. 若两者有直接相交重叠，合并
    if (Rect.intersects(ra, rb)) return true

    // 字号比例判定：若字号差异超过 2.0 倍，属于不同层级（如标题与小字、音效与正文），严禁合并
    val maxChar = max(a.charSize, b.charSize)
    val minChar = max(1f, min(a.charSize, b.charSize))
    if (maxChar / minChar > 2.0f) {
      return false
    }

    val charSizeBase = max(a.charSize, b.charSize)
    val isLargeFont = charSizeBase > 30f || max(ra.height(), rb.height()) > 35 || max(ra.width(), rb.width()) > 35

    val isAVertical = a.isVertical || (a.text.length <= 2 && b.isVertical)
    val isBVertical = b.isVertical || (b.text.length <= 2 && a.isVertical)

    // 2. 竖排日漫规则：同一气泡内的多列竖排文本 (左右相邻并列)
    if (isAVertical && isBVertical) {
      val xDist = if (ra.right < rb.left) rb.left - ra.right else if (rb.right < ra.left) ra.left - rb.right else 0
      val yOverlap = max(0, min(ra.bottom, rb.bottom) - max(ra.top, rb.top))
      val minH = min(ra.height(), rb.height())
      val maxColWidth = max(ra.width(), rb.width()).toFloat()

      // 列间距限制：普通正文 <= 42px，大字体/艺术字自适应放宽至 120px
      val maxAllowedGap = if (isLargeFont) {
        max(42f, min(120f, maxColWidth * 1.35f))
      } else {
        min(42f, maxColWidth * 1.25f)
      }

      if (xDist <= maxAllowedGap && yOverlap >= minH * 0.35f && abs(ra.top - rb.top) <= minH * 0.55f) {
        if (!isSeparatedByBorder(bitmap, ra, rb, isLargeFont)) {
          return true
        }
      }
    }

    // 2.5 竖排日漫同气泡单列上下堆叠行规则 (如上方短句「あれ？」与下方主句「鮮血…？」)
    if (isAVertical && isBVertical) {
      val yDist = if (ra.bottom < rb.top) rb.top - ra.bottom else if (rb.bottom < ra.top) ra.top - rb.bottom else 0
      val xOverlap = max(0, min(ra.right, rb.right) - max(ra.left, rb.left))
      val minW = min(ra.width(), rb.width())

      // 上下堆叠间距限制：普通正文 <= 32px，大字体自适应放宽至 100px
      val maxStackedGap = if (isLargeFont) {
        max(32f, min(100f, min(a.charSize, b.charSize) * 1.6f))
      } else {
        min(32f, max(14f, min(a.charSize, b.charSize) * 1.5f))
      }
      if (yDist <= maxStackedGap && xOverlap >= minW * 0.45f) {
        if (!isSeparatedByBorder(bitmap, ra, rb, isLargeFont)) {
          return true
        }
      }
    }

    // 3. 横排规则：同一气泡/段落内的多行横排文本
    if (!a.isVertical && !b.isVertical) {
      val yDist = if (ra.bottom < rb.top) rb.top - ra.bottom else if (rb.bottom < ra.top) ra.top - rb.bottom else 0
      val xOverlap = max(0, min(ra.right, rb.right) - max(ra.left, rb.left))
      val minW = min(ra.width(), rb.width())
      val maxLineHeight = max(ra.height(), rb.height()).toFloat()

      // 行间距限制：普通正文 <= 36px，大字体自适应放宽至 120px
      val maxAllowedGap = if (isLargeFont) {
        max(36f, min(120f, maxLineHeight * 1.35f))
      } else {
        min(36f, maxLineHeight * 1.25f)
      }

      if (yDist <= maxAllowedGap && xOverlap >= minW * 0.35f && abs(ra.left - rb.left) <= minW * 0.50f) {
        if (!isSeparatedByBorder(bitmap, ra, rb, isLargeFont)) {
          return true
        }
      }
    }

    return false
  }

  data class ColorAnalysis(
    val bgColorHex: String,
    val textColorHex: String,
    val luminance: Double,
    val isUniform: Boolean
  )

  /**
   * 采样文本块背景边缘颜色与方差，确定消字底色与气泡属性
   */
  private fun sampleColorsAndUniformity(bitmap: Bitmap, box: Rect): ColorAnalysis {
    var totalR = 0
    var totalG = 0
    var totalB = 0
    val sampledPixels = mutableListOf<Int>()

    val points = listOf(
      Pair(box.left + 2, box.top + 2),
      Pair(box.right - 2, box.top + 2),
      Pair(box.left + 2, box.bottom - 2),
      Pair(box.right - 2, box.bottom - 2),
      Pair(box.centerX(), box.top + 2),
      Pair(box.centerX(), box.bottom - 2),
      Pair(box.left + 2, box.centerY()),
      Pair(box.right - 2, box.centerY())
    )

    for ((px, py) in points) {
      if (px in 0 until bitmap.width && py in 0 until bitmap.height) {
        val pixel = bitmap.getPixel(px, py)
        sampledPixels.add(pixel)
        totalR += Color.red(pixel)
        totalG += Color.green(pixel)
        totalB += Color.blue(pixel)
      }
    }

    if (sampledPixels.isEmpty()) {
      return ColorAnalysis("#FFFFFF", "#0F172A", 1.0, true)
    }

    val count = sampledPixels.size
    val avgR = totalR / count
    val avgG = totalG / count
    val avgB = totalB / count

    var variance = 0.0
    for (pixel in sampledPixels) {
      val r = Color.red(pixel)
      val g = Color.green(pixel)
      val b = Color.blue(pixel)
      val distSq = (r - avgR) * (r - avgR) + (g - avgG) * (g - avgG) + (b - avgB) * (b - avgB)
      variance += distSq
    }
    val stdDev = sqrt(variance / count)
    val isUniform = stdDev < 42.0

    val luminance = (0.299 * avgR + 0.587 * avgG + 0.114 * avgB) / 255.0
    val bgHex = String.format("#%02X%02X%02X", avgR, avgG, avgB)

    // 内部文字笔画像素采样提取真实颜色 (Text Stroke Color Extraction)
    val innerMarginX = max(2, (box.width() * 0.15f).toInt())
    val innerMarginY = max(2, (box.height() * 0.15f).toInt())
    val innerLeft = box.left + innerMarginX
    val innerRight = box.right - innerMarginX
    val innerTop = box.top + innerMarginY
    val innerBottom = box.bottom - innerMarginY

    var strokeTotalR = 0
    var strokeTotalG = 0
    var strokeTotalB = 0
    var strokeCount = 0

    if (innerRight > innerLeft && innerBottom > innerTop) {
      val stepX = max(1, (innerRight - innerLeft) / 16)
      val stepY = max(1, (innerBottom - innerTop) / 16)
      for (x in innerLeft until innerRight step stepX) {
        if (x !in 0 until bitmap.width) continue
        for (y in innerTop until innerBottom step stepY) {
          if (y !in 0 until bitmap.height) continue
          val p = bitmap.getPixel(x, y)
          val pr = Color.red(p)
          val pg = Color.green(p)
          val pb = Color.blue(p)
          val colorDiff = abs(pr - avgR) + abs(pg - avgG) + abs(pb - avgB)
          // 与背景有显著反差，视为文字笔画像素
          if (colorDiff > 60) {
            strokeTotalR += pr
            strokeTotalG += pg
            strokeTotalB += pb
            strokeCount++
          }
        }
      }
    }

    val textHex = if (strokeCount >= 3) {
      val tr = strokeTotalR / strokeCount
      val tg = strokeTotalG / strokeCount
      val tb = strokeTotalB / strokeCount
      String.format("#%02X%02X%02X", tr, tg, tb)
    } else {
      if (luminance > 0.52) "#18181B" else "#F8FAFC"
    }

    return ColorAnalysis(bgHex, textHex, luminance, isUniform)
  }

  /**
   * 智能分类文本类型：
   * - bubble: 对话气泡 (白底/亮底单色区域)
   * - title: 大标题/封面书名/章节标题
   * - sfx: 拟声词 (片假名音效)
   * - free_text: 旁白/画面浮动嵌字
   */
  private fun classifyTextType(
    text: String,
    box: Rect,
    bitmap: Bitmap,
    avgCharSize: Float,
    luminance: Double,
    isUniform: Boolean
  ): String {
    val clean = text.replace(" ", "").trim()

    // 1. 标题判断：字号巨大，或单字高度/宽度占整图 > 6%，或文本块宽度 > 35% 且字号 > 26
    val widthRatio = box.width().toFloat() / bitmap.width
    val heightRatio = box.height().toFloat() / bitmap.height
    if (avgCharSize > 34f || widthRatio > 0.38f || (widthRatio > 0.28f && heightRatio > 0.07f)) {
      return "title"
    }

    // 2. 拟声词 (SFX) 判断：短字符 (<= 6) 且几乎全为片假名或拟声符号
    val isKatakanaSfx = clean.isNotEmpty() && clean.length <= 6 && clean.all { c ->
      (c in '\u30A0'..'\u30FF') || c == 'ッ' || c == 'ー' || c == '！' || c == '!' || c == '…' || c == '?' || c == '？'
    }
    if (isKatakanaSfx && (!isUniform || luminance < 0.70)) {
      return "sfx"
    }

    // 3. 气泡判断：底色均匀且亮度偏高 (常见日漫白底气泡)
    if (isUniform && luminance > 0.68) {
      return "bubble"
    }

    // 4. 其它一律作为画面嵌字/旁白处理 (free_text)
    return "free_text"
  }

  /**
   * 针对用户点击未识别区域的局部高精 OCR 扫描
   */
  suspend fun processRegion(
    bitmap: Bitmap,
    cx: Int,
    cy: Int,
    radiusW: Int = 140,
    radiusH: Int = 180,
    lang: String = "ja",
    context: Context? = null
  ): Map<String, Any>? {
    val cropLeft = max(0, cx - radiusW)
    val cropTop = max(0, cy - radiusH)
    val cropRight = min(bitmap.width, cx + radiusW)
    val cropBottom = min(bitmap.height, cy + radiusH)
    val cropW = cropRight - cropLeft
    val cropH = cropBottom - cropTop

    if (cropW < 20 || cropH < 20) return null

    context?.let { ctx ->
      if (!MangaOcrModel.isModelReady) {
        MangaOcrModel.init(ctx)
      }
    }

    var croppedBitmap: Bitmap? = null
    try {
      croppedBitmap = Bitmap.createBitmap(bitmap, cropLeft, cropTop, cropW, cropH)

      // 1. 若端侧漫画专用 Manga-OCR 模型就绪，直接对切片进行日漫模型识别
      if (MangaOcrModel.isModelReady) {
        val ocrText = MangaOcrModel.recognize(croppedBitmap)
        if (ocrText.isNotBlank()) {
          val isVertical = cropH > cropW * 1.15f
          val disambiguated = disambiguateMangaCharacters(ocrText)
          val langInfo = detectLanguage(disambiguated, lang, true)
          val isSfx = disambiguated.length <= 5 && (disambiguated.contains("ッ") || disambiguated.contains("ガ") || disambiguated.contains("ポ"))
          return mapOf(
            "id" to "manga_crop_${System.currentTimeMillis()}",
            "box" to mapOf(
              "x" to cropLeft,
              "y" to cropTop,
              "width" to cropW,
              "height" to cropH
            ),
            "sourceText" to disambiguated,
            "targetText" to "",
            "direction" to if (isVertical) "vertical" else "horizontal",
            "lines" to listOf(disambiguated),
            "textType" to if (isSfx) "sfx" else "bubble",
            "detectedLang" to langInfo.langCode,
            "langName" to langInfo.langName,
            "langColor" to langInfo.badgeColor,
            "detectedBgColor" to "#FFFFFF",
            "detectedTextColor" to "#18181B",
            "ocrEngine" to "manga_ocr"
          )
        }
      }

      val results = processImage(croppedBitmap, lang, context = context)
      if (results.isEmpty()) return null

      // 找到离点击中心最近的识别块
      var bestItem: Map<String, Any>? = null
      var minDistance = Double.MAX_VALUE

      for (item in results) {
        val bMap = item["box"] as? Map<*, *> ?: continue
        val bx = (bMap["x"] as? Number)?.toInt() ?: 0
        val by = (bMap["y"] as? Number)?.toInt() ?: 0
        val bw = (bMap["width"] as? Number)?.toInt() ?: 0
        val bh = (bMap["height"] as? Number)?.toInt() ?: 0

        // 映射回全局大图坐标
        val globalX = cropLeft + bx
        val globalY = cropTop + by
        val gCenterX = globalX + bw / 2
        val gCenterY = globalY + bh / 2

        val dist = Math.hypot((gCenterX - cx).toDouble(), (gCenterY - cy).toDouble())
        if (dist < minDistance) {
          minDistance = dist
          val mutable = item.toMutableMap()
          mutable["box"] = mapOf(
            "x" to globalX,
            "y" to globalY,
            "width" to bw,
            "height" to bh
          )
          bestItem = mutable
        }
      }
      return bestItem
    } catch (e: Exception) {
      return null
    } finally {
      croppedBitmap?.recycle()
    }
  }

  /**
   * 日漫高频复杂汉字与多笔画易混淆字消歧器 (Manga Kanji Disambiguation Engine)
   * 彻底解决 ML Kit CNN 感受野在密集笔画 (12~20 画，如「凛」「鬱」「魔」「警」等) 上的笔画粘连错别字跳变问题！
   */
  fun disambiguateMangaCharacters(text: String): String {
    if (text.isBlank()) return text
    var result = text

    // 1. 核心人名「凛 / 凛子」及亲昵后缀消歧 (解决 漂子/慄子/廪子/稟子/癛子/澟子/凜子 随滑动随机跳变)
    result = result.replace(Regex("[漂慄廪稟癛澟凜]子"), "凛子")
    result = result.replace(Regex("[漂慄廪稟癛澟凜](ちゃん|さん|さま|様|先輩|せんぱい|先生)"), "凛$1")
    result = result.replace(Regex("[漂慄廪稟癛澟凜]([、，！!？?…・/〜~。]|は|が|を|に|で|の|と|って|ってば|よ|ね|わ)"), "凛$1")

    // 2. 日漫高频口语与核心词汇密集笔画消歧
    result = result.replace(Regex("身[休]"), "身体")
    result = result.replace(Regex("気[特]ち"), "気持ち")
    result = result.replace(Regex("我[惺]"), "我慢")
    result = result.replace(Regex("摩([法女])"), "魔$1")
    result = result.replace(Regex("警[祭宗]"), "警察")
    result = result.replace(Regex("[绮奇][麗丽]"), "綺麗")
    result = result.replace(Regex("興[旧]"), "興奮")
    result = result.replace(Regex("絶[丁]"), "絶頂")
    result = result.replace(Regex("[光][輩辈]"), "先輩")
    result = result.replace(Regex("約[東]"), "約束")
    result = result.replace(Regex("大[夫]"), "大丈夫")
    result = result.replace(Regex("間[問]違"), "間違い")
    result = result.replace(Regex("躊[踌]"), "躊躇")
    result = result.replace(Regex("痙[挛]"), "痙攣")
    result = result.replace(Regex("恍[忽]"), "恍惚")
    result = result.replace(Regex("朦[胧]"), "朦朧")
    result = result.replace(Regex("静[香江子]"), "静$1")

    // 3. 规范化压缩连续过长的横线、破折号、长音符、波浪号，避免拉得过长
    result = compressExcessiveRepeatedCharacters(result)

    return result
  }

  /**
   * 规范化并压缩冗长重复字符 (如将过长的 "--------" 或 "――――――" 或 "~~~~~~" 压缩为最多 2 个)
   */
  fun compressExcessiveRepeatedCharacters(text: String): String {
    if (text.isBlank()) return text
    var result = text
    // 压缩连续 3 个及以上的横线破折号（半角减号、全角破折号、日文全角横线、长音符）为 2 个破折号 "――"
    result = result.replace(Regex("[-—―─━ー]{3,}"), "――")
    // 压缩连续 3 个及以上的波浪号为 "~~"
    result = result.replace(Regex("[~〜]{3,}"), "~~")
    // 压缩连续等号与下划线
    result = result.replace(Regex("={3,}"), "==")
    result = result.replace(Regex("_{3,}"), "__")
    // 压缩连续感叹号与问号
    result = result.replace(Regex("[!！]{3,}"), "！！")
    result = result.replace(Regex("[?？]{3,}"), "？？")
    // 压缩连续点号与省略号
    result = result.replace(Regex("(?:\\.{3,}|…{2,}|[·・]{3,})"), "……")
    return result
  }

  /**
   * 跨帧/滑动连续识别阻尼稳定器 (Temporal Bubble Stability Buffer)
   * 解决用户在漫读场景下“每次下滑微调点击一次识别，复杂文字随机跳变不同字”的体验痛点。
   */
  private fun stabilizeBubbleText(box: Rect, currentText: String): String {
    val now = System.currentTimeMillis()
    synchronized(recentBubbleHistory) {
      // 1. 清理过期记录 (12 秒窗口)
      recentBubbleHistory.removeAll { now - it.lastTimestamp > HISTORY_WINDOW_MS }

      val cX = box.centerX()
      val cY = box.centerY()
      val bW = box.width()
      val bH = box.height()

      // 2. 匹配历史气泡：水平中心一致、几何尺寸相仿、垂直位移处于合理滑动位移 (<= 450px)
      val matched = recentBubbleHistory.find { hist ->
        abs(cX - hist.centerX) <= max(32, (bW * 0.25).toInt()) &&
        abs(bW - hist.width) <= max(24, (bW * 0.30).toInt()) &&
        abs(bH - hist.height) <= max(24, (bH * 0.30).toInt()) &&
        abs(cY - hist.lastY) <= 450
      }

      if (matched == null) {
        recentBubbleHistory.add(HistoricalBubble(cX, bW, bH, cY, currentText, now, 1))
        return currentText
      }

      matched.lastY = cY
      matched.lastTimestamp = now

      if (matched.canonicalText == currentText) {
        matched.hitCount++
        return currentText
      }

      // 3. 当文本微小差异 (1 个字符跳变，如 凛子 vs 漂子/慄子) 时进行阻尼锁定
      val lenDiff = abs(matched.canonicalText.length - currentText.length)
      if (lenDiff <= 1) {
        val curHasTarget = currentText.contains("凛") || currentText.contains("警察") || currentText.contains("身体") || currentText.contains("気持ち")
        val histHasTarget = matched.canonicalText.contains("凛") || matched.canonicalText.contains("警察") || matched.canonicalText.contains("身体") || matched.canonicalText.contains("気持ち")

        if (curHasTarget && !histHasTarget) {
          // 当前文本更精准，升级历史标准
          matched.canonicalText = currentText
          matched.hitCount = 1
          return currentText
        } else if (histHasTarget || matched.hitCount >= 1) {
          // 历史标准更优质或已稳定锁定，压制本次的笔画抖动，保持历史标准
          matched.hitCount++
          return matched.canonicalText
        }
      }

      // 差异较大时更新为当前最新
      matched.canonicalText = currentText
      matched.hitCount = 1
      return currentText
    }
  }

  data class SingleRegionOcrResult(
    val text: String,
    val lines: List<String>,
    val isVertical: Boolean,
    val columnCount: Int,
    val fontSizePx: Float,
    val detectedLang: String,
    val langName: String,
    val langColor: String,
    val box: Rect,
    val confidence: Float = 0.96f
  )

  /**
   * 针对用户点击的特定文本框区域进行精准局部重新 OCR (不重新抓取或处理全屏幕)
   * 采用局部多尺度放大、反相与高反差增强扫描，耗时 < 30ms 极速返回
   */
  suspend fun reOcrSingleRegion(
    sourceBitmap: Bitmap,
    region: Rect,
    lang: String = "auto",
    filterLang: String = "auto"
  ): SingleRegionOcrResult? {
    if (sourceBitmap.isRecycled) return null
    val screenW = sourceBitmap.width
    val screenH = sourceBitmap.height

    // 增加 15% 外边距安全缓冲，确保边界处的假名、标点、长音符不被裁切
    val padX = maxOf(8, (region.width() * 0.15f).toInt())
    val padY = maxOf(8, (region.height() * 0.15f).toInt())
    val cropLeft = maxOf(0, region.left - padX)
    val cropTop = maxOf(0, region.top - padY)
    val cropRight = minOf(screenW, region.right + padX)
    val cropBottom = minOf(screenH, region.bottom + padY)
    val cropW = cropRight - cropLeft
    val cropH = cropBottom - cropTop

    if (cropW <= 6 || cropH <= 6) return null

    var croppedBitmap: Bitmap? = null
    try {
      croppedBitmap = Bitmap.createBitmap(sourceBitmap, cropLeft, cropTop, cropW, cropH)
      val recognizer = getRecognizer(lang)
      val detectedLines = mutableListOf<TextLineItem>()

      // 1. 基准尺度扫描 (1.0x)
      val baseLines = recognizeSingleBitmap(recognizer, croppedBitmap, 1.0f, 1.0f, confidenceWeight = 1.0f)
      detectedLines.addAll(baseLines)

      // 2. 自适应放大高清扫描 (针对小字号气泡与假名注音)
      if (cropW < 380 || cropH < 380) {
        val scale = 2.0f
        var upscaled: Bitmap? = null
        try {
          upscaled = Bitmap.createScaledBitmap(croppedBitmap, (cropW * scale).toInt(), (cropH * scale).toInt(), true)
          val upLines = recognizeSingleBitmap(recognizer, upscaled, scale, scale, confidenceWeight = 2.2f)
          detectedLines.addAll(upLines)
        } catch (e: Exception) {
        } finally {
          upscaled?.recycle()
        }
      }

      // 3. 高反差与反相扫描 (攻克黑底白字与复杂网点阴影)
      var contrastBmp: Bitmap? = null
      try {
        contrastBmp = createHighContrastBitmap(croppedBitmap)
        val contrastLines = recognizeSingleBitmap(recognizer, contrastBmp, 1.0f, 1.0f, confidenceWeight = 1.8f)
        detectedLines.addAll(contrastLines)
      } catch (e: Exception) {
      } finally {
        contrastBmp?.recycle()
      }

      var invertBmp: Bitmap? = null
      try {
        invertBmp = createInvertedBitmap(croppedBitmap)
        val invLines = recognizeSingleBitmap(recognizer, invertBmp, 1.0f, 1.0f, confidenceWeight = 1.6f)
        detectedLines.addAll(invLines)
      } catch (e: Exception) {
      } finally {
        invertBmp?.recycle()
      }

      if (detectedLines.isEmpty()) {
        return null
      }

      val deduplicated = deduplicateLines(detectedLines)
      if (deduplicated.isEmpty()) return null

      // 判断纵横排方向
      val verticalCount = deduplicated.count { it.isVertical || it.rect.height() > it.rect.width() * 1.15f }
      val isVertical = verticalCount * 2 >= deduplicated.size

      // 排序与列流转：
      // 竖排：日漫从右往左 (RTL) 列流转
      // 横排：从上往下
      val sortedLines = if (isVertical) {
        deduplicated.sortedByDescending { it.rect.centerX() }
      } else {
        deduplicated.sortedBy { it.rect.centerY() }
      }

      val linesText = sortedLines.map { it.text.trim() }.filter { it.isNotEmpty() }
      val fullText = linesText.joinToString(if (isVertical) "\n" else " ")
      val avgCharSize = if (deduplicated.isNotEmpty()) {
        deduplicated.map { it.charSize }.average().toFloat()
      } else {
        cropH.toFloat() * 0.75f
      }

      val langDetect = detectLanguage(fullText, preferredLang = filterLang)

      // 映射回全屏原位绝对物理坐标
      var minX = Int.MAX_VALUE
      var minY = Int.MAX_VALUE
      var maxX = Int.MIN_VALUE
      var maxY = Int.MIN_VALUE
      for (line in sortedLines) {
        minX = minOf(minX, line.rect.left)
        minY = minOf(minY, line.rect.top)
        maxX = maxOf(maxX, line.rect.right)
        maxY = maxOf(maxY, line.rect.bottom)
      }

      val actualBounds = if (minX < maxX && minY < maxY) {
        Rect(cropLeft + minX, cropTop + minY, cropLeft + maxX, cropTop + maxY)
      } else {
        region
      }

      val avgRawConf = deduplicated.mapNotNull { it.rawConfidence }.takeIf { it.isNotEmpty() }?.average()?.toFloat()
      val singleConf = avgRawConf ?: 0.96f
      val roundedConf = Math.round(singleConf * 100) / 100.0f

      return SingleRegionOcrResult(
        text = fullText,
        lines = linesText,
        isVertical = isVertical,
        columnCount = maxOf(1, sortedLines.size),
        fontSizePx = avgCharSize,
        detectedLang = langDetect.langCode,
        langName = langDetect.langName,
        langColor = langDetect.badgeColor,
        box = actualBounds,
        confidence = roundedConf
      )
    } finally {
      croppedBitmap?.recycle()
    }
  }
}
