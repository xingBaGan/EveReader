package expo.modules.screentranslator

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.RectF
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.nio.FloatBuffer
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 字符级坐标与原生阅读顺序漫画 OCR 模型 (Manga-OCR CharSpot Small)
 * 基于 muscgab/manga-ocr-charspot-small (11M 参数，单图单会话 ONNX 架构)
 *
 * 核心特性：
 * 1. 单次前向同时输出：字符包围盒 (boxes)、置信度 (scores)、类别索引 (ids)、阅读顺序 (order)
 * 2. 模型内部排序头原生习得多列竖排从右向左、从上至下的标准日漫阅读顺序
 * 3. 彻底告别自回归 KV-Cache 循环与无中生有大段幻觉，单框推理进入 25ms 时代！
 */
object MangaOcrModel {

  private const val TAG = "MangaOcrModel"
  private const val MODEL_ASSET_PATH = "models/manga_ocr_charspot_small.onnx"
  private const val VOCAB_ASSET_PATH = "models/charspot_vocab.json"
  private const val TARGET_MODEL_FILE = "manga_ocr_charspot_small.onnx"

  private const val CELL = 16
  private const val BUDGET = 256
  private const val N_CLS = 6818

  // 漫画竖排常用叠标标点组合 (tate-chu-yoko !? glyphs)
  private val COMBOS = listOf(
    "!!", "!?", "?!", "??",
    "!!!", "!!?", "!?!", "!??", "?!!", "?!?", "??!", "???"
  )

  data class CharBox(
    val char: String,
    val score: Float,
    val box: RectF
  )

  data class OcrResult(
    val text: String,
    val chars: List<CharBox>,
    val avgScore: Float
  )

  private var ortEnv: OrtEnvironment? = null
  private var ortSession: OrtSession? = null
  private val vocabList = ArrayList<String>(6850)

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
  var appContext: Context? = null

  /**
   * 初始化 CharSpot ONNX 推理环境与单会话
   */
  @Synchronized
  fun init(context: Context): Boolean {
    if (isInitialized && isModelReady && ortSession != null) return true
    appContext = context.applicationContext

    return try {
      statusMessage = "⏳ 正在初始化 CharSpot 漫画 OCR 运行环境..."
      val env = OrtEnvironment.getEnvironment()
      ortEnv = env

      val sessionOptions = OrtSession.SessionOptions().apply {
        setInterOpNumThreads(1)
        setIntraOpNumThreads(min(4, Runtime.getRuntime().availableProcessors()))
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }

      // 1. 加载字表
      loadVocab(context)

      // 2. 加载单图 CharSpot ONNX 模型
      val modelFile = copyAssetIfNeeded(context, MODEL_ASSET_PATH, TARGET_MODEL_FILE)
      if (modelFile == null || !modelFile.exists() || modelFile.length() < 10000000L) {
        val err = "缺少 CharSpot 模型文件 ($MODEL_ASSET_PATH)，跳过加载"
        Log.w(TAG, err)
        statusMessage = "❌ $err"
        return false
      }

      Log.i(TAG, "Loading CharSpot ONNX session from ${modelFile.absolutePath} (${modelFile.length() / 1024} KB)...")
      ortSession = env.createSession(modelFile.absolutePath, sessionOptions)

      isInitialized = true
      isModelReady = true
      statusMessage = "✅ 漫画端侧 OCR 模型就绪 (CharSpot-Small)"
      Log.i(TAG, "MangaOcrModel initialized successfully! Vocab size: ${vocabList.size}")
      true
    } catch (e: Exception) {
      val err = "CharSpot 初始化失败: ${e.message}"
      Log.e(TAG, err, e)
      statusMessage = "❌ $err"
      false
    }
  }

  /**
   * 加载 CharSpot 字典与特殊标点字符映射
   */
  private fun loadVocab(context: Context) {
    if (vocabList.isNotEmpty()) return
    try {
      val candidates = listOf(VOCAB_ASSET_PATH, "charspot_vocab.json", "vocab.json")
      var jsonStr: String? = null
      for (c in candidates) {
        try {
          context.assets.open(c).use { stream ->
            BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
              jsonStr = reader.readText()
            }
          }
          if (jsonStr != null) break
        } catch (e: Exception) {}
      }

      if (jsonStr == null) {
        val localFile = File(context.filesDir, "charspot_vocab.json")
        if (localFile.exists()) {
          jsonStr = localFile.readText(Charsets.UTF_8)
        }
      }

      if (jsonStr != null) {
        val root = JSONObject(jsonStr!!)
        val charsArray = root.getJSONArray("characters")
        val loadedChars = ArrayList<String>(charsArray.length() + 30)
        for (i in 0 until charsArray.length()) {
          loadedChars.add(charsArray.getString(i))
        }

        vocabList.clear()
        vocabList.addAll(loadedChars)
        // 补齐至 n_cls (6818)
        while (vocabList.size < N_CLS) {
          vocabList.add("")
        }
        // 追加 COMBOS (12 个双/三重感叹问号字符)
        vocabList.addAll(COMBOS)
        Log.i(TAG, "Loaded ${vocabList.size} vocab tokens (characters: ${loadedChars.size}, total with combos: ${vocabList.size})")
      } else {
        Log.e(TAG, "Failed to find charspot_vocab.json asset!")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to load charspot vocab", e)
    }
  }

  private fun copyAssetIfNeeded(context: Context, assetPath: String, targetFileName: String): File? {
    val targetFile = File(context.filesDir, targetFileName)
    if (targetFile.exists() && targetFile.length() > 20000000L) {
      return targetFile
    }

    var assetStream: java.io.InputStream? = null
    val candidates = listOf(assetPath, targetFileName)
    for (cand in candidates) {
      try {
        assetStream = context.assets.open(cand)
        break
      } catch (e: Exception) {}
    }

    if (assetStream == null) {
      Log.e(TAG, "Asset not found: $assetPath")
      return null
    }

    return try {
      assetStream.use { input ->
        FileOutputStream(targetFile).use { output ->
          input.copyTo(output)
        }
      }
      targetFile
    } catch (e: Exception) {
      Log.e(TAG, "Failed to copy asset $assetPath", e)
      null
    }
  }

  /**
   * 动态网格缩放比例搜索算法 (padGrid)
   * 寻找在 14px 网格下不超过 budget cells (256) 的最大缩放因子，
   * 最终在 16px 单元格尺寸下建立贴合纵横比的最优画布。
   */
  private fun padGrid(height: Int, width: Int, budget: Int = BUDGET): Triple<Float, Int, Int> {
    var lo = 1e-4f
    var hi = 1000.0f
    for (i in 0 until 60) {
      val mid = (lo + hi) / 2f
      val gh = ceil(height * mid / 14f).toInt()
      val gw = ceil(width * mid / 14f).toInt()
      if (gh * gw <= budget) {
        lo = mid
      } else {
        hi = mid
      }
    }
    val scale = lo * CELL / 14f
    val gridH = ceil(height * lo / 14f).toInt()
    val gridW = ceil(width * lo / 14f).toInt()
    return Triple(scale, gridH, gridW)
  }

  /**
   * 计算四边像素的中位数颜色 (Median Border Color)
   */
  private fun calculateMedianBorderColor(bitmap: Bitmap, rw: Int, rh: Int): Int {
    val borderR = ArrayList<Int>((rw + rh) * 2)
    val borderG = ArrayList<Int>((rw + rh) * 2)
    val borderB = ArrayList<Int>((rw + rh) * 2)

    for (x in 0 until rw) {
      val pTop = bitmap.getPixel(x, 0)
      borderR.add(Color.red(pTop))
      borderG.add(Color.green(pTop))
      borderB.add(Color.blue(pTop))

      val pBottom = bitmap.getPixel(x, rh - 1)
      borderR.add(Color.red(pBottom))
      borderG.add(Color.green(pBottom))
      borderB.add(Color.blue(pBottom))
    }

    for (y in 0 until rh) {
      val pLeft = bitmap.getPixel(0, y)
      borderR.add(Color.red(pLeft))
      borderG.add(Color.green(pLeft))
      borderB.add(Color.blue(pLeft))

      val pRight = bitmap.getPixel(rw - 1, y)
      borderR.add(Color.red(pRight))
      borderG.add(Color.green(pRight))
      borderB.add(Color.blue(pRight))
    }

    borderR.sort()
    borderG.sort()
    borderB.sort()

    val mid = borderR.size / 2
    return Color.rgb(borderR[mid], borderG[mid], borderB[mid])
  }

  /**
   * 端侧推理核心：对漫画文本/气泡切片进行 CharSpot 单次前向识别
   * @param cropBitmap 原始切片图像 (Bitmap)
   * @return 包含文本、字符级坐标、各字符置信度与平均得分的 OcrResult
   */
  fun recognizeDetail(cropBitmap: Bitmap): OcrResult {
    val ctx = appContext ?: return OcrResult("", emptyList(), 0f)
    if (!isInitialized && !init(ctx)) return OcrResult("", emptyList(), 0f)

    val env = ortEnv ?: return OcrResult("", emptyList(), 0f)
    val session = ortSession ?: return OcrResult("", emptyList(), 0f)

    if (cropBitmap.width < 8 || cropBitmap.height < 8) {
      return OcrResult("", emptyList(), 0f)
    }

    val startTime = System.currentTimeMillis()

    var scaledBmp: Bitmap? = null
    var paddedBmp: Bitmap? = null
    var imgTensor: OnnxTensor? = null
    var runResults: OrtSession.Result? = null

    return try {
      val origW = cropBitmap.width
      val origH = cropBitmap.height

      // 1. 动态网格等比尺度与画布大小推导
      val (scale, gh, gw) = padGrid(origH, origW)
      val canvasW = gw * CELL
      val canvasH = gh * CELL

      val rw = max(1, min(canvasW, (origW * scale).roundToInt()))
      val rh = max(1, min(canvasH, (origH * scale).roundToInt()))

      // 2. 双线性平滑缩放至 (rw, rh)
      scaledBmp = Bitmap.createScaledBitmap(cropBitmap, rw, rh, true)

      // 3. 计算四周边界中位数底色，填充画布避免边界硬截断伪影
      val padColor = calculateMedianBorderColor(scaledBmp, rw, rh)
      paddedBmp = Bitmap.createBitmap(canvasW, canvasH, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(paddedBmp)
      canvas.drawColor(padColor)
      canvas.drawBitmap(scaledBmp, 0f, 0f, null)

      // 4. 构建 FloatBuffer [1, 3, canvasH, canvasW] (注意：模型需要 raw 0-255 RGB 像素浮点值！)
      val totalPixels = canvasW * canvasH
      val pixels = IntArray(totalPixels)
      paddedBmp.getPixels(pixels, 0, canvasW, 0, 0, canvasW, canvasH)

      val floatBuffer = FloatBuffer.allocate(1 * 3 * totalPixels)
      // Channel R
      for (i in 0 until totalPixels) {
        floatBuffer.put((pixels[i] shr 16 and 0xFF).toFloat())
      }
      // Channel G
      for (i in 0 until totalPixels) {
        floatBuffer.put((pixels[i] shr 8 and 0xFF).toFloat())
      }
      // Channel B
      for (i in 0 until totalPixels) {
        floatBuffer.put((pixels[i] and 0xFF).toFloat())
      }
      floatBuffer.rewind()

      imgTensor = OnnxTensor.createTensor(
        env,
        floatBuffer,
        longArrayOf(1, 3, canvasH.toLong(), canvasW.toLong())
      )

      // 5. 单次前向推理：直接产出 boxes, scores, ids, order
      runResults = session.run(mapOf("img" to imgTensor))

      var boxesTensor: OnnxTensor? = null
      var scoresTensor: OnnxTensor? = null
      var idsTensor: OnnxTensor? = null
      var orderTensor: OnnxTensor? = null

      for (entry in runResults) {
        when (entry.key) {
          "boxes" -> boxesTensor = entry.value as? OnnxTensor
          "scores" -> scoresTensor = entry.value as? OnnxTensor
          "ids" -> idsTensor = entry.value as? OnnxTensor
          "order" -> orderTensor = entry.value as? OnnxTensor
        }
      }

      if (boxesTensor == null || scoresTensor == null || idsTensor == null || orderTensor == null) {
        Log.w(TAG, "CharSpot ONNX outputs missing required nodes")
        return OcrResult("", emptyList(), 0f)
      }

      val orderLongs = orderTensor.longBuffer
      val numChars = orderLongs.remaining()
      if (numChars == 0) {
        return OcrResult("", emptyList(), 0f)
      }

      val orderArray = LongArray(numChars)
      orderLongs.get(orderArray)

      val boxesBuf = boxesTensor.floatBuffer
      val totalBoxesVals = boxesBuf.remaining()
      val boxesArray = FloatArray(totalBoxesVals)
      boxesBuf.get(boxesArray)

      val scoresBuf = scoresTensor.floatBuffer
      val scoresArray = FloatArray(scoresBuf.remaining())
      scoresBuf.get(scoresArray)

      val idsBuf = idsTensor.longBuffer
      val idsArray = LongArray(idsBuf.remaining())
      idsBuf.get(idsArray)

      // 6. 坐标映射因子：模型输入图像像素坐标 -> 原 cropBitmap 像素坐标
      val fx = origW.toFloat() / rw.toFloat()
      val fy = origH.toFloat() / rh.toFloat()

      val charBoxes = ArrayList<CharBox>(numChars)
      val sb = StringBuilder(numChars)

      // 7. 按照 order 预测顺序逐字还原（原生具备多列从右至左、自上而下阅读顺序）
      for (i in 0 until numChars) {
        val k = orderArray[i].toInt()
        if (k < 0 || k >= scoresArray.size || k >= idsArray.size) continue

        val charId = idsArray[k].toInt()
        val charStr = if (charId in 0 until vocabList.size) vocabList[charId] else ""
        if (charStr.isEmpty()) continue

        val score = scoresArray[k]

        // 提取 [x0, y0, x1, y1]
        val bOffset = k * 4
        if (bOffset + 3 < boxesArray.size) {
          val x0 = boxesArray[bOffset] * fx
          val y0 = boxesArray[bOffset + 1] * fy
          val x1 = boxesArray[bOffset + 2] * fx
          val y1 = boxesArray[bOffset + 3] * fy
          val rectF = RectF(
            max(0f, min(origW.toFloat(), x0)),
            max(0f, min(origH.toFloat(), y0)),
            max(0f, min(origW.toFloat(), x1)),
            max(0f, min(origH.toFloat(), y1))
          )
          charBoxes.add(CharBox(char = charStr, score = score, box = rectF))
        } else {
          charBoxes.add(CharBox(char = charStr, score = score, box = RectF(0f, 0f, 0f, 0f)))
        }

        sb.append(charStr)
      }

      val duration = System.currentTimeMillis() - startTime
      lastInferenceTimeMs = duration

      val finalText = sb.toString().trim()
      val avgScore = if (charBoxes.isNotEmpty()) {
        charBoxes.map { it.score }.average().toFloat()
      } else {
        0f
      }

      Log.i(TAG, "CharSpot OCR output: '$finalText' (chars=${charBoxes.size}, avgScore=$avgScore, time=${duration}ms)")
      OcrResult(text = finalText, chars = charBoxes, avgScore = avgScore)
    } catch (e: Exception) {
      Log.e(TAG, "CharSpot recognition error", e)
      OcrResult("", emptyList(), 0f)
    } finally {
      try { imgTensor?.close() } catch (e: Exception) {}
      try { runResults?.close() } catch (e: Exception) {}
      try { scaledBmp?.recycle() } catch (e: Exception) {}
      try { paddedBmp?.recycle() } catch (e: Exception) {}
    }
  }

  /**
   * 兼容旧接口：快速返回识别出的日文字符串
   */
  fun recognize(cropBitmap: Bitmap): String {
    return recognizeDetail(cropBitmap).text
  }
}
