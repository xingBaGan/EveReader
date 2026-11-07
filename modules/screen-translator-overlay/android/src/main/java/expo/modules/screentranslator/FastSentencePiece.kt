package expo.modules.screentranslator

import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream

/**
 * Handles Chinese SentencePiece detokenization for JMangaTranslator-Fast:
 * 1. Binary protobuf extraction of joint.model pieces (zero external dependencies).
 * 2. vocab.json dat_ids mapping & byte_piece_ids kana rules.
 * 3. Byte merging for byte fallback pieces (<0xXX>) and whitespace restoration.
 */
class FastSentencePiece {

  companion object {
    private const val TAG = "FastSentencePiece"
  }

  private val pieces = ArrayList<String>(41000)
  private lateinit var datIds: IntArray
  private lateinit var byteCompact: IntArray
  private var bos: Int = 1
  private var eos: Int = 2
  private var pad: Int = 3

  // Precomputed kana ban sets
  private lateinit var banRule1Tokens: IntArray
  private var banRule1P1: Int = -1

  private lateinit var banRule2Tokens: IntArray
  private var banRule2P1: Int = -1
  private var banRule2P2: Int = -1

  private lateinit var banRule3Tokens: IntArray
  private var banRule3P1: Int = -1
  private var banRule3P2: Int = -1

  private lateinit var banRule4Tokens: IntArray
  private var banRule4P1: Int = -1
  private var banRule4P2: Int = -1

  fun load(jointModelFile: File, vocabJsonFile: File, configJsonFile: File) {
    if (!jointModelFile.exists()) throw IllegalArgumentException("joint.model 不存在: ${jointModelFile.absolutePath}")
    if (!vocabJsonFile.exists()) throw IllegalArgumentException("vocab.json 不存在: ${vocabJsonFile.absolutePath}")
    if (!configJsonFile.exists()) throw IllegalArgumentException("config.json 不存在: ${configJsonFile.absolutePath}")

    // 1. Config
    val cfgJson = JSONObject(configJsonFile.readText(Charsets.UTF_8))
    bos = cfgJson.optInt("bos", 1)
    eos = cfgJson.optInt("eos", 2)
    pad = cfgJson.optInt("pad", 3)

    // 2. Vocab.json
    val vJson = JSONObject(vocabJsonFile.readText(Charsets.UTF_8))
    val datVocab = vJson.getInt("dat_vocab")
    val dIdsArr = vJson.getJSONArray("dat_ids")
    datIds = IntArray(dIdsArr.length()) { dIdsArr.getInt(it) }

    val lut = IntArray(datVocab) { -1 }
    for (i in datIds.indices) {
      val d = datIds[i]
      if (d in 0 until datVocab) {
        lut[d] = i
      }
    }

    val bpArr = vJson.getJSONArray("byte_piece_ids")
    byteCompact = IntArray(256) {
      val bp = bpArr.getInt(it)
      if (bp in 0 until datVocab) lut[bp] else -1
    }

    // Precompute Kana rules
    // Rule 1: prev1 == B[0xE3], banned = [0x81, 0x82, 0x83]
    banRule1P1 = byteCompact[0xE3]
    banRule1Tokens = intArrayOf(byteCompact[0x81], byteCompact[0x82], byteCompact[0x83]).filter { it >= 0 }.toIntArray()

    // Rule 2: prev2 == B[0xE3] && prev1 == B[0x87], banned = 0xB0..0xBF
    banRule2P2 = byteCompact[0xE3]
    banRule2P1 = byteCompact[0x87]
    banRule2Tokens = (0xB0..0xBF).map { byteCompact[it] }.filter { it >= 0 }.toIntArray()

    // Rule 3: prev2 == B[0xEF] && prev1 == B[0xBD], banned = 0xA6..0xBF
    banRule3P2 = byteCompact[0xEF]
    banRule3P1 = byteCompact[0xBD]
    banRule3Tokens = (0xA6..0xBF).map { byteCompact[it] }.filter { it >= 0 }.toIntArray()

    // Rule 4: prev2 == B[0xEF] && prev1 == B[0xBE], banned = 0x80..0x9D
    banRule4P2 = byteCompact[0xEF]
    banRule4P1 = byteCompact[0xBE]
    banRule4Tokens = (0x80..0x9D).map { byteCompact[it] }.filter { it >= 0 }.toIntArray()

    // 3. joint.model binary protobuf parsing
    pieces.clear()
    jointModelFile.inputStream().use { input ->
      parseSentencePieceModel(input)
    }
    Log.i(TAG, "FastSentencePiece 加载完成: pieces=${pieces.size}, datIds=${datIds.size}")
  }

  private fun parseSentencePieceModel(input: InputStream) {
    val buf = input.readBytes()
    var pos = 0
    val total = buf.size

    while (pos < total) {
      val tagVar = readVarint(buf, pos)
      pos = tagVar.nextPos
      val tag = tagVar.value
      val field = (tag ushr 3).toInt()
      val wire = (tag and 7).toInt()

      if (wire == 2) { // Length-delimited
        val lenVar = readVarint(buf, pos)
        pos = lenVar.nextPos
        val len = lenVar.value.toInt()
        val end = pos + len

        if (field == 1) { // SentencePiece piece message
          // Sub-message contains field 1: string piece
          var subPos = pos
          var pieceStr: String? = null
          while (subPos < end) {
            val sTagVar = readVarint(buf, subPos)
            subPos = sTagVar.nextPos
            val sField = (sTagVar.value ushr 3).toInt()
            val sWire = (sTagVar.value and 7).toInt()
            if (sWire == 2) {
              val sLenVar = readVarint(buf, subPos)
              subPos = sLenVar.nextPos
              val sLen = sLenVar.value.toInt()
              if (sField == 1) {
                pieceStr = String(buf, subPos, sLen, Charsets.UTF_8)
              }
              subPos += sLen
            } else if (sWire == 0) {
              subPos = readVarint(buf, subPos).nextPos
            } else if (sWire == 5) {
              subPos += 4
            } else if (sWire == 1) {
              subPos += 8
            }
          }
          pieces.add(pieceStr ?: "")
        }
        pos = end
      } else if (wire == 0) {
        pos = readVarint(buf, pos).nextPos
      } else if (wire == 5) {
        pos += 4
      } else if (wire == 1) {
        pos += 8
      }
    }
  }

  private data class VarintResult(val value: Long, val nextPos: Int)

  private fun readVarint(buf: ByteArray, startPos: Int): VarintResult {
    var pos = startPos
    var value = 0L
    var shift = 0
    while (pos < buf.size) {
      val b = buf[pos++].toInt()
      value = value or ((b and 0x7F).toLong() shl shift)
      if ((b and 0x80) == 0) break
      shift += 7
    }
    return VarintResult(value, pos)
  }

  /**
   * Applies kana ban rules to logits array in-place.
   */
  fun applyKanaRules(logits: FloatArray, prev1: Int, prev2: Int) {
    if (prev1 == banRule1P1) {
      for (tok in banRule1Tokens) {
        if (tok in logits.indices) logits[tok] = -1e9f
      }
    }
    if (prev1 == banRule2P1 && prev2 == banRule2P2) {
      for (tok in banRule2Tokens) {
        if (tok in logits.indices) logits[tok] = -1e9f
      }
    }
    if (prev1 == banRule3P1 && prev2 == banRule3P2) {
      for (tok in banRule3Tokens) {
        if (tok in logits.indices) logits[tok] = -1e9f
      }
    }
    if (prev1 == banRule4P1 && prev2 == banRule4P2) {
      for (tok in banRule4Tokens) {
        if (tok in logits.indices) logits[tok] = -1e9f
      }
    }
  }

  /**
   * Decodes compact token IDs into target Chinese string.
   * Consecutively merges byte pieces <0xXX> and decodes as UTF-8.
   */
  fun decode(outputTokens: List<Int>): String {
    val spIds = ArrayList<Int>()
    for (tok in outputTokens) {
      if (tok in datIds.indices) {
        val spId = datIds[tok]
        if (spId >= 4) {
          spIds.add(spId)
        }
      }
    }

    val sb = StringBuilder()
    val byteBuf = ByteArrayOutputStream()

    for (spId in spIds) {
      val piece = if (spId in pieces.indices) pieces[spId] else continue
      if (piece.startsWith("<0x") && piece.length == 6 && piece.endsWith(">")) {
        try {
          val b = piece.substring(3, 5).toInt(16)
          byteBuf.write(b)
          continue
        } catch (_: Exception) {}
      }
      if (byteBuf.size() > 0) {
        sb.append(byteBuf.toString("UTF-8"))
        byteBuf.reset()
      }
      sb.append(piece)
    }

    if (byteBuf.size() > 0) {
      sb.append(byteBuf.toString("UTF-8"))
      byteBuf.reset()
    }

    var text = sb.toString().replace("\u2581", " ")
    if (text.startsWith(" ")) {
      text = text.substring(1)
    }
    return text.trim()
  }
}
