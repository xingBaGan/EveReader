package expo.modules.screentranslator

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.util.Log
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 紧凑型漫画文本与艺术字检测器 (Text-Centric Detector)
 * 彻底摒弃易产生“巨幅误判大框”的全局大底色闭合算法，
 * 全面转向以【真实笔画与字符能量】为中心的紧致矩形框提取体系：
 *
 * 1. 空心描边字实心化 (Stroke Infill):
 *    针对日漫中的“白抜き / 袋文字 / 双重描边艺术字”，在局部像素层融化中空，
 *    将其还原为实心粗笔画，激活 OCR 感受野，产出紧密贴合文字的精确行框；
 *
 * 2. 局部高频笔画梯度能量聚集 (Tight Gradient Stroke Clusters):
 *    专门捕获无气泡、浮空于角色身体或背景上的拟声词 (SFX / 描き文字) 与艺术大标题；
 *    严控最大几何尺度 (宽<=240px, 高<=260px, 面积<=4% 屏幕)，绝对杜绝膨胀成整页大框！
 */
object MangaBubbleSegmenter {

  private const val TAG = "MangaBubbleSegmenter"

  data class SalientTextRegion(
    val id: String,
    val bounds: Rect,
    val type: String, // "art_text" (艺术字) | "sfx" (拟声词/拟态词)
    val isVertical: Boolean
  )

  /**
   * 路径 A 核心黑科技 1：紧致笔画能量检测 (紧密围绕艺术字与拟声词，严控尺寸边界)
   */
  fun detectSalientTextRegions(
    sourceBitmap: Bitmap,
    knownTextRects: List<Rect> = emptyList()
  ): List<SalientTextRegion> {
    if (sourceBitmap.width < 50 || sourceBitmap.height < 50) return emptyList()

    val srcW = sourceBitmap.width
    val srcH = sourceBitmap.height

    // 下采样至 360px 宽度提取梯度能量
    val targetWidth = 360.0f
    val scale = if (srcW > targetWidth) targetWidth / srcW else 1.0f
    val scaledW = (srcW * scale).toInt()
    val scaledH = (srcH * scale).toInt()

    val scaledBmp = try {
      Bitmap.createScaledBitmap(sourceBitmap, scaledW, scaledH, true)
    } catch (e: Exception) {
      return emptyList()
    }

    val totalPixels = scaledW * scaledH
    val pixels = IntArray(totalPixels)
    scaledBmp.getPixels(pixels, 0, scaledW, 0, 0, scaledW, scaledH)
    if (scaledBmp != sourceBitmap) scaledBmp.recycle()

    val lum = IntArray(totalPixels)
    for (i in 0 until totalPixels) {
      val c = pixels[i]
      lum[i] = ((c shr 16 and 0xFF) * 299 + (c shr 8 and 0xFF) * 587 + (c and 0xFF) * 114) / 1000
    }

    // 局部梯度算子: G = |dL/dx| + |dL/dy|
    val edgeMask = BooleanArray(totalPixels)
    for (y in 1 until scaledH - 1) {
      val row = y * scaledW
      for (x in 1 until scaledW - 1) {
        val idx = row + x
        val dx = abs(lum[idx + 1] - lum[idx - 1])
        val dy = abs(lum[idx + scaledW] - lum[idx - scaledW])
        if (dx + dy >= 42) {
          edgeMask[idx] = true
        }
      }
    }

    // 紧凑笔画连通：仅做微小 2px 局部闭运算，仅聚合相邻笔画，绝不跨越背景蔓延
    val bridgedMask = applySmallMorphologicalClose(edgeMask, scaledW, scaledH, radius = 2)

    // 提取紧致连通块 (严格限定最大尺寸，杜绝超大框)
    val maxBoxW = (240 * scale).toInt()
    val maxBoxH = (260 * scale).toInt()
    val minBoxSize = (16 * scale).toInt()

    val candidateBoxes = extractCompactComponents(
      bridgedMask,
      scaledW,
      scaledH,
      minW = minBoxSize,
      minH = minBoxSize,
      maxW = maxBoxW,
      maxH = maxBoxH
    )

    val salientRegions = mutableListOf<SalientTextRegion>()
    val invScale = 1.0f / scale
    var counter = 1

    for (box in candidateBoxes) {
      val w = box.width()
      val h = box.height()
      val area = w * h

      val aspect = w.toFloat() / max(1, h)
      if (aspect < 0.20f || aspect > 5.5f) continue

      // 笔画密度采样：确保该区域内确实含有高频笔画边缘 (12% ~ 70%)
      var edgeCount = 0
      for (y in box.top until box.bottom) {
        val r = y * scaledW
        for (x in box.left until box.right) {
          if (edgeMask[r + x]) edgeCount++
        }
      }
      val density = edgeCount.toFloat() / area
      if (density < 0.12f || density > 0.72f) continue

      // 映射回原图坐标空间
      val origLeft = (box.left * invScale).toInt().coerceIn(0, srcW)
      val origTop = (box.top * invScale).toInt().coerceIn(0, srcH)
      val origWidth = (w * invScale).toInt().coerceAtMost(srcW - origLeft)
      val origHeight = (h * invScale).toInt().coerceAtMost(srcH - origTop)
      val origRect = Rect(origLeft, origTop, origLeft + origWidth, origTop + origHeight)

      // 再次严格卡死物理像素上限：宽不超过 260px，高不超过 280px，面积不超过 4% 屏幕
      if (origRect.width() > 260 || origRect.height() > 280) continue
      if (origRect.width() * origRect.height() > srcW * srcH * 0.045f) continue

      // 关键排重：若与已有 OCR 识别出的文本框发生交叠，不重复标框
      val overlapsWithKnown = knownTextRects.any { known ->
        val interLeft = max(known.left, origRect.left)
        val interTop = max(known.top, origRect.top)
        val interRight = min(known.right, origRect.right)
        val interBottom = min(known.bottom, origRect.bottom)
        if (interRight > interLeft && interBottom > interTop) {
          val interArea = (interRight - interLeft) * (interBottom - interTop)
          val minA = min(known.width() * known.height(), origRect.width() * origRect.height())
          (interArea.toFloat() / max(1, minA)) > 0.35f
        } else false
      }
      if (overlapsWithKnown) continue

      val isSfx = (aspect > 1.8f || aspect < 0.45f) && (origRect.width() * origRect.height() < srcW * srcH * 0.03f)
      val isVertical = origHeight > origWidth * 1.15f

      salientRegions.add(
        SalientTextRegion(
          id = "art_${counter++}",
          bounds = origRect,
          type = if (isSfx) "sfx" else "art_text",
          isVertical = isVertical
        )
      )
    }

    return salientRegions
  }

  /**
   * 路径 A 核心黑科技 2：空心描边字闭合实心化 (Stroke Infill Preprocessing)
   * 针对日漫常见的“白抜き文字 / 袋文字” (带描边的空心字)，
   * 通过局部二值化 + 闭运算填补空心文字内部，将中空字转化为实心粗笔画
   */
  fun createStrokeInfilledBitmap(src: Bitmap): Bitmap? {
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
      val threshold = max(90, min(160, avgLum - 15))

      val strokeMask = BooleanArray(total) { lum[it] < threshold }
      val infilledMask = applySmallMorphologicalClose(strokeMask, w, h, radius = 2)

      val outPixels = IntArray(total)
      for (i in 0 until total) {
        outPixels[i] = if (infilledMask[i]) Color.BLACK else Color.WHITE
      }

      val destBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      destBmp.setPixels(outPixels, 0, w, 0, 0, w, h)
      destBmp
    } catch (e: Exception) {
      Log.e(TAG, "createStrokeInfilledBitmap failed", e)
      null
    }
  }

  /**
   * 微型形态学闭运算 (Dilation followed by Erosion, 半径仅为 2px，绝不扩散超标)
   */
  private fun applySmallMorphologicalClose(mask: BooleanArray, w: Int, h: Int, radius: Int = 2): BooleanArray {
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
   * 严格限定最大尺度的紧凑连通块提取 (杜绝超大背景块)
   */
  private fun extractCompactComponents(
    binary: BooleanArray,
    w: Int,
    h: Int,
    minW: Int,
    minH: Int,
    maxW: Int,
    maxH: Int
  ): List<Rect> {
    val labels = IntArray(binary.size)
    var nextLabel = 1
    val parent = IntArray(w * h / 4 + 1000) { it }

    fun find(i: Int): Int {
      var r = i
      while (r != parent[r]) r = parent[r]
      var curr = i
      while (curr != r) {
        val nxt = parent[curr]
        parent[curr] = r
        curr = nxt
      }
      return r
    }

    fun union(i: Int, j: Int) {
      val ri = find(i)
      val rj = find(j)
      if (ri != rj) parent[ri] = rj
    }

    for (y in 0 until h) {
      val row = y * w
      for (x in 0 until w) {
        val idx = row + x
        if (!binary[idx]) continue

        val leftLabel = if (x > 0 && binary[idx - 1]) labels[idx - 1] else 0
        val topLabel = if (y > 0 && binary[idx - w]) labels[idx - w] else 0

        if (leftLabel == 0 && topLabel == 0) {
          if (nextLabel < parent.size - 2) {
            labels[idx] = nextLabel++
          }
        } else if (leftLabel != 0 && topLabel == 0) {
          labels[idx] = leftLabel
        } else if (leftLabel == 0 && topLabel != 0) {
          labels[idx] = topLabel
        } else {
          labels[idx] = min(leftLabel, topLabel)
          union(leftLabel, topLabel)
        }
      }
    }

    val boxMap = mutableMapOf<Int, IntArray>() // [minX, minY, maxX, maxY, count]
    for (y in 0 until h) {
      val row = y * w
      for (x in 0 until w) {
        val l = labels[row + x]
        if (l == 0) continue
        val root = find(l)
        var b = boxMap[root]
        if (b == null) {
          b = intArrayOf(x, y, x, y, 1)
          boxMap[root] = b
        } else {
          if (x < b[0]) b[0] = x
          if (y < b[1]) b[1] = y
          if (x > b[2]) b[2] = x
          if (y > b[3]) b[3] = y
          b[4]++
        }
      }
    }

    val result = mutableListOf<Rect>()
    for ((_, b) in boxMap) {
      val bw = b[2] - b[0] + 1
      val bh = b[3] - b[1] + 1
      // 严格尺寸限制：长宽必须在合理文字区间内，超出即弃，彻底杜绝大框！
      if (bw in minW..maxW && bh in minH..maxH && b[4] >= 120) {
        result.add(Rect(b[0], b[1], b[2] + 1, b[3] + 1))
      }
    }
    return result
  }
}
