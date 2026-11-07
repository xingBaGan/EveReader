package expo.modules.screentranslator

import android.util.JsonReader
import android.util.Log
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.util.regex.Pattern

/**
 * ModernBERT-ja Unigram Tokenizer with Metaspace pre-tokenization, added_tokens,
 * and byte fallback. Exactly matches HuggingFace Tokenizers and JMangaTranslator-Fast specification.
 */
class FastTokenizer {

  companion object {
    private const val TAG = "FastTokenizer"
    private const val BOS_ID = 1L
    private const val EOS_ID = 2L
    private const val MAX_SRC_TOKENS = 256
    private const val SLICE_SRC_TOKENS = 128
    private const val BYTE_FALLBACK_PENALTY = -28.32f
  }

  private class TrieNode {
    val children = HashMap<Byte, TrieNode>()
    var id: Int = -1
    var score: Float = 0f
  }

  private val root = TrieNode()
  private val bytePieceIds = IntArray(256) { -1 }
  private val addedTokens = LinkedHashMap<String, Long>()
  private var addedTokensPattern: Pattern? = null

  fun load(inputStream: InputStream) {
    JsonReader(BufferedReader(InputStreamReader(inputStream, Charsets.UTF_8))).use { reader ->
      reader.beginObject()
      while (reader.hasNext()) {
        when (reader.nextName()) {
          "added_tokens" -> parseAddedTokens(reader)
          "model" -> parseModel(reader)
          else -> reader.skipValue()
        }
      }
      reader.endObject()
    }

    if (addedTokens.isNotEmpty()) {
      val regexParts = addedTokens.keys.sortedByDescending { it.length }.map { Pattern.quote(it) }
      addedTokensPattern = Pattern.compile("(${regexParts.joinToString("|")})")
    }

    Log.i(TAG, "FastTokenizer 加载完成: vocabTrie就绪, addedTokens=${addedTokens.size}")
  }

  private fun parseAddedTokens(reader: JsonReader) {
    reader.beginArray()
    while (reader.hasNext()) {
      reader.beginObject()
      var id = -1L
      var content = ""
      while (reader.hasNext()) {
        when (reader.nextName()) {
          "id" -> id = reader.nextLong()
          "content" -> content = reader.nextString()
          else -> reader.skipValue()
        }
      }
      reader.endObject()
      if (id >= 0 && content.isNotEmpty()) {
        addedTokens[content] = id
      }
    }
    reader.endArray()
  }

  private fun parseModel(reader: JsonReader) {
    reader.beginObject()
    while (reader.hasNext()) {
      if (reader.nextName() == "vocab") {
        reader.beginArray()
        var idx = 0
        while (reader.hasNext()) {
          reader.beginArray()
          val piece = reader.nextString()
          val score = reader.nextDouble().toFloat()
          reader.endArray()

          // Check if piece is <0xXX> byte piece
          if (piece.startsWith("<0x") && piece.length == 6 && piece.endsWith(">")) {
            try {
              val bVal = piece.substring(3, 5).toInt(16)
              if (bVal in 0..255) {
                bytePieceIds[bVal] = idx
              }
            } catch (_: Exception) {}
          }

          // Insert into Trie
          val bytes = piece.toByteArray(Charsets.UTF_8)
          var curr = root
          for (b in bytes) {
            curr = curr.children.getOrPut(b) { TrieNode() }
          }
          curr.id = idx
          curr.score = score

          idx++
        }
        reader.endArray()
      } else {
        reader.skipValue()
      }
    }
    reader.endObject()
  }

  /**
   * Encodes raw Japanese text to LongArray of Token IDs.
   * Aligns with official: Text.encode() -> truncation(256), then [:128].
   */
  fun encode(rawText: String): LongArray {
    if (rawText.isEmpty()) {
      return longArrayOf(BOS_ID, EOS_ID)
    }

    val pattern = addedTokensPattern
    val sections = ArrayList<String>()

    if (pattern != null) {
      val matcher = pattern.matcher(rawText)
      var lastEnd = 0
      while (matcher.find()) {
        if (matcher.start() > lastEnd) {
          sections.add(rawText.substring(lastEnd, matcher.start()))
        }
        sections.add(matcher.group())
        lastEnd = matcher.end()
      }
      if (lastEnd < rawText.length) {
        sections.add(rawText.substring(lastEnd))
      }
    } else {
      sections.add(rawText)
    }

    val innerTokens = ArrayList<Long>()
    for (sec in sections) {
      if (sec.isEmpty()) continue
      val specialId = addedTokens[sec]
      if (specialId != null) {
        innerTokens.add(specialId)
      } else {
        tokenizeSection(sec, innerTokens)
      }
    }

    // Post-processor: <s> (1) + innerTokens + </s> (2)
    val fullTokens = ArrayList<Long>(innerTokens.size + 2)
    fullTokens.add(BOS_ID)
    fullTokens.addAll(innerTokens)
    fullTokens.add(EOS_ID)

    // Truncate at MAX_SRC_TOKENS (256) keeping EOS at end if truncated
    if (fullTokens.size > MAX_SRC_TOKENS) {
      val truncated = ArrayList<Long>(MAX_SRC_TOKENS)
      truncated.addAll(fullTokens.subList(0, MAX_SRC_TOKENS - 1))
      truncated.add(EOS_ID)
      fullTokens.clear()
      fullTokens.addAll(truncated)
    }

    // Official OnnxCPU.translate slices [:128]
    val finalCount = kotlin.math.min(fullTokens.size, SLICE_SRC_TOKENS)
    val result = LongArray(finalCount)
    for (i in 0 until finalCount) {
      result[i] = fullTokens[i]
    }
    return result
  }

  private fun tokenizeSection(text: String, out: ArrayList<Long>) {
    // Metaspace pre-tokenization: replace ' ' with U+2581
    val metaspaceText = text.replace(" ", "\u2581")
    val bytes = metaspaceText.toByteArray(Charsets.UTF_8)
    val n = bytes.size

    val bestScore = FloatArray(n + 1) { -1e18f }
    val bestPrevPos = IntArray(n + 1) { -1 }
    val bestPrevId = IntArray(n + 1) { -1 }
    bestScore[0] = 0f

    for (i in 0 until n) {
      if (bestScore[i] <= -1e17f) continue

      // 1. Walk Trie for normal pieces
      var curr = root
      for (j in i until n) {
        val next = curr.children[bytes[j]] ?: break
        curr = next
        if (curr.id >= 0) {
          val sc = bestScore[i] + curr.score
          if (sc > bestScore[j + 1]) {
            bestScore[j + 1] = sc
            bestPrevPos[j + 1] = i
            bestPrevId[j + 1] = curr.id
          }
        }
      }

      // 2. Byte fallback edge
      val bVal = bytes[i].toInt() and 0xFF
      val bytePid = bytePieceIds[bVal]
      if (bytePid >= 0) {
        val sc = bestScore[i] + BYTE_FALLBACK_PENALTY
        if (sc > bestScore[i + 1]) {
          bestScore[i + 1] = sc
          bestPrevPos[i + 1] = i
          bestPrevId[i + 1] = bytePid
        }
      }
    }

    // Backtrack Viterbi path
    var curr = n
    val ids = ArrayList<Long>()
    while (curr > 0) {
      val prev = bestPrevPos[curr]
      val pid = bestPrevId[curr]
      if (pid < 0 || prev < 0) break
      ids.add(pid.toLong())
      curr = prev
    }
    ids.reverse()
    out.addAll(ids)
  }
}
