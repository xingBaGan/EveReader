package expo.modules.screentranslator

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.max
import kotlin.math.min

/**
 * 漫画专用端侧文本与气泡检测器 (Comic Text & Speech Bubble Detector)
 * 基于业界主流 RT-DETR-v2 轻量化 int8 模型 (ogkalu/comic-text-and-bubble-detector)
 *
 * 类别输出：
 * 0: bubble (气泡外轮廓)
 * 1: text_bubble (气泡内对白文字)
 * 2: text_free (艺术字、拟声词SFX、浮空手写字、大标题)
 *
 * v2 检测策略（提升艺术字检出与框精度）：
 * 1. letterbox 等比缩放 + 灰边填充，替代直接拉伸，避免竖排文字被压扁导致漏检/框形畸变
 * 2. 纵向分块（overlap）二次推理，提高小号艺术字/拟声词的有效分辨率
 * 3. 多视图跨尺度去重（IoU + 包含度），消除同一区域被重复命中
 */
object ComicTextDetector {

  private const val TAG = "ComicTextDetector"
  private const val MODEL_ASSET_PATH = "models/comic_detector.onnx"
  private const val INPUT_SIZE = 640

  private var ortEnv: OrtEnvironment? = null
  private var ortSession: OrtSession? = null

  @Volatile
  private var isInitialized = false

  @Volatile
  var isModelReady = false
    private set

  @Volatile
  var statusMessage: String = "未初始化"
    private set

  @Volatile
  var lastInferenceTimeMs: Long = 0L
    private set

  @Volatile
  var lastDetectionCount: Int = 0
    private set

  @Volatile
  var appContext: Context? = null

  /** 检测策略配置：letterbox + 3x3 网格 + 跨视图去重（默认即线上策略） */
  data class DetectConfig(
    val letterbox: Boolean = true,
    val gridX: Int = 2,
    val gridY: Int = 2,
    val overlap: Float = 0.12f,
    val scoreThreshold: Float = 0.24f,
    val artScoreThreshold: Float = 0.26f,
    val mergeIou: Float = 0.50f,
    val containRatio: Float = 0.70f,
    val minBoxPx: Int = 8,
    val mergeGapPx: Float = 24f,
    val promoteIsolatedBubble: Boolean = true
  )

  @Volatile
  var config: DetectConfig = DetectConfig()

  data class ComicDetection(
    val bounds: Rect,
    val category: Int,     // 0: bubble, 1: text_bubble, 2: text_free
    val labelName: String, // "bubble" | "text_bubble" | "text_free"
    val score: Float,
    val fromFullView: Boolean = false
  )

  /** 单个推理视图：640x640 输入 + 映射回原图的仿射参数 */
  private data class View(
    val bitmap640: Bitmap,
    val scaleX: Float,
    val scaleY: Float,
    val offsetX: Float,
    val offsetY: Float,
    val tileX: Int,
    val tileY: Int
  )

  @Synchronized
  fun init(context: Context): Boolean {
    if (isInitialized && ortSession != null) return true
    appContext = context.applicationContext

    return try {
      statusMessage = "⏳ 正在初始化 ONNX 环境..."
      val env = OrtEnvironment.getEnvironment()
      ortEnv = env

      val sessionOptions = OrtSession.SessionOptions().apply {
        setInterOpNumThreads(2)
        setIntraOpNumThreads(2)
      }

      val targetFile = java.io.File(context.filesDir, "comic_detector.onnx")
      if (!targetFile.exists() || targetFile.length() < 10000000L) {
        statusMessage = "⏳ 正在解压端侧漫画检测模型 (11.1MB)..."
        var assetStream: java.io.InputStream? = null
        val candidates = listOf(MODEL_ASSET_PATH, "comic_detector.onnx")
        for (cand in candidates) {
          try {
            assetStream = context.assets.open(cand)
            Log.i(TAG, "Found model asset at: $cand")
            break
          } catch (e: Exception) {}
        }

        if (assetStream == null) {
          val rootAssets = try { context.assets.list("")?.joinToString() } catch (e: Exception) { "none" }
          val err = "未找到模型文件 $MODEL_ASSET_PATH (根目录 assets: $rootAssets)"
          Log.e(TAG, err)
          statusMessage = "❌ $err"
          return false
        }

        assetStream.use { input ->
          java.io.FileOutputStream(targetFile).use { output ->
            input.copyTo(output)
          }
        }
      }

      Log.i(TAG, "Loading ONNX session from: ${targetFile.absolutePath} (${targetFile.length() / 1024} KB)")
      ortSession = env.createSession(targetFile.absolutePath, sessionOptions)
      isInitialized = true
      isModelReady = true
      statusMessage = "✅ 漫画专用检测模型就绪 (11.1MB)"
      Log.i(TAG, "ComicTextDetector ONNX model ready!")
      true
    } catch (e: Exception) {
      val err = "模型加载失败: ${e.message}"
      Log.e(TAG, err, e)
      statusMessage = "❌ $err"
      false
    }
  }

  /**
   * 线上默认入口：使用 [config] 策略
   */
  fun detect(
    bitmap: Bitmap,
    context: Context? = null,
    scoreThreshold: Float = config.scoreThreshold,
    artScoreThreshold: Float = config.artScoreThreshold
  ): List<ComicDetection> {
    return detectWith(
      bitmap,
      context,
      config.copy(scoreThreshold = scoreThreshold, artScoreThreshold = artScoreThreshold)
    )
  }

  /**
   * 可配置入口：letterbox + 分块 + 跨视图去重
   */
  fun detectWith(bitmap: Bitmap, context: Context?, cfg: DetectConfig): List<ComicDetection> {
    val ctx = context?.applicationContext ?: appContext ?: return emptyList()
    if (!isInitialized && !init(ctx)) return emptyList()
    val session = ortSession ?: return emptyList()
    val env = ortEnv ?: return emptyList()
    if (bitmap.width < 10 || bitmap.height < 10) return emptyList()

    val startTime = System.currentTimeMillis()
    val views = buildViews(bitmap, cfg)
    val raw = ArrayList<ComicDetection>(64)
    try {
      for ((idx, v) in views.withIndex()) {
        raw += inferView(env, session, v, bitmap.width, bitmap.height, fromFullView = idx == 0)
      }
    } catch (e: Exception) {
      Log.e(TAG, "ComicTextDetector inference failed", e)
    } finally {
      for (v in views) if (v.bitmap640 !== bitmap) v.bitmap640.recycle()
    }

    val merged = mergeDetections(raw, cfg, bitmap.width)
    lastInferenceTimeMs = System.currentTimeMillis() - startTime
    lastDetectionCount = merged.size
    Log.i(
      TAG,
      "ComicTextDetector 推理完成: views=${views.size} raw=${raw.size} merged=${merged.size} " +
        "(气泡=${merged.count { it.category == 0 }}, 文本=${merged.count { it.category == 1 }}, 艺术字=${merged.count { it.category == 2 }}) " +
        "耗时 ${lastInferenceTimeMs}ms"
    )
    return merged
  }

  /** 构造推理视图：整页 + 2D 网格分块（带重叠），提升小号艺术字/拟声词的有效分辨率 */
  private fun buildViews(bitmap: Bitmap, cfg: DetectConfig): List<View> {
    val gx = cfg.gridX.coerceIn(1, 6)
    val gy = cfg.gridY.coerceIn(1, 6)
    val out = ArrayList<View>(gx * gy + 1)
    out.add(makeView(bitmap, 0, 0, bitmap.width, bitmap.height, cfg))
    if (gx == 1 && gy == 1) return out
    val tileW = bitmap.width.toFloat() / gx
    val tileH = bitmap.height.toFloat() / gy
    val ovX = (tileW * cfg.overlap).toInt()
    val ovY = (tileH * cfg.overlap).toInt()
    for (iy in 0 until gy) {
      for (ix in 0 until gx) {
        val left = max(0, (ix * tileW).toInt() - ovX)
        val top = max(0, (iy * tileH).toInt() - ovY)
        val right = min(bitmap.width, ((ix + 1) * tileW).toInt() + ovX)
        val bottom = min(bitmap.height, ((iy + 1) * tileH).toInt() + ovY)
        if (right - left < 48 || bottom - top < 48) continue
        out.add(makeView(bitmap, left, top, right, bottom, cfg))
      }
    }
    return out
  }

  private fun makeView(
    src: Bitmap,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
    cfg: DetectConfig
  ): View {
    val w = right - left
    val h = bottom - top
    var region = src
    var ownsRegion = false
    if (left != 0 || top != 0 || w != src.width || h != src.height) {
      region = Bitmap.createBitmap(src, left, top, w, h)
      ownsRegion = true
    }

    if (!cfg.letterbox) {
      val scaled = Bitmap.createScaledBitmap(region, INPUT_SIZE, INPUT_SIZE, true)
      if (ownsRegion) region.recycle()
      return View(
        bitmap640 = scaled,
        scaleX = INPUT_SIZE.toFloat() / w,
        scaleY = INPUT_SIZE.toFloat() / h,
        offsetX = 0f,
        offsetY = 0f,
        tileX = left,
        tileY = top
      )
    }

    val scale = min(INPUT_SIZE.toFloat() / w, INPUT_SIZE.toFloat() / h)
    val contentW = (w * scale).toInt().coerceAtLeast(1)
    val contentH = (h * scale).toInt().coerceAtLeast(1)
    val ox = (INPUT_SIZE - contentW) / 2f
    val oy = (INPUT_SIZE - contentH) / 2f

    val canvasBitmap = Bitmap.createBitmap(INPUT_SIZE, INPUT_SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(canvasBitmap)
    canvas.drawColor(Color.rgb(114, 114, 114))
    val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    canvas.drawBitmap(region, android.graphics.Rect(0, 0, w, h), android.graphics.RectF(ox, oy, ox + contentW, oy + contentH), paint)
    if (ownsRegion) region.recycle()

    return View(
      bitmap640 = canvasBitmap,
      scaleX = contentW.toFloat() / w,
      scaleY = contentH.toFloat() / h,
      offsetX = ox,
      offsetY = oy,
      tileX = left,
      tileY = top
    )
  }

  /** 单视图推理，输出映射回原图坐标的检测框 */
  private fun inferView(
    env: OrtEnvironment,
    session: OrtSession,
    view: View,
    origW: Int,
    origH: Int,
    fromFullView: Boolean
  ): List<ComicDetection> {
    val totalPixels = INPUT_SIZE * INPUT_SIZE
    val pixels = IntArray(totalPixels)
    view.bitmap640.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

    val floatBuffer = FloatBuffer.allocate(3 * totalPixels)
    for (i in 0 until totalPixels) floatBuffer.put(((pixels[i] shr 16) and 0xFF) / 255.0f)
    for (i in 0 until totalPixels) floatBuffer.put(((pixels[i] shr 8) and 0xFF) / 255.0f)
    for (i in 0 until totalPixels) floatBuffer.put((pixels[i] and 0xFF) / 255.0f)
    floatBuffer.rewind()

    val imagesTensor = OnnxTensor.createTensor(
      env,
      floatBuffer,
      longArrayOf(1, 3, INPUT_SIZE.toLong(), INPUT_SIZE.toLong())
    )
    // 目标尺寸固定为 640x640：输出即 640 空间像素坐标，再由视图参数反算回原图
    val sizesTensor = OnnxTensor.createTensor(
      env,
      LongBuffer.wrap(longArrayOf(INPUT_SIZE.toLong(), INPUT_SIZE.toLong())),
      longArrayOf(1, 2)
    )

    val out = ArrayList<ComicDetection>(32)
    val results = session.run(mapOf("images" to imagesTensor, "orig_target_sizes" to sizesTensor))
    try {
      var labelsTensor: OnnxTensor? = null
      var boxesTensor: OnnxTensor? = null
      var scoresTensor: OnnxTensor? = null
      for (entry in results) {
        when (entry.key) {
          "labels" -> labelsTensor = entry.value as? OnnxTensor
          "boxes" -> boxesTensor = entry.value as? OnnxTensor
          "scores" -> scoresTensor = entry.value as? OnnxTensor
        }
      }
      if (labelsTensor != null && boxesTensor != null && scoresTensor != null) {
        val labelsBuf = labelsTensor.longBuffer
        val boxesBuf = boxesTensor.floatBuffer
        val scoresBuf = scoresTensor.floatBuffer
        val count = minOf(labelsBuf.remaining(), scoresBuf.remaining(), boxesBuf.remaining() / 4)
        for (i in 0 until count) {
          val score = scoresBuf.get(i)
          if (score < 0.10f) continue
          val cat = labelsBuf.get(i).toInt()
          val bx1 = (boxesBuf.get(i * 4 + 0) - view.offsetX) / view.scaleX + view.tileX
          val by1 = (boxesBuf.get(i * 4 + 1) - view.offsetY) / view.scaleY + view.tileY
          val bx2 = (boxesBuf.get(i * 4 + 2) - view.offsetX) / view.scaleX + view.tileX
          val by2 = (boxesBuf.get(i * 4 + 3) - view.offsetY) / view.scaleY + view.tileY
          val x1 = min(bx1, bx2).toInt().coerceIn(0, origW)
          val y1 = min(by1, by2).toInt().coerceIn(0, origH)
          val x2 = max(bx1, bx2).toInt().coerceIn(0, origW)
          val y2 = max(by1, by2).toInt().coerceIn(0, origH)
          if (x2 - x1 < 6 || y2 - y1 < 6) continue
          out.add(
            ComicDetection(
              bounds = Rect(x1, y1, x2, y2),
              category = cat,
              labelName = when (cat) {
                0 -> "bubble"
                1 -> "text_bubble"
                2 -> "text_free"
                else -> "text_free"
              },
              score = score,
              fromFullView = fromFullView
            )
          )
        }
      }
    } finally {
      imagesTensor.close()
      sizesTensor.close()
      results.close()
    }
    return out
  }

  private fun iou(a: Rect, b: Rect): Float {
    val ix = max(0, min(a.right, b.right) - max(a.left, b.left))
    val iy = max(0, min(a.bottom, b.bottom) - max(a.top, b.top))
    val inter = ix.toFloat() * iy
    if (inter <= 0f) return 0f
    val union = a.width().toFloat() * a.height() + b.width().toFloat() * b.height() - inter
    return if (union <= 0f) 0f else inter / union
  }

  private fun containment(a: Rect, b: Rect): Float {
    val ix = max(0, min(a.right, b.right) - max(a.left, b.left))
    val iy = max(0, min(a.bottom, b.bottom) - max(a.top, b.top))
    val inter = ix.toFloat() * iy
    if (inter <= 0f) return 0f
    val smaller = min(a.width().toFloat() * a.height(), b.width().toFloat() * b.height())
    return if (smaller <= 0f) 0f else inter / smaller
  }

  /** 合并相邻且互相重叠度足够的艺术字框（同一大标题被分块切开的常见情形） */
  private fun mergeAdjacentArt(items: List<ComicDetection>, cfg: DetectConfig, pageWidth: Int): List<ComicDetection> {
    val art = items.filter { it.category == 2 }.sortedBy { it.bounds.left }
    if (art.size < 2) return items
    val others = items.filter { it.category != 2 }
    val used = BooleanArray(art.size)
    val out = ArrayList<ComicDetection>(art.size)
    for (i in art.indices) {
      if (used[i]) continue
      var box = art[i].bounds
      var score = art[i].score
      used[i] = true
      var changed = true
      while (changed) {
        changed = false
        for (j in art.indices) {
          if (used[j]) continue
          val o = art[j].bounds
          val gapX = max(0, max(box.left, o.left) - min(box.right, o.right)).toFloat()
          val overlapY = (min(box.bottom, o.bottom) - max(box.top, o.top)).toFloat()
          val overlapX = (min(box.right, o.right) - max(box.left, o.left)).toFloat()
          // 同一水平带内合并被切碎的大标题：高度相近 + 中心线接近 + 横向间隙在容忍范围内
          val hRatio = min(box.height(), o.height()).toFloat() / max(1, max(box.height(), o.height()))
          val cyA = (box.top + box.bottom) / 2f
          val cyB = (o.top + o.bottom) / 2f
          val sameBand = kotlin.math.abs(cyA - cyB) <= 0.45f * min(box.height(), o.height())
          val mergedWidth = max(box.right, o.right) - min(box.left, o.left)
          val adjacent = gapX <= 0.16f * pageWidth && hRatio >= 0.80f && sameBand &&
            mergedWidth <= 0.85f * pageWidth
          if (adjacent) {
            box = Rect(min(box.left, o.left), min(box.top, o.top), max(box.right, o.right), max(box.bottom, o.bottom))
            score = max(score, art[j].score)
            used[j] = true
            changed = true
          }
        }
      }
      out.add(art[i].copy(bounds = box, score = score))
    }
    return others + out
  }

  /** 跨视图去重 + 分类别阈值过滤（保持得分降序，抑制重复/包含框） */
  private fun mergeDetections(raw: List<ComicDetection>, cfg: DetectConfig, pageW: Int): List<ComicDetection> {
    if (raw.isEmpty()) return emptyList()
    // 文本类统一参与跨类去重（模型常在同一区域给 text_bubble / text_free 双标签）
    val sorted = raw.sortedByDescending { it.score }
    val accepted = ArrayList<ComicDetection>(sorted.size)
    for (det in sorted) {
      val isText = det.category != 0
      val threshold = when (det.category) {
        2 -> cfg.artScoreThreshold
        1 -> cfg.scoreThreshold
        else -> cfg.scoreThreshold
      }
      if (det.score < threshold) continue
      if (det.bounds.width() < cfg.minBoxPx || det.bounds.height() < cfg.minBoxPx) continue

      var duplicate = false
      for (a in accepted) {
        val aText = a.category != 0
        if (aText != isText) continue
        val ov = iou(det.bounds, a.bounds)
        if (ov >= cfg.mergeIou || containment(det.bounds, a.bounds) >= cfg.containRatio) {
          duplicate = true
          break
        }
      }
      if (!duplicate) accepted.add(det)
    }

    // 2. 大框抑制：整页视图检出的较大艺术字框（大标题等）优先，丢弃其内部同族碎片框
    val fullViewBoxes = accepted.filter { it.fromFullView }
    val afterSuppress = accepted.filter { det ->
      if (det.fromFullView) return@filter true
      !fullViewBoxes.any { big ->
        (big.category != 0) == (det.category != 0) &&
          containment(det.bounds, big.bounds) >= 0.55f &&
          big.bounds.width().toLong() * big.bounds.height() >= 1.6f * det.bounds.width() * det.bounds.height()
      }
    }

    // 3. 分块视图的艺术字碎片：与整页视图艺术字框重叠的一律丢弃；
    //    随后把同一水平带内被切成多段的大标题合并回单框
    val fullArt = afterSuppress.filter { it.category == 2 && it.fromFullView }
    val deduped = afterSuppress.filter { det ->
      if (det.category != 2 || det.fromFullView) return@filter true
      !fullArt.any { big ->
        containment(det.bounds, big.bounds) >= 0.85f
      }
    }
    val mergedItems = mergeAdjacentArt(deduped, cfg, pageW)

    // 类别统一：与 cat1/cat2 区域重叠的 cat0 视为同一区域的轮廓框，丢弃；
    // 孤立的 cat0（模型常以该类框标出独立文字行/拟声词，如「ピンポーン♪」）提升为 text_bubble 参与后续 OCR
    val textBoxes = mergedItems.filter { it.category != 0 }
    return mergedItems.mapNotNull { det ->
      if (det.category != 0) return@mapNotNull det
      val overlapped = textBoxes.any { other ->
        containment(det.bounds, other.bounds) >= 0.60f || iou(det.bounds, other.bounds) >= 0.30f
      }
      when {
        overlapped -> null
        cfg.promoteIsolatedBubble -> det.copy(category = 1, labelName = "text_bubble")
        else -> det
      }
    }
  }
}
