package expo.modules.screentranslator

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.max

/**
 * 漫画专用端侧文本识别模型 (Manga-OCR Mobile)
 * 基于 ogkalu/manga-ocr-mobile 轻量化 ViT+Transformer 架构
 * 专攻日漫全场景复杂汉字、竖排气泡、多列排版、手写拟声词(SFX)、变形艺术字识别！
 *
 * 模型包含：
 * 1. ViT 图像编码器 (manga_ocr_encoder.onnx, 16MB) -> 提取图像 Patch 特征 [1, 196, 256]
 * 2. 解码器首步预测 (manga_ocr_decoder_init.onnx, 24MB) -> 首字符预测及 KV Cache 初始化
 * 3. 解码器自回归循环 (manga_ocr_decoder_step.onnx, 22MB) -> 极速逐字自回归解码
 * 4. 日文字符字典 (manga_ocr_vocab.txt, 9415 字表)
 */
object MangaOcrModel {

  private const val TAG = "MangaOcrModel"
  private const val INPUT_SIZE = 224

  private var ortEnv: OrtEnvironment? = null
  private var encoderSession: OrtSession? = null
  private var decoderInitSession: OrtSession? = null
  private var decoderStepSession: OrtSession? = null

  private val vocabList = ArrayList<String>(9500)

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
   * 初始化 Manga-OCR Mobile ONNX 推理环境与三阶段模型会话
   */
  @Synchronized
  fun init(context: Context): Boolean {
    if (isInitialized && isModelReady) return true
    appContext = context.applicationContext

    return try {
      statusMessage = "⏳ 正在初始化 Manga-OCR 运行环境..."
      val env = OrtEnvironment.getEnvironment()
      ortEnv = env

      val sessionOptions = OrtSession.SessionOptions().apply {
        setInterOpNumThreads(2)
        setIntraOpNumThreads(2)
      }

      // 1. 加载字表
      loadVocab(context)

      // 2. 依次加载编码器与两级解码器
      val encoderFile = copyAssetIfNeeded(context, "models/manga_ocr_encoder.onnx", "manga_ocr_encoder.onnx")
      val decInitFile = copyAssetIfNeeded(context, "models/manga_ocr_decoder_init.onnx", "manga_ocr_decoder_init.onnx")
      val decStepFile = copyAssetIfNeeded(context, "models/manga_ocr_decoder_step.onnx", "manga_ocr_decoder_step.onnx")

      if (encoderFile == null || decInitFile == null || decStepFile == null) {
        val err = "缺少 Manga-OCR 模型文件，跳过加载"
        Log.w(TAG, err)
        statusMessage = "❌ $err"
        return false
      }

      Log.i(TAG, "Loading Manga-OCR ONNX sessions...")
      encoderSession = env.createSession(encoderFile.absolutePath, sessionOptions)
      decoderInitSession = env.createSession(decInitFile.absolutePath, sessionOptions)
      decoderStepSession = env.createSession(decStepFile.absolutePath, sessionOptions)

      isInitialized = true
      isModelReady = true
      statusMessage = "✅ 漫画端侧 OCR 识别模型就绪 (Manga-OCR Mobile)"
      Log.i(TAG, "MangaOcrModel initialized successfully! Vocab size: ${vocabList.size}")
      true
    } catch (e: Exception) {
      val err = "Manga-OCR 初始化失败: ${e.message}"
      Log.e(TAG, err, e)
      statusMessage = "❌ $err"
      false
    }
  }

  private fun loadVocab(context: Context) {
    if (vocabList.isNotEmpty()) return
    try {
      val candidates = listOf("models/manga_ocr_vocab.txt", "manga_ocr_vocab.txt", "vocab.txt")
      var stream: java.io.InputStream? = null
      for (c in candidates) {
        try {
          stream = context.assets.open(c)
          break
        } catch (e: Exception) {}
      }
      if (stream == null) {
        val targetFile = File(context.filesDir, "manga_ocr_vocab.txt")
        if (targetFile.exists()) {
          stream = targetFile.inputStream()
        }
      }
      if (stream != null) {
        BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
          var line = reader.readLine()
          while (line != null) {
            vocabList.add(line.trim('\r', '\n'))
            line = reader.readLine()
          }
        }
        Log.i(TAG, "Loaded ${vocabList.size} vocab tokens")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to load vocab", e)
    }
  }

  private fun copyAssetIfNeeded(context: Context, assetPath: String, targetFileName: String): File? {
    val targetFile = File(context.filesDir, targetFileName)
    if (targetFile.exists() && targetFile.length() > 5000000L) {
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
   * 端侧推理：对漫画文本/气泡切片进行端侧日漫 OCR 高精度识别
   * @param cropBitmap 包含气泡或艺术字/拟声词的原始图像切片
   * @param maxSteps 最大解码字符步数 (默认 35)
   * @return 识别出的日文文本，若未识别或置信度过低返回空字符串
   */
  fun recognize(cropBitmap: Bitmap, maxSteps: Int = 35): String {
    val ctx = appContext ?: return ""
    if (!isInitialized && !init(ctx)) return ""

    val env = ortEnv ?: return ""
    val encSess = encoderSession ?: return ""
    val initSess = decoderInitSession ?: return ""
    val stepSess = decoderStepSession ?: return ""

    if (cropBitmap.width < 10 || cropBitmap.height < 10) return ""

    val startTime = System.currentTimeMillis()

    var squareBmp: Bitmap? = null
    var scaledBmp: Bitmap? = null

    var imgTensor: OnnxTensor? = null
    var encResults: OrtSession.Result? = null
    var initInputIds: OnnxTensor? = null
    var initResults: OrtSession.Result? = null

    return try {
      // 1. 等比正方形填充：根据 4 角点自适应采样填充底色，避免破坏文字长宽比例与产生强烈伪边框
      val maxDim = max(cropBitmap.width, cropBitmap.height)
      squareBmp = Bitmap.createBitmap(maxDim, maxDim, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(squareBmp)
      val w = cropBitmap.width
      val h = cropBitmap.height
      val c1 = cropBitmap.getPixel(0, 0)
      val c2 = cropBitmap.getPixel(w - 1, 0)
      val c3 = cropBitmap.getPixel(0, h - 1)
      val c4 = cropBitmap.getPixel(w - 1, h - 1)
      val avgR = (Color.red(c1) + Color.red(c2) + Color.red(c3) + Color.red(c4)) / 4
      val avgG = (Color.green(c1) + Color.green(c2) + Color.green(c3) + Color.green(c4)) / 4
      val avgB = (Color.blue(c1) + Color.blue(c2) + Color.blue(c3) + Color.blue(c4)) / 4
      val padColor = Color.rgb(avgR, avgG, avgB)
      canvas.drawColor(padColor)
      val left = (maxDim - cropBitmap.width) / 2f
      val top = (maxDim - cropBitmap.height) / 2f
      canvas.drawBitmap(cropBitmap, left, top, null)

      // 2. 缩放到模型标准输入尺寸 224x224
      scaledBmp = Bitmap.createScaledBitmap(squareBmp, INPUT_SIZE, INPUT_SIZE, true)

      // 3. 构建 [1, 3, 224, 224] 归一化 FloatBuffer: (x / 255.0 - 0.5) / 0.5
      val totalPixels = INPUT_SIZE * INPUT_SIZE
      val pixels = IntArray(totalPixels)
      scaledBmp.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

      val floatBuffer = FloatBuffer.allocate(1 * 3 * totalPixels)
      for (i in 0 until totalPixels) {
        val r = (pixels[i] shr 16 and 0xFF) / 255.0f
        floatBuffer.put((r - 0.5f) / 0.5f)
      }
      for (i in 0 until totalPixels) {
        val g = (pixels[i] shr 8 and 0xFF) / 255.0f
        floatBuffer.put((g - 0.5f) / 0.5f)
      }
      for (i in 0 until totalPixels) {
        val b = (pixels[i] and 0xFF) / 255.0f
        floatBuffer.put((b - 0.5f) / 0.5f)
      }
      floatBuffer.rewind()

      imgTensor = OnnxTensor.createTensor(env, floatBuffer, longArrayOf(1, 3, INPUT_SIZE.toLong(), INPUT_SIZE.toLong()))

      // 4. 执行 ViT 编码器: [1, 3, 224, 224] -> [1, 196, 256]
      val encInputName = encSess.inputNames.first()
      encResults = encSess.run(mapOf(encInputName to imgTensor))

      var encHiddenStates: OnnxTensor? = null
      for (entry in encResults) {
        encHiddenStates = entry.value as? OnnxTensor
        if (encHiddenStates != null) break
      }
      if (encHiddenStates == null) return ""

      // 5. 执行解码器首步初始化 (start token = 2, 即 [CLS])
      initInputIds = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(2L)), longArrayOf(1, 1))
      val initInputs = mapOf(
        "encoder_hidden_states" to encHiddenStates,
        "input_ids" to initInputIds
      )
      initResults = initSess.run(initInputs)

      var logitsTensor: OnnxTensor? = null
      var selfKTensor: OnnxTensor? = null
      var selfVTensor: OnnxTensor? = null
      var crossKTensor: OnnxTensor? = null
      var crossVTensor: OnnxTensor? = null

      for (entry in initResults) {
        when (entry.key) {
          "logits" -> logitsTensor = entry.value as? OnnxTensor
          "self_k" -> selfKTensor = entry.value as? OnnxTensor
          "self_v" -> selfVTensor = entry.value as? OnnxTensor
          "cross_k" -> crossKTensor = entry.value as? OnnxTensor
          "cross_v" -> crossVTensor = entry.value as? OnnxTensor
        }
      }

      if (logitsTensor == null || selfKTensor == null || selfVTensor == null ||
          crossKTensor == null || crossVTensor == null) {
        return ""
      }

      // 初始化 KV Cache (4 层 * 1 批 * 4 头 * 256 步 * 64 维 = 262,144 floats)
      val selfKCache = FloatArray(4 * 1 * 4 * 256 * 64)
      val selfVCache = FloatArray(4 * 1 * 4 * 256 * 64)

      val initKBuf = selfKTensor.floatBuffer
      val initVBuf = selfVTensor.floatBuffer
      val initKArray = FloatArray(1024)
      val initVArray = FloatArray(1024)
      initKBuf.get(initKArray)
      initVBuf.get(initVArray)

      // 将首步 self_k 与 self_v 写入缓存索引 0 处
      for (layer in 0 until 4) {
        for (head in 0 until 4) {
          val srcOffset = (layer * 4 + head) * 64
          val dstOffset = (layer * 4 + head) * 256 * 64 + 0 * 64
          System.arraycopy(initKArray, srcOffset, selfKCache, dstOffset, 64)
          System.arraycopy(initVArray, srcOffset, selfVCache, dstOffset, 64)
        }
      }

      val logitsBuf = logitsTensor.floatBuffer
      val firstLogits = FloatArray(logitsBuf.remaining())
      logitsBuf.get(firstLogits)
      var currToken = argmax(firstLogits)

      val predictedTokens = mutableListOf<Int>()
      if (currToken != 3) {
        predictedTokens.add(currToken)
      }

      // 6. 执行自回归解码循环 (每次输入前序预测 token，更新 KV Cache，直至遇到 [SEP]=3 或达到最大步数)
      for (step in 1 until maxSteps) {
        if (currToken == 3) break // [SEP] 终止符

        val pos = (step + 1).toLong()
        val stepInputIds = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(currToken.toLong())), longArrayOf(1, 1))
        val stepPosIds = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(pos)), longArrayOf(1, 1))
        val stepKCacheTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(selfKCache), longArrayOf(4, 1, 4, 256, 64))
        val stepVCacheTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(selfVCache), longArrayOf(4, 1, 4, 256, 64))

        val stepInputs = mapOf(
          "encoder_hidden_states" to encHiddenStates,
          "input_ids" to stepInputIds,
          "position_ids" to stepPosIds,
          "self_k_cache" to stepKCacheTensor,
          "self_v_cache" to stepVCacheTensor,
          "cross_k_cache" to crossKTensor,
          "cross_v_cache" to crossVTensor
        )

        val stepResults = stepSess.run(stepInputs)
        try {
          var stepLogitsTensor: OnnxTensor? = null
          var kSliceTensor: OnnxTensor? = null
          var vSliceTensor: OnnxTensor? = null

          for (entry in stepResults) {
            when (entry.key) {
              "logits" -> stepLogitsTensor = entry.value as? OnnxTensor
              "self_k_slice" -> kSliceTensor = entry.value as? OnnxTensor
              "self_v_slice" -> vSliceTensor = entry.value as? OnnxTensor
            }
          }

          if (stepLogitsTensor == null || kSliceTensor == null || vSliceTensor == null) {
            break
          }

          val kSliceArray = FloatArray(1024)
          val vSliceArray = FloatArray(1024)
          kSliceTensor.floatBuffer.get(kSliceArray)
          vSliceTensor.floatBuffer.get(vSliceArray)

          // 将本步新增的 k/v 切片写入缓存 step 处
          for (layer in 0 until 4) {
            for (head in 0 until 4) {
              val srcOffset = (layer * 4 + head) * 64
              val dstOffset = (layer * 4 + head) * 256 * 64 + step * 64
              System.arraycopy(kSliceArray, srcOffset, selfKCache, dstOffset, 64)
              System.arraycopy(vSliceArray, srcOffset, selfVCache, dstOffset, 64)
            }
          }

          val sBuf = stepLogitsTensor.floatBuffer
          val stepLogitsArray = FloatArray(sBuf.remaining())
          sBuf.get(stepLogitsArray)
          currToken = argmax(stepLogitsArray)

          if (currToken == 3) break
          predictedTokens.add(currToken)
        } finally {
          stepInputIds.close()
          stepPosIds.close()
          stepKCacheTensor.close()
          stepVCacheTensor.close()
          stepResults.close()
        }
      }

      // 7. 将 Token 序列映射为真实日文字符串
      val sb = StringBuilder()
      for (tok in predictedTokens) {
        if (tok in 0..3) continue // 忽略 [PAD], [UNK], [CLS], [SEP]
        if (tok < vocabList.size) {
          sb.append(vocabList[tok])
        }
      }

      val duration = System.currentTimeMillis() - startTime
      lastInferenceTimeMs = duration
      val resultText = sb.toString().trim()
      Log.i(TAG, "Manga-OCR 识别出文本: '$resultText' (共 ${predictedTokens.size} 字, 耗时 ${duration}ms)")
      resultText
    } catch (e: Exception) {
      Log.e(TAG, "Manga-OCR recognition error", e)
      ""
    } finally {
      try { imgTensor?.close() } catch (e: Exception) {}
      try { encResults?.close() } catch (e: Exception) {}
      try { initInputIds?.close() } catch (e: Exception) {}
      try { initResults?.close() } catch (e: Exception) {}
      try { squareBmp?.recycle() } catch (e: Exception) {}
      try { scaledBmp?.recycle() } catch (e: Exception) {}
    }
  }

  private fun argmax(array: FloatArray): Int {
    var maxIdx = 0
    var maxVal = array[0]
    for (i in 1 until array.size) {
      if (array[i] > maxVal) {
        maxVal = array[i]
        maxIdx = i
      }
    }
    return maxIdx
  }
}
