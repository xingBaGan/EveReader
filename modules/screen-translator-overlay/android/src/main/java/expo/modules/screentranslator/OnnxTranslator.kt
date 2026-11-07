package expo.modules.screentranslator

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min

/**
 * ONNX Runtime 端侧本地漫画翻译推理引擎 (OnnxTranslator)
 * 特性：
 * 1. 基于 ONNX Runtime 跨平台高性能张量计算库
 * 2. 真实加载 JMangaTranslator-Fast v1 离线翻译包 (Fast int8 / Fast mixed)
 * 3. ModernBERT-ja Unigram 分词 + Encoder 交叉注意力投影 + Decoder 自回归单步推理 + SentencePiece 中文反分词
 * 推理契约参考 muscgab/JMangaTranslator-Fast 的 jmt_fast/common.py (MIT)。
 * 4. 翻译推理完全在本地执行
 */
object OnnxTranslator {

  private const val TAG = "OnnxTranslator"
  private const val PREFS_NAME = "expo_screen_translator_onnx"
  private const val KEY_ACTIVE_MODEL = "active_model_filename"

  // 全局同步锁，串行化会话初始化、切换模型、单句推理、批量推理与释放
  private val sessionLock = Any()

  private var ortEnv: OrtEnvironment? = null
  private var encoderSession: OrtSession? = null
  private var decoderSession: OrtSession? = null

  private var fastTokenizer: FastTokenizer? = null
  private var fastHostTensors: FastNpzReader? = null
  private var fastSpDecoder: FastSentencePiece? = null

  @Volatile
  var isModelReady = false
    private set

  @Volatile
  var statusMessage: String = "未初始化"
    private set

  @Volatile
  var modelType: String = "none" // "seq2seq" | "none"
    private set

  @Volatile
  var activeModelName: String? = null
    private set

  @Volatile
  var appContext: Context? = null

  /**
   * 获取用户当前指定的生效模型文件名
   */
  fun getActiveModelFileName(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(KEY_ACTIVE_MODEL, "") ?: ""
  }

  /**
   * 自主切换当前生效的端侧翻译模型并重新加载会话
   */
  fun setActiveModel(context: Context, modelFileName: String): Boolean = synchronized(sessionLock) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_ACTIVE_MODEL, modelFileName).apply()
    closeInternal()
    return initInternal(context)
  }

  /**
   * 初始化 ONNX Runtime 翻译模型运行环境
   */
  fun init(context: Context): Boolean = synchronized(sessionLock) {
    return initInternal(context)
  }

  private fun initInternal(context: Context): Boolean {
    if (isModelReady && encoderSession != null && decoderSession != null &&
      fastTokenizer != null && fastHostTensors != null && fastSpDecoder != null) {
      return true
    }
    appContext = context.applicationContext

    val sessionOptions = OrtSession.SessionOptions().apply {
      setInterOpNumThreads(1)
      setIntraOpNumThreads(min(4, Runtime.getRuntime().availableProcessors()))
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    }

    var newEncSession: OrtSession? = null
    var newDecSession: OrtSession? = null

    return try {
      statusMessage = "⏳ 正在初始化 ONNX Runtime 翻译模型环境..."
      val env = OrtEnvironment.getEnvironment()
      ortEnv = env

      val modelDir = File(context.filesDir, "models/translation")
      if (!modelDir.exists()) {
        modelDir.mkdirs()
      }

      val userPreferredName = getActiveModelFileName(context)
      val resolvedFiles = resolveModelPackFiles(modelDir, userPreferredName)

      if (resolvedFiles == null) {
        isModelReady = false
        activeModelName = null
        modelType = "none"
        statusMessage = "⚠️ 缺少必需的 Fast v1 翻译模型文件 (需包含 encoder/decoder/host/tokenizer/vocab/joint)"
        Log.w(TAG, statusMessage)
        return false
      }

      val encFile = resolvedFiles["encoder"]!!
      val decFile = resolvedFiles["decoder"]!!
      val hostFile = resolvedFiles["host"]!!
      val tokFile = resolvedFiles["tokenizer"]!!
      val jointFile = resolvedFiles["joint"]!!
      val vocabFile = resolvedFiles["vocab"]!!
      val cfgFile = resolvedFiles["config"]!!

      Log.i(TAG, "加载 Fast v1 翻译模型权重: enc=${encFile.name}, dec=${decFile.name}")

      newEncSession = env.createSession(encFile.absolutePath, sessionOptions)
      newDecSession = env.createSession(decFile.absolutePath, sessionOptions)

      val newTokenizer = FastTokenizer().apply {
        tokFile.inputStream().use { load(it) }
      }
      val newHost = FastNpzReader().apply {
        load(hostFile)
      }
      val newSp = FastSentencePiece().apply {
        load(jointFile, vocabFile, cfgFile)
      }

      // 释放先前旧会话 (保留全局 ortEnv，不 close 全局 env)
      encoderSession?.close()
      decoderSession?.close()

      encoderSession = newEncSession
      decoderSession = newDecSession
      fastTokenizer = newTokenizer
      fastHostTensors = newHost
      fastSpDecoder = newSp

      // 成功转移所有权
      newEncSession = null
      newDecSession = null

      activeModelName = encFile.name
      modelType = "seq2seq"
      isModelReady = true
      statusMessage = "✅ Fast v1 翻译模型就绪 (${encFile.name})"

      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().putString(KEY_ACTIVE_MODEL, encFile.name).apply()

      Log.i(TAG, statusMessage)
      true
    } catch (e: Exception) {
      val err = "初始化 ONNX 翻译模型失败: ${e.message}"
      Log.e(TAG, err, e)
      statusMessage = "❌ $err"
      isModelReady = false
      activeModelName = null
      modelType = "none"
      newEncSession?.close()
      newDecSession?.close()
      encoderSession?.close()
      decoderSession?.close()
      encoderSession = null
      decoderSession = null
      fastTokenizer = null
      fastHostTensors = null
      fastSpDecoder = null
      false
    } finally {
      try {
        sessionOptions.close()
      } catch (_: Exception) {}
    }
  }

  private fun resolveModelPackFiles(modelDir: File, preferredModelName: String): Map<String, File>? {
    val searchDirs = ArrayList<File>()
    searchDirs.add(modelDir)
    modelDir.listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") }?.forEach {
      searchDirs.add(it)
    }

    for (dir in searchDirs) {
      val encoderCandidates = if (preferredModelName.isNotBlank()) {
        listOf(
          File(dir, preferredModelName),
          File(dir, "onnx/$preferredModelName"),
          File(modelDir, preferredModelName),
          File(modelDir, "onnx/$preferredModelName")
        )
      } else {
        listOf(
          File(dir, "encoder_int8.onnx"),
          File(dir, "onnx/encoder_int8.onnx"),
          File(dir, "encoder_int4.onnx"),
          File(dir, "onnx/encoder_int4.onnx"),
          File(modelDir, "encoder_int8.onnx"),
          File(modelDir, "onnx/encoder_int8.onnx"),
          File(modelDir, "encoder_int4.onnx"),
          File(modelDir, "onnx/encoder_int4.onnx")
        )
      }

      val encFile = encoderCandidates.firstOrNull { it.exists() && it.length() > 1024 } ?: continue

      // Fast int8 与 Fast mixed 共用同一个 decoder_int8.onnx
      val decCandidates = listOf(
        File(dir, "decoder_int8.onnx"),
        File(dir, "onnx/decoder_int8.onnx"),
        File(modelDir, "decoder_int8.onnx"),
        File(modelDir, "onnx/decoder_int8.onnx")
      )
      val decFile = decCandidates.firstOrNull { it.exists() && it.length() > 1024 } ?: continue

      val hostCandidates = listOf(
        File(dir, "host_fp32.npz"),
        File(dir, "onnx/host_fp32.npz"),
        File(modelDir, "host_fp32.npz"),
        File(modelDir, "onnx/host_fp32.npz")
      )
      val hostFile = hostCandidates.firstOrNull { it.exists() && it.length() > 1024 } ?: continue

      val tokCandidates = listOf(
        File(dir, "tokenizer.json"),
        File(dir, "tokenizer/tokenizer.json"),
        File(modelDir, "tokenizer.json"),
        File(modelDir, "tokenizer/tokenizer.json")
      )
      val tokFile = tokCandidates.firstOrNull { it.exists() && it.length() > 1024 } ?: continue

      val jointCandidates = listOf(
        File(dir, "joint.model"),
        File(modelDir, "joint.model")
      )
      val jointFile = jointCandidates.firstOrNull { it.exists() && it.length() > 1024 } ?: continue

      val vocabCandidates = listOf(
        File(dir, "vocab.json"),
        File(modelDir, "vocab.json")
      )
      val vocabFile = vocabCandidates.firstOrNull { it.exists() && it.length() > 1024 } ?: continue

      val cfgCandidates = listOf(
        File(dir, "config.json"),
        File(modelDir, "config.json")
      )
      val cfgFile = cfgCandidates.firstOrNull { f ->
        if (!f.exists() || f.length() <= 10) false
        else {
          try {
            val txt = f.readText(Charsets.UTF_8)
            txt.contains("jmangatranslator", ignoreCase = true) || txt.contains("dec_layers")
          } catch (_: Exception) { false }
        }
      } ?: continue

      return mapOf(
        "encoder" to encFile,
        "decoder" to decFile,
        "host" to hostFile,
        "tokenizer" to tokFile,
        "joint" to jointFile,
        "vocab" to vocabFile,
        "config" to cfgFile
      )
    }

    return null
  }

  /**
   * 检查模型是否就绪及路径详情 (未就绪时自动尝试触发初始化扫描)
   */
  fun checkModelDetails(context: Context): Map<String, Any> {
    if (!isModelReady) {
      init(context)
    }
    val ready = isModelReady
    val dir = File(context.filesDir, "models/translation")
    val files = if (dir.exists()) dir.listFiles()?.map { it.name } ?: emptyList() else emptyList()
    val currentActive = activeModelName ?: getActiveModelFileName(context)
    return mapOf(
      "ready" to ready,
      "modelType" to modelType,
      "statusMessage" to statusMessage,
      "activeModel" to currentActive,
      "installedFiles" to files,
      "targetDirectory" to dir.absolutePath
    )
  }

  /**
   * 单句 ONNX 端侧本地翻译推理 (真实神经网络自回归，禁止假硬编码)
   */
  fun translate(rawText: String): String = synchronized(sessionLock) {
    val text = rawText.trim()
    if (text.isEmpty()) return ""

    val ctx = appContext
    if (ctx != null && !isModelReady) {
      initInternal(ctx)
    }

    if (!isModelReady || encoderSession == null || decoderSession == null ||
      fastTokenizer == null || fastHostTensors == null || fastSpDecoder == null) {
      throw IllegalStateException("ONNX 翻译模型尚未就绪: $statusMessage")
    }

    val env = ortEnv ?: throw IllegalStateException("OrtEnvironment 未初始化")
    val encSess = encoderSession ?: throw IllegalStateException("EncoderSession 为空")
    val decSess = decoderSession ?: throw IllegalStateException("DecoderSession 为空")
    val tok = fastTokenizer ?: throw IllegalStateException("Tokenizer 为空")
    val host = fastHostTensors ?: throw IllegalStateException("HostTensors 为空")
    val sp = fastSpDecoder ?: throw IllegalStateException("SentencePieceDecoder 为空")

    return runOnnxInference(text, env, encSess, decSess, tok, host, sp)
  }

  /**
   * 批量端侧离线翻译 (全屏气泡顺序推理，严格映射 ID)
   */
  suspend fun translateBatch(items: Map<String, String>): Map<String, String> = withContext(Dispatchers.IO) {
    if (items.isEmpty()) return@withContext emptyMap<String, String>()

    synchronized(sessionLock) {
      val ctx = appContext
      if (ctx != null && !isModelReady) {
        initInternal(ctx)
      }

      if (!isModelReady) {
        throw IllegalStateException("ONNX 翻译模型尚未就绪: $statusMessage")
      }

      val resultMap = LinkedHashMap<String, String>(items.size)
      for ((id, text) in items) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) {
          resultMap[id] = ""
        } else {
          resultMap[id] = translate(trimmed)
        }
      }
      resultMap
    }
  }

  /**
   * 执行真实 ONNX 编码器 + 步进解码器自回归推理
   */
  private fun runOnnxInference(
    text: String,
    env: OrtEnvironment,
    encoderSession: OrtSession,
    decoderSession: OrtSession,
    tokenizer: FastTokenizer,
    host: FastNpzReader,
    spDecoder: FastSentencePiece
  ): String {
    // 1. 日文 Unigram 分词转 Token IDs (含 <s>=1, </s>=2, 截断至 128)
    val tokenIds = tokenizer.encode(text)
    val n = tokenIds.size
    val seqLen = n.toLong()

    // 2. Encoder 前向计算
    val inputIdsBuffer = LongBuffer.wrap(tokenIds)
    val inputIdsTensor = OnnxTensor.createTensor(env, inputIdsBuffer, longArrayOf(1, seqLen))

    val encOutputs = try {
      encoderSession.run(mapOf("ids" to inputIdsTensor))
    } finally {
      inputIdsTensor.close()
    }

    val H = host.heads // 12
    val hd = host.headDim // 64
    val dim = host.dim // 768
    val T = 128
    val M = 130 // 2 + 128
    val vocabSize = host.vocabSize // 22935
    val negVal = -1e4f

    // 3. 提取并填充 Cross-Attention 张量 (ck0, cv0, ck1, cv1) 至固定长度 M=130
    val crossNames = arrayOf("ck0", "cv0", "ck1", "cv1")
    val crossBuffers = HashMap<String, FloatBuffer>()
    val crossTensors = HashMap<String, OnnxTensor>()
    var cmaskTensor: OnnxTensor? = null

    try {
      for (crossName in crossNames) {
        val tensor = encOutputs.get(crossName).orElse(null) as? OnnxTensor
          ?: throw IllegalStateException("Encoder 缺少输出张量: $crossName")
        val encFloatBuf = tensor.floatBuffer

        val totalCrossFloats = 1 * H * M * hd
        val paddedBuf = ByteBuffer.allocateDirect(totalCrossFloats * 4)
          .order(ByteOrder.nativeOrder())
          .asFloatBuffer()

        // 复制前 2 + n 个位置 (包含 2 个 null token 与 n 个源 token)
        val srcPositions = 2 + n
        for (h in 0 until H) {
          for (s in 0 until srcPositions) {
            val srcOffset = (h * srcPositions + s) * hd
            val dstOffset = (h * M + s) * hd
            for (d in 0 until hd) {
              paddedBuf.put(dstOffset + d, encFloatBuf.get(srcOffset + d))
            }
          }
        }
        paddedBuf.position(0)
        crossBuffers[crossName] = paddedBuf
        crossTensors[crossName] = OnnxTensor.createTensor(
          env,
          paddedBuf,
          longArrayOf(1, H.toLong(), M.toLong(), hd.toLong())
        )
      }

      // 4. 构建 cmask 张量 [1, 1, 1, M]
      val cmaskBuf = ByteBuffer.allocateDirect(M * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
      val srcCount = 2 + n
      for (m in 0 until M) {
        cmaskBuf.put(m, if (m < srcCount) 0.0f else negVal)
      }
      cmaskBuf.position(0)
      cmaskTensor = OnnxTensor.createTensor(env, cmaskBuf, longArrayOf(1, 1, 1, M.toLong()))

      // 5. 初始化自注意力 KV-Cache [1, H, T, hd] (初始全 0.0)
      val cacheNames = arrayOf("kc0", "vc0", "kc1", "vc1")
      val stepKNames = arrayOf("k0", "v0", "k1", "v1")
      val cacheFloats = 1 * H * T * hd
      val cacheBuffers = HashMap<String, FloatBuffer>()
      for (cName in cacheNames) {
        val buf = ByteBuffer.allocateDirect(cacheFloats * 4)
          .order(ByteOrder.nativeOrder())
          .asFloatBuffer()
        cacheBuffers[cName] = buf
      }

      // 6. 初始化 smask [1, 1, 1, T] (初始全 -1e4f)
      val smaskBuf = ByteBuffer.allocateDirect(T * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
      for (t in 0 until T) {
        smaskBuf.put(t, negVal)
      }
      smaskBuf.position(0)

      val xDirectBuf = ByteBuffer.allocateDirect(dim * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()

      val outTokens = ArrayList<Int>()
      var prev1 = -1
      var prev2 = -1
      var currentTok = 1 // BOS

      val maxSteps = minOf(3 * n + 10, 512, T + 1)
      val logitsArray = FloatArray(vocabSize)

      for (t in 0 until maxSteps) {
        // x = scaledEmb[currentTok] + pos[t]
        xDirectBuf.clear()
        val embOffset = currentTok * dim
        val posOffset = t * dim
        for (d in 0 until dim) {
          xDirectBuf.put(d, host.scaledEmb[embOffset + d] + host.pos[posOffset + d])
        }
        xDirectBuf.position(0)

        val stepTensors = mutableListOf<OnnxTensor>()
        val decOutputs = try {
          val xTensor = OnnxTensor.createTensor(env, xDirectBuf, longArrayOf(1, 1, dim.toLong())).also { stepTensors.add(it) }
          smaskBuf.position(0)
          val smaskTensor = OnnxTensor.createTensor(env, smaskBuf, longArrayOf(1, 1, 1, T.toLong())).also { stepTensors.add(it) }

          val cacheTensors = HashMap<String, OnnxTensor>()
          for (cName in cacheNames) {
            cacheBuffers[cName]!!.position(0)
            cacheTensors[cName] = OnnxTensor.createTensor(
              env,
              cacheBuffers[cName]!!,
              longArrayOf(1, H.toLong(), T.toLong(), hd.toLong())
            ).also { stepTensors.add(it) }
          }

          val stepInputs = HashMap<String, OnnxTensor>()
          stepInputs["x"] = xTensor
          stepInputs["smask"] = smaskTensor
          stepInputs["cmask"] = cmaskTensor
          for ((k, tensor) in crossTensors) stepInputs[k] = tensor
          for ((k, tensor) in cacheTensors) stepInputs[k] = tensor

          decoderSession.run(stepInputs)
        } finally {
          for (tensor in stepTensors) tensor.close()
        }

        val nxtToken = try {
          val logitsTensor = decOutputs.get("logits").orElse(null) as? OnnxTensor
            ?: throw IllegalStateException("Decoder 缺少 logits 输出")
          val floatBuf = logitsTensor.floatBuffer
          floatBuf.get(logitsArray)

          // 应用假名屏蔽规则，防止 byte-fallback 拼凑日文
          spDecoder.applyKanaRules(logitsArray, prev1, prev2)

          var maxVal = -Float.MAX_VALUE
          var argMax = 0
          for (v in 0 until vocabSize) {
            if (logitsArray[v] > maxVal) {
              maxVal = logitsArray[v]
              argMax = v
            }
          }

          if (t < T) {
            for (ci in 0 until 4) {
              val cName = cacheNames[ci]
              val kName = stepKNames[ci]
              val newTensor = decOutputs.get(kName).orElse(null) as? OnnxTensor
                ?: throw IllegalStateException("Decoder 缺少缓存输出: $kName")
              run {
                val newBuf = newTensor.floatBuffer
                val cBuf = cacheBuffers[cName]!!
                for (h in 0 until H) {
                  val srcOffset = h * hd
                  val dstOffset = (h * T + t) * hd
                  for (d in 0 until hd) {
                    cBuf.put(dstOffset + d, newBuf.get(srcOffset + d))
                  }
                }
              }
            }
            smaskBuf.put(t, 0.0f)
          }

          argMax
        } finally {
          decOutputs.close()
        }

        if (nxtToken == 2 || nxtToken == 3) { // EOS 或 PAD
          break
        }

        outTokens.add(nxtToken)
        prev2 = prev1
        prev1 = nxtToken
        currentTok = nxtToken
      }

      // 7. SentencePiece 真实反分词还原为中文
      val translated = spDecoder.decode(outTokens)
      check(translated.isNotBlank()) { "离线模型未生成译文" }
      return translated
    } finally {
      encOutputs.close()
      cmaskTensor?.close()
      for (tns in crossTensors.values) {
        try { tns.close() } catch (_: Exception) {}
      }
    }
  }

  /**
   * 释放底层 ONNX 会话资源 (不释放全局共享的 ortEnv)
   */
  fun close() = synchronized(sessionLock) {
    closeInternal()
  }

  private fun closeInternal() {
    try {
      encoderSession?.close()
      decoderSession?.close()
    } catch (_: Exception) {}
    encoderSession = null
    decoderSession = null
    fastTokenizer = null
    fastHostTensors = null
    fastSpDecoder = null
    isModelReady = false
    statusMessage = "未初始化"
  }

  // ==================== 离线模型自主下载与文件管理模块 ====================

  // 只有足够大的 manifest 文件才值得启用多连接 Range 下载：
  // 4 路并发至少每路 2MiB，既能摊薄单连接被限速的影响，也不至于让小文件承担连接开销。
  private const val RANGE_DOWNLOAD_MIN_BYTES = 8L * 1024L * 1024L
  private const val RANGE_DOWNLOAD_CONCURRENCY = 4
  private const val RANGE_DOWNLOAD_CHUNK_BYTES = 2L * 1024L * 1024L
  private const val RANGE_DOWNLOAD_MAX_RETRIES = 3
  private const val RANGE_TAIL_LOW_SPEED_WINDOW_MS = 10_000L
  private const val RANGE_TAIL_MIN_SPEED_KBPS = 48.0
  private const val DOWNLOAD_PROGRESS_INTERVAL_MS = 400L
  private const val DOWNLOAD_BUFFER_SIZE = 65536

  private val downloadHttpClient: OkHttpClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(120, TimeUnit.SECONDS)
      .callTimeout(0, TimeUnit.MILLISECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
      .retryOnConnectionFailure(true)
      .build()
  }

  // Range 小块使用独立 HTTP/1.1 短连接。HTTP/2 会把 4 个并发流复用在同一条
  // TCP 连接上，一旦移动网络发生丢包或拥塞，所有分片会同时降速。
  private val rangeHttpClient: OkHttpClient by lazy {
    downloadHttpClient.newBuilder()
      .protocols(listOf(Protocol.HTTP_1_1))
      .readTimeout(25, TimeUnit.SECONDS)
      .callTimeout(45, TimeUnit.SECONDS)
      .build()
  }

  @Volatile
  private var isDownloading = false

  @Volatile
  private var cancelDownloadFlag = false

  @Volatile
  private var pauseDownloadFlag = false

  // 所有进行中的连接（含单连接回退、Range 分片）。cancelDownload 会主动断开它们，
  // 避免阻塞中的 socket 读取要等到 120s readTimeout 才响应取消。
  private val activeConnections: MutableSet<java.net.HttpURLConnection> =
    java.util.Collections.newSetFromMap(ConcurrentHashMap<java.net.HttpURLConnection, Boolean>())
  private val activeCalls: MutableSet<Call> =
    java.util.Collections.newSetFromMap(ConcurrentHashMap<Call, Boolean>())

  private fun abortActiveConnections() {
    for (call in activeCalls) {
      call.cancel()
    }
    for (connection in activeConnections) {
      try {
        connection.disconnect()
      } catch (_: Exception) {
      }
    }
  }

  @Volatile
  private var downloadProgressState: Map<String, Any> = mapOf(
    "status" to "idle",
    "progress" to 0.0,
    "downloadedBytes" to 0L,
    "totalBytes" to 0L,
    "speedKbps" to 0.0,
    "error" to "",
    "targetFileName" to ""
  )

  fun getDownloadProgress(): Map<String, Any> = downloadProgressState

  fun cancelDownload() {
    cancelDownloadFlag = true
    pauseDownloadFlag = false
    abortActiveConnections()
  }

  fun pauseDownload() {
    if (!isDownloading || pauseDownloadFlag) return
    pauseDownloadFlag = true
    downloadProgressState = downloadProgressState + mapOf(
      "status" to "paused",
      "speedKbps" to 0.0,
      "detail" to "下载已暂停",
      "error" to ""
    )
    abortActiveConnections()
  }

  fun resumeDownload() {
    if (!isDownloading || !pauseDownloadFlag) return
    pauseDownloadFlag = false
    downloadProgressState = downloadProgressState + mapOf(
      "status" to "downloading",
      "speedKbps" to 0.0,
      "detail" to "正在恢复未完成分块",
      "error" to ""
    )
  }

  /**
   * 后台异步下载指定的端侧神经网络模型（支持断点、重定向以及 .zip 自动解压缩）
   */
  suspend fun downloadModel(
    context: Context,
    downloadUrl: String,
    targetFileName: String,
    expectedSha256: String? = null,
    activeModelFileName: String? = null
  ): Boolean = withContext(Dispatchers.IO) {
    if (isDownloading) {
      Log.w(TAG, "已有正在执行的模型下载任务")
      return@withContext false
    }

    isDownloading = true
    cancelDownloadFlag = false
    pauseDownloadFlag = false
    val modelDir = File(context.filesDir, "models/translation")
    if (!modelDir.exists()) {
      modelDir.mkdirs()
    }

    // The JS catalog passes a stable model identifier (for example "fast-int8")
    // as targetFileName. Keep it as the progress key even when the URL points to
    // manifest.json; deriving the parent URL segment produced a version date such
    // as "2026-11-04", which prevented JS from associating progress with a model.
    val progressKey = targetFileName

    val tempFile = File(modelDir, "$progressKey.download")
    val finalFile = File(modelDir, targetFileName)

    downloadProgressState = mapOf(
      "status" to "downloading",
      "progress" to 0.001,
      "downloadedBytes" to 0L,
      "totalBytes" to 0L,
      "speedKbps" to 0.0,
      "error" to "",
      "targetFileName" to progressKey
    )

    var connection: java.net.HttpURLConnection? = null
    var stagingDirToCleanup: File? = null
    try {
      if (tempFile.exists()) tempFile.delete()

      val initialConnection = openConnectionWithRedirects(downloadUrl)
      connection = initialConnection
      activeConnections.add(initialConnection)
      val responseCode = initialConnection.responseCode
      if (responseCode !in 200..299) {
        throw java.io.IOException("HTTP 错误响应码: $responseCode")
      }

      val contentLength = initialConnection.contentLengthLong
      var downloadedBytes = 0L
      val buffer = ByteArray(32768)
      var lastUpdateTime = System.currentTimeMillis()
      var bytesSinceLastUpdate = 0L

      java.io.BufferedInputStream(initialConnection.inputStream, 65536).use { input ->
        java.io.BufferedOutputStream(FileOutputStream(tempFile), 65536).use { output ->
          var bytesRead = input.read(buffer)
          while (bytesRead != -1) {
            if (cancelDownloadFlag) {
              tempFile.delete()
              downloadProgressState = mapOf(
                "status" to "cancelled",
                "progress" to 0.0,
                "downloadedBytes" to 0L,
                "totalBytes" to 0L,
                "speedKbps" to 0.0,
                "error" to "用户已取消下载",
                "targetFileName" to targetFileName
              )
              return@withContext false
            }

            output.write(buffer, 0, bytesRead)
            downloadedBytes += bytesRead
            bytesSinceLastUpdate += bytesRead

            val now = System.currentTimeMillis()
            val timeDiff = now - lastUpdateTime
            if (timeDiff >= 400) {
              val speedKbps = if (timeDiff > 0) (bytesSinceLastUpdate / 1024.0) / (timeDiff / 1000.0) else 0.0
              val progress = if (contentLength > 0) min(1.0, downloadedBytes.toDouble() / contentLength) else -1.0

              downloadProgressState = mapOf(
                "status" to "downloading",
                "progress" to progress,
                "downloadedBytes" to downloadedBytes,
                "totalBytes" to contentLength,
                "speedKbps" to speedKbps,
                "error" to "",
                "targetFileName" to targetFileName
              )
              lastUpdateTime = now
              bytesSinceLastUpdate = 0L
            }

            bytesRead = input.read(buffer)
          }
        }
      }

      activeConnections.remove(initialConnection)
      try {
        initialConnection.disconnect()
      } catch (_: Exception) {
      }

      if (!expectedSha256.isNullOrBlank()) {
        val actualSha256 = sha256(tempFile)
        if (!actualSha256.equals(expectedSha256.trim(), ignoreCase = true)) {
          throw java.io.IOException("模型清单 SHA-256 校验失败")
        }
      }

      // 1. 如果下载的是逐文件清单 manifest.json，执行版本化逐文件分块下载与校验
      if (targetFileName.equals("manifest.json", ignoreCase = true) || downloadUrl.endsWith("manifest.json", ignoreCase = true)) {
        val manifestContent = tempFile.readText(Charsets.UTF_8)
        val manifestJson = org.json.JSONObject(manifestContent)
        val variantName = manifestJson.optString("variant", targetFileName.removeSuffix(".json"))
        val versionName = manifestJson.optString("version", "default")
        val filesArray = manifestJson.getJSONArray("files")
        val totalExpectedBytes = manifestJson.optLong("totalBytes", 0L)

        val stagingDir = File(modelDir, ".staging-$variantName-$versionName")
        val versionDir = File(modelDir, "$variantName-$versionName")
        stagingDirToCleanup = stagingDir

        if (stagingDir.exists()) stagingDir.deleteRecursively()
        stagingDir.mkdirs()

        // 保存 manifest.json 到 staging
        File(stagingDir, "manifest.json").writeText(manifestContent, Charsets.UTF_8)

        val baseUrl = downloadUrl.substringBeforeLast("/")
        var completedBytes = 0L

        for (i in 0 until filesArray.length()) {
          if (cancelDownloadFlag) {
            stagingDir.deleteRecursively()
            tempFile.delete()
            downloadProgressState = mapOf(
              "status" to "cancelled",
              "progress" to 0.0,
              "downloadedBytes" to 0L,
              "totalBytes" to 0L,
              "speedKbps" to 0.0,
              "error" to "用户已取消下载",
              "targetFileName" to targetFileName
            )
            return@withContext false
          }

          val fileObj = filesArray.getJSONObject(i)
          val relPath = fileObj.getString("path")
          val expectedFileBytes = fileObj.getLong("bytes")
          val expectedFileSha = fileObj.getString("sha256")

          val fileDest = File(stagingDir, relPath.replace("/", File.separator))
          fileDest.parentFile?.mkdirs()

          val fileUrl = "$baseUrl/$relPath"
          try {
            downloadManifestFile(
              fileUrl = fileUrl,
              fileDest = fileDest,
              expectedFileBytes = expectedFileBytes,
              completedBytes = completedBytes,
              totalExpectedBytes = totalExpectedBytes,
              progressKey = progressKey
            )
          } catch (e: DownloadCancelledException) {
            stagingDir.deleteRecursively()
            tempFile.delete()
            publishCancelledProgress(targetFileName)
            return@withContext false
          }

          if (expectedFileBytes > 0 && fileDest.length() != expectedFileBytes) {
            stagingDir.deleteRecursively()
            tempFile.delete()
            throw java.io.IOException("文件大小与清单不符: $relPath (${fileDest.length()} / $expectedFileBytes)")
          }

          // 严格校验每个下载文件的 SHA-256
          val actualFileSha = sha256(fileDest)
          if (!actualFileSha.equals(expectedFileSha.trim(), ignoreCase = true)) {
            stagingDir.deleteRecursively()
            tempFile.delete()
            throw java.io.IOException("文件校验失败: $relPath (SHA-256 不匹配)")
          }
          completedBytes += fileDest.length()
        }

        if (cancelDownloadFlag) {
          stagingDir.deleteRecursively()
          tempFile.delete()
          publishCancelledProgress(targetFileName)
          return@withContext false
        }

        // 验证完成，原子切换版本目录
        downloadProgressState = mapOf(
          "status" to "extracting",
          "progress" to 1.0,
          "downloadedBytes" to totalExpectedBytes,
          "totalBytes" to totalExpectedBytes,
          "speedKbps" to 0.0,
          "error" to "",
          "targetFileName" to targetFileName
        )

        if (versionDir.exists()) versionDir.deleteRecursively()
        val renamed = stagingDir.renameTo(versionDir)
        if (!renamed) {
          versionDir.mkdirs()
          stagingDir.copyRecursively(versionDir, overwrite = true)
          stagingDir.deleteRecursively()
        }

        // 同步关键模型与配置文件至 modelDir 根目录，保证全局兼容性
        versionDir.walkTopDown().filter { it.isFile }.forEach { source ->
          val destination = File(modelDir, source.name)
          if (destination.exists()) destination.delete()
          source.copyTo(destination, overwrite = true)
        }

        tempFile.delete()
        val modelToActivate = activeModelFileName ?: versionDir.walkTopDown().first {
          it.isFile && it.extension.equals("onnx", ignoreCase = true)
        }.name
        setActiveModel(context, modelToActivate)
      }
      // 2. 如果下载的是 ZIP 压缩包
      else if (targetFileName.endsWith(".zip", ignoreCase = true)) {
        downloadProgressState = mapOf(
          "status" to "extracting",
          "progress" to 1.0,
          "downloadedBytes" to downloadedBytes,
          "totalBytes" to downloadedBytes,
          "speedKbps" to 0.0,
          "error" to "",
          "targetFileName" to targetFileName
        )
        val versionName = targetFileName.removeSuffix(".zip").removeSuffix(".ZIP")
        val stagingDir = File(modelDir, ".staging-$versionName")
        val versionDir = File(modelDir, versionName)
        stagingDirToCleanup = stagingDir

        if (stagingDir.exists()) stagingDir.deleteRecursively()
        stagingDir.mkdirs()
        unzipArchive(tempFile, stagingDir)

        // 验证解压包中是否存在指定的活跃模型入口文件
        val hasActiveModel = if (!activeModelFileName.isNullOrBlank()) {
          stagingDir.walkTopDown().any {
            it.isFile && it.name == activeModelFileName && it.length() > 1024
          }
        } else {
          stagingDir.walkTopDown().any {
            it.isFile && it.extension.equals("onnx", ignoreCase = true) && it.length() > 1024
          }
        }

        if (hasActiveModel) {
          // 原子替换：先准备新版本目录，验证成功后再切换
          if (versionDir.exists()) versionDir.deleteRecursively()
          val renamed = stagingDir.renameTo(versionDir)
          if (!renamed) {
            versionDir.mkdirs()
            stagingDir.copyRecursively(versionDir, overwrite = true)
            stagingDir.deleteRecursively()
          }

          // 保持平铺符号链接或复制关键模型文件到 modelDir 根目录，保证全局兼容性
          versionDir.walkTopDown().filter { it.isFile }.forEach { source ->
            val destination = File(modelDir, source.name)
            if (destination.exists()) destination.delete()
            source.copyTo(destination, overwrite = true)
          }

          tempFile.delete()
          val modelToActivate = activeModelFileName ?: versionDir.walkTopDown().first {
            it.isFile && it.extension.equals("onnx", ignoreCase = true)
          }.name
          setActiveModel(context, modelToActivate)
        } else {
          stagingDir.deleteRecursively()
          tempFile.delete()
          throw java.io.IOException("模型包缺少指定入口文件: ${activeModelFileName ?: "未配置"}")
        }
      } else {
        if (finalFile.exists()) finalFile.delete()
        tempFile.renameTo(finalFile)
        // 自动激活刚刚下载成功的模型
        setActiveModel(context, finalFile.name)
      }

      downloadProgressState = mapOf(
        "status" to "completed",
        "progress" to 1.0,
        "downloadedBytes" to downloadedBytes,
        "totalBytes" to downloadedBytes,
        "speedKbps" to 0.0,
        "error" to "",
        "targetFileName" to targetFileName
      )
      Log.i(TAG, "模型下载并部署就绪: $targetFileName (状态: $statusMessage)")
      true
    } catch (e: Exception) {
      tempFile.delete()
      stagingDirToCleanup?.deleteRecursively()
      if (cancelDownloadFlag) {
        Log.i(TAG, "模型下载已被用户取消")
        publishCancelledProgress(targetFileName)
      } else {
        Log.e(TAG, "下载离线模型失败: ${e.message}", e)
        downloadProgressState = mapOf(
          "status" to "error",
          "progress" to 0.0,
          "downloadedBytes" to 0L,
          "totalBytes" to 0L,
          "speedKbps" to 0.0,
          "error" to (e.message ?: "下载离线模型异常"),
          "targetFileName" to targetFileName
        )
      }
      false
    } finally {
      connection?.let { conn ->
        activeConnections.remove(conn)
        try {
          conn.disconnect()
        } catch (_: Exception) {
        }
      }
      isDownloading = false
    }
  }

  /**
   * 下载 manifest 中的单个文件：足够大的文件优先走 4 路 Range 并发，
   * 任何 Range 相关异常都会清理分片后回退到原有单连接下载；取消异常则直接向上抛出。
   */
  private suspend fun downloadManifestFile(
    fileUrl: String,
    fileDest: File,
    expectedFileBytes: Long,
    completedBytes: Long,
    totalExpectedBytes: Long,
    progressKey: String
  ) {
    if (expectedFileBytes >= RANGE_DOWNLOAD_MIN_BYTES) {
      try {
        downloadFileRanged(
          fileUrl = fileUrl,
          fileDest = fileDest,
          expectedFileBytes = expectedFileBytes,
          completedBytes = completedBytes,
          totalExpectedBytes = totalExpectedBytes,
          progressKey = progressKey
        )
        return
      } catch (e: DownloadCancelledException) {
        fileDest.delete()
        throw e
      } catch (e: CancellationException) {
        fileDest.delete()
        throw e
      } catch (e: Exception) {
        fileDest.delete()
        if (cancelDownloadFlag) throw DownloadCancelledException()
        Log.w(TAG, "Range 并发下载不可用，安全清理后回退单连接: ${e.message}")
        publishDownloadProgress(
          status = "downloading",
          progress = if (totalExpectedBytes > 0) min(1.0, completedBytes.toDouble() / totalExpectedBytes) else -1.0,
          downloadedBytes = completedBytes,
          totalBytes = totalExpectedBytes,
          speedKbps = 0.0,
          progressKey = progressKey
        )
      }
    }

    try {
      downloadFileSingle(
        fileUrl = fileUrl,
        fileDest = fileDest,
        completedBytes = completedBytes,
        totalExpectedBytes = totalExpectedBytes,
        progressKey = progressKey
      )
    } catch (e: DownloadCancelledException) {
      fileDest.delete()
      throw e
    } catch (e: CancellationException) {
      fileDest.delete()
      throw e
    } catch (e: Exception) {
      fileDest.delete()
      if (cancelDownloadFlag) throw DownloadCancelledException()
      throw e
    }
  }

  /**
   * 原有的单连接流式下载路径，作为小文件与 Range 失败时的安全回退。
   */
  private fun downloadFileSingle(
    fileUrl: String,
    fileDest: File,
    completedBytes: Long,
    totalExpectedBytes: Long,
    progressKey: String
  ) {
    val call = newDownloadCall(fileUrl)
    activeCalls.add(call)
    try {
      call.execute().use { response ->
        if (!response.isSuccessful) {
          throw java.io.IOException("下载分块文件失败 $fileUrl (HTTP ${response.code})")
        }
        val body = response.body ?: throw java.io.IOException("下载响应为空: $fileUrl")
        Log.i(TAG, "OkHttp 下载 ${fileDest.name}: ${response.protocol}")

        if (fileDest.exists()) fileDest.delete()
        var downloadedBytes = 0L
        var lastUpdateTime = System.currentTimeMillis()
        var bytesSinceLastUpdate = 0L
        val buffer = ByteArray(DOWNLOAD_BUFFER_SIZE)

        java.io.BufferedInputStream(body.byteStream(), DOWNLOAD_BUFFER_SIZE).use { input ->
          java.io.BufferedOutputStream(FileOutputStream(fileDest), DOWNLOAD_BUFFER_SIZE).use { output ->
            while (true) {
              if (cancelDownloadFlag) throw DownloadCancelledException()
              val bytesRead = input.read(buffer)
              if (bytesRead == -1) break

              output.write(buffer, 0, bytesRead)
              downloadedBytes += bytesRead
              bytesSinceLastUpdate += bytesRead

              val now = System.currentTimeMillis()
              val timeDiff = now - lastUpdateTime
              if (timeDiff >= DOWNLOAD_PROGRESS_INTERVAL_MS) {
                val speedKbps = (bytesSinceLastUpdate / 1024.0) / (timeDiff / 1000.0)
                publishDownloadProgress(
                  status = "downloading",
                  progress = if (totalExpectedBytes > 0) min(1.0, (completedBytes + downloadedBytes).toDouble() / totalExpectedBytes) else -1.0,
                  downloadedBytes = completedBytes + downloadedBytes,
                  totalBytes = totalExpectedBytes,
                  speedKbps = speedKbps,
                  progressKey = progressKey
                )
                lastUpdateTime = now
                bytesSinceLastUpdate = 0L
              }
            }
          }
        }
      }
    } finally {
      activeCalls.remove(call)
    }
  }

  /**
   * 4 路 worker 按固定 2MiB 小块执行 Range 下载：每块完成后立刻领取下一块，
   * 避免单个超长响应在移动网络或 R2 回源路径上逐渐降速，也让 CDN 能缓存完整 Range 块。
   * 服务器不支持（非 206 / Content-Range 不匹配）或任一分片失败时抛出异常，由调用方回退。
   */
  private suspend fun downloadFileRanged(
    fileUrl: String,
    fileDest: File,
    expectedFileBytes: Long,
    completedBytes: Long,
    totalExpectedBytes: Long,
    progressKey: String
  ) {
    val partSize = RANGE_DOWNLOAD_CHUNK_BYTES
    val partCount = ((expectedFileBytes + partSize - 1) / partSize).toInt()
    val workerCount = min(RANGE_DOWNLOAD_CONCURRENCY, partCount)
    val tempDir = File(fileDest.parentFile, ".rangedl-${fileDest.name}-${System.nanoTime()}")
    if (!tempDir.mkdirs() && !tempDir.isDirectory) {
      throw java.io.IOException("无法创建 Range 临时目录: ${tempDir.absolutePath}")
    }
    Log.i(TAG, "模型 Range 小块并发下载: ${fileDest.name} ($expectedFileBytes bytes, $partCount 块, $workerCount 路)")

    try {
      val abortFlag = AtomicBoolean(false)
      val aggregator = RangeProgressAggregator(
        baseBytes = completedBytes,
        totalBytes = totalExpectedBytes,
        partCount = partCount
      ) { downloaded, total, speedKbps ->
        publishDownloadProgress(
          status = "downloading",
          progress = if (total > 0) min(1.0, downloaded.toDouble() / total) else -1.0,
          downloadedBytes = downloaded,
          totalBytes = total,
          speedKbps = speedKbps,
          progressKey = progressKey
        )
      }

      coroutineScope {
        val nextPart = AtomicInteger(0)
        val completedParts = AtomicInteger(0)
        val workers = (0 until workerCount).map {
          async(Dispatchers.IO) {
            while (true) {
              val index = nextPart.getAndIncrement()
              if (index >= partCount) break
              if (cancelDownloadFlag) throw DownloadCancelledException()
              if (abortFlag.get()) throw java.io.IOException("Range 小块下载已中止")
              val start = index.toLong() * partSize
              val end = min(start + partSize - 1, expectedFileBytes - 1)
              val partFile = File(tempDir, "part$index.tmp")
              var attempt = 0
              while (true) {
                try {
                  downloadRangePart(
                    url = fileUrl,
                    partFile = partFile,
                    start = start,
                    end = end,
                    totalFileBytes = expectedFileBytes,
                    partIndex = index,
                    aggregator = aggregator,
                    abortFlag = abortFlag,
                    isTailPart = { completedParts.get() >= partCount - 1 }
                  )
                  completedParts.incrementAndGet()
                  break
                } catch (e: DownloadCancelledException) {
                  throw e
                } catch (e: CancellationException) {
                  throw e
                } catch (e: Exception) {
                  partFile.delete()
                  aggregator.resetPart(index)
                  if (pauseDownloadFlag) {
                    publishPausedProgress(progressKey)
                    while (pauseDownloadFlag && !cancelDownloadFlag) {
                      delay(250L)
                    }
                    if (cancelDownloadFlag) throw DownloadCancelledException()
                    continue
                  }
                  attempt++
                  if (attempt > RANGE_DOWNLOAD_MAX_RETRIES) throw e
                  publishRetryProgress(
                    progressKey,
                    index,
                    attempt,
                    RANGE_DOWNLOAD_MAX_RETRIES,
                    lowSpeed = e is RangeDownloadLowSpeedException
                  )
                  Log.w(TAG, "Range 块 #$index 失败，重试 $attempt/$RANGE_DOWNLOAD_MAX_RETRIES: ${e.message}")
                  delay(500L * attempt)
                }
              }
            }
          }
        }
        try {
          workers.forEach { it.await() }
        } catch (e: Exception) {
          abortFlag.set(true)
          abortActiveConnections()
          throw e
        }
      }

      if (cancelDownloadFlag) throw DownloadCancelledException()

      // 顺序流式合并，任意时刻内存中只有一个缓冲区，不装载整个模型文件
      if (fileDest.exists()) fileDest.delete()
      java.io.BufferedOutputStream(FileOutputStream(fileDest), DOWNLOAD_BUFFER_SIZE).use { output ->
        for (index in 0 until partCount) {
          val partFile = File(tempDir, "part$index.tmp")
          if (!partFile.isFile) {
            throw java.io.IOException("Range 分片缺失: ${partFile.name}")
          }
          java.io.BufferedInputStream(partFile.inputStream(), DOWNLOAD_BUFFER_SIZE).use { input ->
            val buffer = ByteArray(DOWNLOAD_BUFFER_SIZE)
            while (true) {
              if (cancelDownloadFlag) throw DownloadCancelledException()
              val bytesRead = input.read(buffer)
              if (bytesRead == -1) break
              output.write(buffer, 0, bytesRead)
            }
          }
        }
      }

      val mergedLength = fileDest.length()
      if (mergedLength != expectedFileBytes) {
        throw java.io.IOException("合并后的文件大小不符: $mergedLength / $expectedFileBytes")
      }
      aggregator.finish()
    } finally {
      tempDir.deleteRecursively()
    }
  }

  /**
   * 下载单个 Range 分片，严格校验 206、Content-Range 与分片字节数。
   */
  private fun downloadRangePart(
    url: String,
    partFile: File,
    start: Long,
    end: Long,
    totalFileBytes: Long,
    partIndex: Int,
    aggregator: RangeProgressAggregator,
    abortFlag: AtomicBoolean,
    isTailPart: () -> Boolean
  ) {
    val expectedLength = end - start + 1
    if (start < 0L || end < start) {
      throw RangeDownloadUnsupportedException("非法 Range 区间: $start-$end")
    }
    if (cancelDownloadFlag) throw DownloadCancelledException()
    if (abortFlag.get()) throw java.io.IOException("Range 分片下载已中止")

    val call = newDownloadCall(
      url,
      mapOf(
        "Range" to "bytes=$start-$end",
        "Connection" to "close"
      ),
      forceHttp1 = true
    )
    activeCalls.add(call)
    val requestStartedAt = System.currentTimeMillis()
    try {
      if (abortFlag.get()) throw java.io.IOException("Range 分片下载已中止")
      if (cancelDownloadFlag) throw DownloadCancelledException()

      call.execute().use { response ->
        if (cancelDownloadFlag) throw DownloadCancelledException()
        if (response.code != 206) {
          throw RangeDownloadUnsupportedException("服务器未返回 206 Partial Content (HTTP ${response.code})")
        }

        val contentRange = response.header("Content-Range")
        val parsedRange = parseContentRange(contentRange)
          ?: throw RangeDownloadUnsupportedException("缺失或非法 Content-Range: $contentRange")
        if (parsedRange.first != start || parsedRange.second != end) {
          throw RangeDownloadUnsupportedException("Content-Range 区间不匹配: $contentRange，期望 $start-$end")
        }
        if (parsedRange.third != totalFileBytes) {
          throw RangeDownloadUnsupportedException("Content-Range 总大小不匹配: $contentRange，期望 $totalFileBytes")
        }

        val body = response.body ?: throw java.io.IOException("Range 响应为空: $start-$end")
        val headerLength = body.contentLength()
        if (headerLength >= 0L && headerLength != expectedLength) {
          throw RangeDownloadUnsupportedException("Content-Length 与分片大小不符: $headerLength / $expectedLength")
        }
        var written = 0L
        var speedWindowStartedAt = System.currentTimeMillis()
        var speedWindowBytes = 0L
        java.io.BufferedInputStream(body.byteStream(), DOWNLOAD_BUFFER_SIZE).use { input ->
          java.io.BufferedOutputStream(FileOutputStream(partFile), DOWNLOAD_BUFFER_SIZE).use { output ->
            val buffer = ByteArray(DOWNLOAD_BUFFER_SIZE)
            while (true) {
              if (cancelDownloadFlag) throw DownloadCancelledException()
              if (abortFlag.get()) throw java.io.IOException("Range 分片下载已中止")

              val bytesRead = input.read(buffer)
              if (bytesRead == -1) break
              written += bytesRead
              if (written > expectedLength) {
                throw RangeDownloadUnsupportedException("分片响应超出请求范围: $start-$end")
              }
              output.write(buffer, 0, bytesRead)
              aggregator.add(partIndex, bytesRead.toLong())

              speedWindowBytes += bytesRead
              val now = System.currentTimeMillis()
              val speedWindowElapsedMs = now - speedWindowStartedAt
              if (speedWindowElapsedMs >= RANGE_TAIL_LOW_SPEED_WINDOW_MS) {
                val windowSpeedKbps = (speedWindowBytes / 1024.0) / (speedWindowElapsedMs / 1000.0)
                if (isTailPart() && windowSpeedKbps < RANGE_TAIL_MIN_SPEED_KBPS) {
                  throw RangeDownloadLowSpeedException(windowSpeedKbps)
                }
                speedWindowStartedAt = now
                speedWindowBytes = 0L
              }
            }
          }
        }
        if (written != expectedLength) {
          throw java.io.IOException("Range 分片不完整: $written / $expectedLength")
        }
        val elapsedMs = (System.currentTimeMillis() - requestStartedAt).coerceAtLeast(1L)
        val averageKbps = (written / 1024.0) / (elapsedMs / 1000.0)
        Log.i(
          TAG,
          "Range 块 #$partIndex 完成: ${response.protocol}, " +
            "cache=${response.header("CF-Cache-Status") ?: "?"}, " +
            "colo=${response.header("CF-Ray")?.substringAfterLast('-') ?: "?"}, " +
            "${String.format(java.util.Locale.US, "%.0f", averageKbps)} KB/s"
        )
      }
    } catch (e: Exception) {
      throw e
    } finally {
      activeCalls.remove(call)
    }
  }

  private fun parseContentRange(header: String?): Triple<Long, Long, Long>? {
    if (header.isNullOrBlank()) return null
    val match = Regex("""^\s*bytes\s+(\d+)-(\d+)/(\d+)\s*$""", RegexOption.IGNORE_CASE)
      .find(header)
      ?: return null
    val start = match.groupValues[1].toLongOrNull() ?: return null
    val end = match.groupValues[2].toLongOrNull() ?: return null
    val total = match.groupValues[3].toLongOrNull() ?: return null
    return Triple(start, end, total)
  }

  private fun newDownloadCall(
    url: String,
    extraHeaders: Map<String, String> = emptyMap(),
    forceHttp1: Boolean = false
  ): Call {
    val request = Request.Builder()
      .url(url)
      .header("User-Agent", "Mozilla/5.0 (Android; Mobile; ScreenTranslator)")
      .header("Accept-Encoding", "identity")
      .header("Accept", "*/*")
      .apply {
        for ((name, value) in extraHeaders) header(name, value)
      }
      .build()
    return (if (forceHttp1) rangeHttpClient else downloadHttpClient).newCall(request)
  }

  private fun publishDownloadProgress(
    status: String,
    progress: Double,
    downloadedBytes: Long,
    totalBytes: Long,
    speedKbps: Double,
    progressKey: String
  ) {
    downloadProgressState = mapOf(
      "status" to status,
      "progress" to progress,
      "downloadedBytes" to downloadedBytes,
      "totalBytes" to totalBytes,
      "speedKbps" to speedKbps,
      "error" to "",
      "targetFileName" to progressKey
    )
  }

  private fun publishCancelledProgress(progressKey: String) {
    downloadProgressState = mapOf(
      "status" to "cancelled",
      "progress" to 0.0,
      "downloadedBytes" to 0L,
      "totalBytes" to 0L,
      "speedKbps" to 0.0,
      "error" to "用户已取消下载",
      "targetFileName" to progressKey
    )
  }

  private fun publishPausedProgress(progressKey: String) {
    downloadProgressState = downloadProgressState + mapOf(
      "status" to "paused",
      "speedKbps" to 0.0,
      "error" to "",
      "detail" to "下载已暂停，已完成分块将被保留",
      "targetFileName" to progressKey
    )
  }

  private fun publishRetryProgress(
    progressKey: String,
    partIndex: Int,
    attempt: Int,
    maxRetries: Int,
    lowSpeed: Boolean = false
  ) {
    downloadProgressState = downloadProgressState + mapOf(
      "status" to "downloading",
      "speedKbps" to 0.0,
      "error" to "",
      "detail" to if (lowSpeed) {
        "尾部分块速度过低，正在切换连接 $attempt/$maxRetries"
      } else {
        "分块 #$partIndex 超时，正在重试 $attempt/$maxRetries"
      },
      "targetFileName" to progressKey
    )
  }

  private fun sha256(file: File): String {
    val digest = java.security.MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
      val buffer = ByteArray(1024 * 1024)
      var read = input.read(buffer)
      while (read > 0) {
        digest.update(buffer, 0, read)
        read = input.read(buffer)
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
  }

  private fun openConnectionWithRedirects(
    initialUrl: String,
    maxRedirects: Int = 6,
    extraHeaders: Map<String, String> = emptyMap()
  ): java.net.HttpURLConnection {
    var url = initialUrl
    var redirects = 0
    while (redirects < maxRedirects) {
      val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
      conn.instanceFollowRedirects = false
      conn.useCaches = false
      conn.connectTimeout = 30000
      conn.readTimeout = 120000
      conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android; Mobile; ScreenTranslator)")
      conn.setRequestProperty("Accept-Encoding", "identity")
      conn.setRequestProperty("Connection", "keep-alive")
      conn.setRequestProperty("Accept", "*/*")
      // 重定向的每一跳都必须带上额外请求头（例如 Range），否则最终响应会退化为 200
      for ((name, value) in extraHeaders) {
        conn.setRequestProperty(name, value)
      }
      conn.connect()
      val code = conn.responseCode
      if (code in 300..399) {
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        if (location != null) {
          url = if (location.startsWith("http://") || location.startsWith("https://")) {
            location
          } else {
            java.net.URL(java.net.URL(url), location).toString()
          }
          redirects++
          continue
        }
      }
      return conn
    }
    throw java.io.IOException("重定向次数过多: $initialUrl")
  }

  private fun unzipArchive(zipFile: File, targetDir: File) {
    java.util.zip.ZipInputStream(zipFile.inputStream().buffered()).use { zis ->
      var entry = zis.nextEntry
      while (entry != null) {
        val entryName = entry.name
        val outFile = File(targetDir, entryName)
        if (!outFile.canonicalPath.startsWith(targetDir.canonicalPath)) {
          throw SecurityException("非法 Zip 路径越界: $entryName")
        }
        if (entry.isDirectory) {
          outFile.mkdirs()
        } else {
          outFile.parentFile?.mkdirs()
          FileOutputStream(outFile).use { fos ->
            val buf = ByteArray(16384)
            var len = zis.read(buf)
            while (len > 0) {
              fos.write(buf, 0, len)
              len = zis.read(buf)
            }
          }
        }
        zis.closeEntry()
        entry = zis.nextEntry
      }
    }
  }

  /**
   * 删除指定模型文件或一键清空翻译模型目录以释放存储
   */
  fun deleteModelFiles(context: Context, fileName: String?): Boolean {
    val dir = File(context.filesDir, "models/translation")
    if (!dir.exists()) return true
    var success = true
    val currentActive = activeModelName ?: getActiveModelFileName(context)
    if (fileName.isNullOrBlank() || fileName == "all") {
      dir.listFiles()?.forEach {
        if (!it.deleteRecursively()) success = false
      }
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().remove(KEY_ACTIVE_MODEL).apply()
    } else {
      val target = File(dir, fileName)
      if (target.exists()) {
        success = target.deleteRecursively()
      }
      if (fileName.equals(currentActive, ignoreCase = true)) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_ACTIVE_MODEL).apply()
      }
    }
    close()
    init(context)
    return success
  }

  /**
   * 列出已安装在本地存储中的离线模型文件清单
   */
  fun listModelFiles(context: Context): List<Map<String, Any>> {
    val dir = File(context.filesDir, "models/translation")
    if (!dir.exists()) return emptyList()
    val files = dir.listFiles() ?: return emptyList()
    val currentActive = activeModelName ?: getActiveModelFileName(context)
    return files.filter { it.isFile && !it.name.endsWith(".download") }.map { f ->
      mapOf(
        "name" to f.name,
        "sizeBytes" to f.length(),
        "sizeFormatted" to formatFileSize(f.length()),
        "lastModified" to f.lastModified(),
        "isActive" to f.name.equals(currentActive, ignoreCase = true)
      )
    }
  }

  private fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
    val group = min(digitGroups, units.size - 1)
    val size = bytes / Math.pow(1024.0, group.toDouble())
    return String.format(java.util.Locale.US, "%.1f %s", size, units[group])
  }
}

/**
 * 用户主动取消时抛出的独立异常，调用方据此跳过“回退单连接”逻辑并直接清理。
 */
private class DownloadCancelledException : java.io.IOException("用户已取消下载")

/**
 * 服务器不支持 Range、206 或 Content-Range 不符合预期时抛出。
 */
private class RangeDownloadUnsupportedException(message: String) : java.io.IOException(message)

/**
 * 最后一个 Range 分片仍在滴流但速度长期过低时主动换连接。
 * 普通 readTimeout 无法处理这种“持续有少量字节到达”的场景。
 */
private class RangeDownloadLowSpeedException(speedKbps: Double) :
  java.io.IOException("尾部分片持续低速: ${String.format(java.util.Locale.US, "%.1f", speedKbps)} KB/s")

/**
 * Range 分片进度聚合器：多个下载 worker 共享计数，锁内只做加法与快照，
 * 锁外发布不可变进度 Map，保证 downloadedBytes/progress/speedKbps 不会被并发覆盖成错误值。
 */
private class RangeProgressAggregator(
  private val baseBytes: Long,
  private val totalBytes: Long,
  partCount: Int,
  private val onProgress: (downloadedBytes: Long, totalBytes: Long, speedKbps: Double) -> Unit
) {
  private val partBytes = LongArray(partCount)
  private var windowBytes = 0L
  private var lastPublishMs = System.currentTimeMillis()
  private var smoothedSpeedKbps = 0.0
  private var maxPublishedBytes = baseBytes

  fun add(partIndex: Int, delta: Long) {
    if (delta <= 0L || partIndex !in partBytes.indices) return

    // 在锁内发布快照，保证多个 worker 的进度不会以旧值覆盖新值
    synchronized(this) {
      partBytes[partIndex] += delta
      windowBytes += delta

      val now = System.currentTimeMillis()
      val elapsed = now - lastPublishMs
      if (elapsed >= 400L) {
        var sum = 0L
        for (value in partBytes) sum += value
        val instantaneous = (windowBytes / 1024.0) / (elapsed / 1000.0)
        smoothedSpeedKbps = if (smoothedSpeedKbps <= 0.0) {
          instantaneous
        } else {
          smoothedSpeedKbps * 0.6 + instantaneous * 0.4
        }
        windowBytes = 0L
        lastPublishMs = now
        maxPublishedBytes = maxOf(maxPublishedBytes, baseBytes + sum)
        onProgress(maxPublishedBytes, totalBytes, smoothedSpeedKbps)
      }
    }
  }

  fun resetPart(partIndex: Int) {
    if (partIndex !in partBytes.indices) return
    synchronized(this) {
      partBytes[partIndex] = 0L
    }
  }

  fun finish() {
    val downloaded: Long
    val speed: Double
    synchronized(this) {
      var sum = 0L
      for (value in partBytes) sum += value
      downloaded = maxOf(maxPublishedBytes, baseBytes + sum)
      speed = smoothedSpeedKbps
    }
    onProgress(downloaded, totalBytes, speed)
  }
}
