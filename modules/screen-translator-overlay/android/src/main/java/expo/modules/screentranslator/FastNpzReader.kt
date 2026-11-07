package expo.modules.screentranslator

import android.util.Log
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.regex.Pattern
import java.util.zip.ZipFile
import kotlin.math.sqrt

/**
 * Validating streaming reader for host_fp32.npz containing emb.npy, pos.npy, heads.npy.
 * Verifies magic, version, dtype (<f4 / <i8), C-order (fortran_order == False), and shapes.
 * Uses bounded chunk streaming to avoid high Android heap peaks.
 */
class FastNpzReader {

  companion object {
    private const val TAG = "FastNpzReader"
    private val NPY_MAGIC = byteArrayOf(0x93.toByte(), 'N'.code.toByte(), 'U'.code.toByte(), 'M'.code.toByte(), 'P'.code.toByte(), 'Y'.code.toByte())
    private val DESCR_PATTERN = Pattern.compile("'descr':\\s*'([^']+)'")
    private val FORTRAN_PATTERN = Pattern.compile("'fortran_order':\\s*(True|False)")
    private val SHAPE_PATTERN = Pattern.compile("'shape':\\s*\\(([^)]*)\\)")
    private const val CHUNK_SIZE = 65536
  }

  var dim: Int = 768
    private set
  var heads: Int = 12
    private set
  var headDim: Int = 64
    private set
  var vocabSize: Int = 22935
    private set

  // scaledEmb = emb * sqrt(dim)
  lateinit var scaledEmb: FloatArray
    private set
  lateinit var pos: FloatArray
    private set

  private data class NpyHeader(
    val descr: String,
    val fortranOrder: Boolean,
    val shape: List<Int>,
    val headerTotalBytes: Int
  )

  fun load(npzFile: File) {
    if (!npzFile.exists() || !npzFile.isFile) {
      throw IllegalArgumentException("host_fp32.npz 不存在: ${npzFile.absolutePath}")
    }

    ZipFile(npzFile).use { zip ->
      // 1. Heads (small scalar)
      val headsEntry = zip.getEntry("heads.npy")
        ?: throw IllegalArgumentException("host_fp32.npz 缺少 heads.npy")
      zip.getInputStream(headsEntry).use { stream ->
        val header = readNpyHeader(stream)
        if (header.descr != "<i8") {
          throw IllegalStateException("heads.npy dtype 必须为 <i8，当前为: ${header.descr}")
        }
        if (header.fortranOrder) {
          throw IllegalStateException("heads.npy 必须为 C 连续内存 (fortran_order == False)")
        }
        val bytes = ByteArray(8)
        readFully(stream, bytes, 0, 8)
        val headsVal = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).long.toInt()
        if (headsVal <= 0 || headsVal > 64) {
          throw IllegalStateException("非法的 heads 值: $headsVal")
        }
        heads = headsVal
      }

      // 2. Emb (large array, streamed directly into scaledEmb)
      val embEntry = zip.getEntry("emb.npy")
        ?: throw IllegalArgumentException("host_fp32.npz 缺少 emb.npy")
      zip.getInputStream(embEntry).use { stream ->
        val header = readNpyHeader(stream)
        if (header.descr != "<f4") {
          throw IllegalStateException("emb.npy dtype 必须为 <f4，当前为: ${header.descr}")
        }
        if (header.fortranOrder) {
          throw IllegalStateException("emb.npy 必须为 C 连续内存 (fortran_order == False)")
        }
        if (header.shape.size != 2) {
          throw IllegalStateException("emb.npy shape 必须为 2 维，当前为: ${header.shape}")
        }
        vocabSize = header.shape[0]
        dim = header.shape[1]
        headDim = dim / heads

        val totalFloats = vocabSize * dim
        val scale = sqrt(dim.toDouble()).toFloat()
        scaledEmb = FloatArray(totalFloats)

        // Stream in 64KB chunks directly into scaledEmb
        val chunk = ByteArray(CHUNK_SIZE)
        var floatIdx = 0
        while (floatIdx < totalFloats) {
          val floatsNeeded = totalFloats - floatIdx
          val bytesToRead = kotlin.math.min(CHUNK_SIZE, floatsNeeded * 4)
          val bytesRead = readFully(stream, chunk, 0, bytesToRead)
          if (bytesRead <= 0) break

          val floatsInChunk = bytesRead / 4
          val buf = ByteBuffer.wrap(chunk, 0, bytesRead).order(ByteOrder.LITTLE_ENDIAN)
          for (i in 0 until floatsInChunk) {
            scaledEmb[floatIdx++] = buf.float * scale
          }
        }

        if (floatIdx != totalFloats) {
          throw IllegalStateException("emb.npy 读取未达预期数量: $floatIdx / $totalFloats")
        }
      }

      // 3. Pos (streamed directly into pos)
      val posEntry = zip.getEntry("pos.npy")
        ?: throw IllegalArgumentException("host_fp32.npz 缺少 pos.npy")
      zip.getInputStream(posEntry).use { stream ->
        val header = readNpyHeader(stream)
        if (header.descr != "<f4") {
          throw IllegalStateException("pos.npy dtype 必须为 <f4，当前为: ${header.descr}")
        }
        if (header.fortranOrder) {
          throw IllegalStateException("pos.npy 必须为 C 连续内存 (fortran_order == False)")
        }
        if (header.shape.size != 2 || header.shape[1] != dim) {
          throw IllegalStateException("pos.npy shape 与 dim 不匹配: ${header.shape} vs dim=$dim")
        }

        val totalFloats = header.shape[0] * header.shape[1]
        pos = FloatArray(totalFloats)

        val chunk = ByteArray(CHUNK_SIZE)
        var floatIdx = 0
        while (floatIdx < totalFloats) {
          val floatsNeeded = totalFloats - floatIdx
          val bytesToRead = kotlin.math.min(CHUNK_SIZE, floatsNeeded * 4)
          val bytesRead = readFully(stream, chunk, 0, bytesToRead)
          if (bytesRead <= 0) break

          val floatsInChunk = bytesRead / 4
          val buf = ByteBuffer.wrap(chunk, 0, bytesRead).order(ByteOrder.LITTLE_ENDIAN)
          for (i in 0 until floatsInChunk) {
            pos[floatIdx++] = buf.float
          }
        }

        if (floatIdx != totalFloats) {
          throw IllegalStateException("pos.npy 读取未达预期数量: $floatIdx / $totalFloats")
        }
      }

      Log.i(TAG, "FastNpzReader 流式加载成功: vocabSize=$vocabSize, dim=$dim, heads=$heads, headDim=$headDim")
    }
  }

  private fun readFully(stream: InputStream, b: ByteArray, off: Int, len: Int): Int {
    var n = 0
    while (n < len) {
      val count = stream.read(b, off + n, len - n)
      if (count < 0) break
      n += count
    }
    return n
  }

  private fun readNpyHeader(stream: InputStream): NpyHeader {
    val prefix = ByteArray(10)
    val readCount = readFully(stream, prefix, 0, 10)
    if (readCount < 10) throw IllegalStateException("NPY Header 损坏或过短")

    for (i in 0 until 6) {
      if (prefix[i] != NPY_MAGIC[i]) {
        throw IllegalStateException("非法的 NPY Magic 头")
      }
    }

    val major = prefix[6].toInt() and 0xFF
    val headerLen: Int
    val prefixLen: Int
    if (major == 1) {
      headerLen = (prefix[8].toInt() and 0xFF) or ((prefix[9].toInt() and 0xFF) shl 8)
      prefixLen = 10
    } else if (major == 2) {
      val extra = ByteArray(2)
      readFully(stream, extra, 0, 2)
      headerLen = (prefix[8].toInt() and 0xFF) or
        ((prefix[9].toInt() and 0xFF) shl 8) or
        ((extra[0].toInt() and 0xFF) shl 16) or
        ((extra[1].toInt() and 0xFF) shl 24)
      prefixLen = 12
    } else {
      throw IllegalStateException("不支持的 NPY 主版本: $major")
    }

    val headerBytes = ByteArray(headerLen)
    readFully(stream, headerBytes, 0, headerLen)
    val headerStr = String(headerBytes, Charsets.US_ASCII)

    val descrMatcher = DESCR_PATTERN.matcher(headerStr)
    if (!descrMatcher.find()) throw IllegalStateException("未能解析 NPY descr: $headerStr")
    val descr = descrMatcher.group(1)!!

    val fortranMatcher = FORTRAN_PATTERN.matcher(headerStr)
    if (!fortranMatcher.find()) throw IllegalStateException("未能解析 NPY fortran_order: $headerStr")
    val fortranOrder = fortranMatcher.group(1).equals("True", ignoreCase = true)

    val shapeMatcher = SHAPE_PATTERN.matcher(headerStr)
    if (!shapeMatcher.find()) throw IllegalStateException("未能解析 NPY shape: $headerStr")
    val shapeStr = shapeMatcher.group(1)!!.trim()
    val shape = if (shapeStr.isEmpty()) {
      emptyList()
    } else {
      shapeStr.split(",").mapNotNull {
        val s = it.trim()
        if (s.isNotEmpty()) s.toInt() else null
      }
    }

    return NpyHeader(descr, fortranOrder, shape, prefixLen + headerLen)
  }
}
