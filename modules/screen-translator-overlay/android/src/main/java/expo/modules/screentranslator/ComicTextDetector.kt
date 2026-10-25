package expo.modules.screentranslator

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Log
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.max
import kotlin.math.min

/**
 * 漫画专用端侧文本与气泡检测器 (Comic Text & Speech Bubble Detector)
 * 基于业界主流 RT-DETR-v2 轻量化 int8 模型 (ogkalu/comic-text-and-bubble-detector)
 * 在 11,000+ 张日漫、条漫、国漫与美漫真实数据集上微调训练，
 * 专门攻克日漫中的复杂艺术字 (描き文字)、拟声词 (SFX)、浮空对白与大标题！
 *
 * 类别输出：
 * 0: bubble (气泡外轮廓)
 * 1: text_bubble (气泡内对白文字)
 * 2: text_free (艺术字、拟声词SFX、浮空手写字、大标题)
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

  data class ComicDetection(
    val bounds: Rect,
    val category: Int,     // 0: bubble, 1: text_bubble, 2: text_free
    val labelName: String, // "bubble" | "text_bubble" | "text_free"
    val score: Float
  )

  /**
   * 初始化 ONNX Runtime 推理环境与模型会话 (首次调用懒加载)
   */
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

      // 将模型以流方式安全缓存到 filesDir，避免 11MB 堆内存分配，并通过 mmap 极速加载
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
   * 端侧推理：检测图像中的漫画气泡与艺术字/自由文本框
   * @param bitmap 待识别图像 (原分辨率)
   * @param context Android 上下文 (用于加载 assets)
   * @param scoreThreshold 气泡与常规文本置信度过滤阈值 (推荐 0.28f ~ 0.30f)
   * @param artScoreThreshold 艺术字/自由文本/拟声词分类放宽阈值 (方法2：动态分类阈值，推荐 0.18f ~ 0.20f)
   * @return 高精度漫画文本与艺术字检测框列表
   */
  fun detect(
    bitmap: Bitmap,
    context: Context? = null,
    scoreThreshold: Float = 0.28f,
    artScoreThreshold: Float = 0.18f
  ): List<ComicDetection> {
    val ctx = context?.applicationContext ?: appContext ?: return emptyList()
    if (!isInitialized && !init(ctx)) {
      return emptyList()
    }

    val session = ortSession ?: return emptyList()
    val env = ortEnv ?: return emptyList()

    if (bitmap.width < 10 || bitmap.height < 10) return emptyList()

    val startTime = System.currentTimeMillis()
    val origW = bitmap.width
    val origH = bitmap.height

    return try {
      // 1. 等比拉伸输入至 640x640
      val scaledBitmap = if (origW == INPUT_SIZE && origH == INPUT_SIZE) {
        bitmap
      } else {
        Bitmap.createScaledBitmap(bitmap, INPUT_SIZE, INPUT_SIZE, true)
      }

      val totalPixels = INPUT_SIZE * INPUT_SIZE
      val pixels = IntArray(totalPixels)
      scaledBitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)
      if (scaledBitmap != bitmap) {
        scaledBitmap.recycle()
      }

      // 2. 构造 [1, 3, 640, 640] 的 NCHW FloatBuffer，像素值归一化至 [0, 1]
      val floatBuffer = FloatBuffer.allocate(1 * 3 * totalPixels)
      // R 通道
      for (i in 0 until totalPixels) {
        floatBuffer.put(((pixels[i] shr 16) and 0xFF) / 255.0f)
      }
      // G 通道
      for (i in 0 until totalPixels) {
        floatBuffer.put(((pixels[i] shr 8) and 0xFF) / 255.0f)
      }
      // B 通道
      for (i in 0 until totalPixels) {
        floatBuffer.put((pixels[i] and 0xFF) / 255.0f)
      }
      floatBuffer.rewind()

      val imagesTensor = OnnxTensor.createTensor(
        env,
        floatBuffer,
        longArrayOf(1, 3, INPUT_SIZE.toLong(), INPUT_SIZE.toLong())
      )

      // 3. 构造 orig_target_sizes [1, 2]，传入原图物理尺寸 [origW, origH] (匹配 ONNX 内部 Tile 乘积顺序)
      val sizesBuffer = LongBuffer.wrap(longArrayOf(origW.toLong(), origH.toLong()))
      val sizesTensor = OnnxTensor.createTensor(env, sizesBuffer, longArrayOf(1, 2))

      val inputs = mapOf(
        "images" to imagesTensor,
        "orig_target_sizes" to sizesTensor
      )

      val results = session.run(inputs)
      val detections = mutableListOf<ComicDetection>()

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

          val totalDetections = minOf(labelsBuf.remaining(), scoresBuf.remaining(), boxesBuf.remaining() / 4)
          for (i in 0 until totalDetections) {
            val score = scoresBuf.get(i)
            val cat = labelsBuf.get(i).toInt()

            // 方法 2 核心：分类别动态置信度过滤 (text_free 艺术字/大标题放宽至 0.18f，常规气泡保持 0.28f)
            val effectiveThreshold = when (cat) {
              2 -> artScoreThreshold // 艺术字/拟声词/自由文本放宽
              1 -> scoreThreshold    // 气泡内标准对白
              else -> scoreThreshold // 气泡轮廓
            }
            if (score < effectiveThreshold) continue

            val x1 = boxesBuf.get(i * 4 + 0).toInt().coerceIn(0, origW)
            val y1 = boxesBuf.get(i * 4 + 1).toInt().coerceIn(0, origH)
            val x2 = boxesBuf.get(i * 4 + 2).toInt().coerceIn(0, origW)
            val y2 = boxesBuf.get(i * 4 + 3).toInt().coerceIn(0, origH)

            val w = x2 - x1
            val h = y2 - y1
            // 过滤极小噪点
            if (w < 10 || h < 10) continue

            val labelName = when (cat) {
              0 -> "bubble"
              1 -> "text_bubble"
              2 -> "text_free"
              else -> "text_free"
            }

            detections.add(
              ComicDetection(
                bounds = Rect(min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)),
                category = cat,
                labelName = labelName,
                score = score
              )
            )
          }
        }
      } finally {
        imagesTensor.close()
        sizesTensor.close()
        results.close()
      }

      val duration = System.currentTimeMillis() - startTime
      lastInferenceTimeMs = duration
      lastDetectionCount = detections.size
      Log.i(TAG, "ComicTextDetector 推理完成: 检出 ${detections.size} 个目标 (耗时 ${duration}ms, 气泡=${detections.count { it.category == 0 }}, 文本=${detections.count { it.category == 1 }}, 艺术字/拟声词=${detections.count { it.category == 2 }})")

      detections
    } catch (e: Exception) {
      Log.e(TAG, "ComicTextDetector inference failed", e)
      emptyList()
    }
  }
}
