package expo.modules.screentranslator

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.Locale

/**
 * 调试用检测评测入口（仅 debuggable 构建生效）。
 *
 * 无需触摸交互即可在真机上跑「检测器 / 完整流水线」对比实验：
 *   adb push p6.jpg /sdcard/Android/data/com.anonymous.zlibapp/files/eval/in/
 *   adb shell am broadcast -a expo.modules.screentranslator.DEBUG_OCR_EVAL \
 *       -n com.anonymous.zlibapp/expo.modules.screentranslator.DebugOcrEvalReceiver
 *   adb pull /sdcard/Android/data/com.anonymous.zlibapp/files/eval/out.json
 *
 * 额外 extra：pipeline=true 时同时跑 MangaOcrProcessor.processImage 全链路
 */
class DebugOcrEvalReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    val debuggable = (app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (!debuggable) {
      Log.w("DebugOcrEval", "ignored: not a debuggable build")
      return
    }
    val extDir = app.getExternalFilesDir(null)?.absolutePath ?: app.filesDir.absolutePath
    // 输入图片放外部目录（adb push 方便），输出写应用内部目录（外部目录可能被 shell 创建而不可写）
    val inDir = File(intent.getStringExtra("indir") ?: "$extDir/eval/in")
    val outFile = File(intent.getStringExtra("out") ?: "${app.filesDir.absolutePath}/eval/out.json")
    val runPipeline = intent.getBooleanExtra("pipeline", true)

    Thread {
      val started = System.currentTimeMillis()
      try {
        if (!ComicTextDetector.isModelReady) ComicTextDetector.init(app)
        inDir.mkdirs()
        val images = (inDir.listFiles() ?: emptyArray())
          .filter { it.isFile && it.name.lowercase().let { n -> n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") } }
          .sortedBy { it.name }

        val runs = listOf(
          "legacy_stretch" to ComicTextDetector.DetectConfig(letterbox = false, gridX = 1, gridY = 1, artScoreThreshold = 0.18f, promoteIsolatedBubble = false),
          "lb_full" to ComicTextDetector.DetectConfig(letterbox = true, gridX = 1, gridY = 1),
          "lb_grid2" to ComicTextDetector.DetectConfig(letterbox = true, gridX = 2, gridY = 2),
          "lb_grid3" to ComicTextDetector.DetectConfig(letterbox = true, gridX = 3, gridY = 3)
        )

        val json = StringBuilder()
        json.append("{\"generatedAt\":").append(System.currentTimeMillis())
          .append(",\"inDir\":\"").append(inDir.absolutePath).append("\",\"images\":[")
        var firstImage = true
        for (img in images) {
          val bmp: Bitmap = BitmapFactory.decodeFile(img.absolutePath) ?: continue
          if (!firstImage) json.append(',')
          firstImage = false
          json.append("{\"name\":\"").append(img.name).append("\",\"w\":").append(bmp.width)
            .append(",\"h\":").append(bmp.height).append(",\"runs\":[")
          var firstRun = true
          for ((name, cfg) in runs) {
            val t0 = System.currentTimeMillis()
            val dets = ComicTextDetector.detectWith(bmp, app, cfg)
            val ms = System.currentTimeMillis() - t0
            if (!firstRun) json.append(',')
            firstRun = false
            json.append("{\"name\":\"").append(name).append("\",\"ms\":").append(ms)
              .append(",\"count\":").append(dets.size).append(",\"dets\":[")
            dets.forEachIndexed { idx, d ->
              if (idx > 0) json.append(',')
              json.append("{\"cat\":").append(d.category)
                .append(",\"score\":").append(fmt(d.score.toDouble()))
                .append(",\"x\":").append(d.bounds.left).append(",\"y\":").append(d.bounds.top)
                .append(",\"w\":").append(d.bounds.width()).append(",\"h\":").append(d.bounds.height())
                .append("}")
            }
            json.append("]}")
          }

          if (runPipeline) {
            val t1 = System.currentTimeMillis()
            val bubbles = try {
              runBlocking { MangaOcrProcessor.processImage(bmp, "ja", "auto", app) }
            } catch (e: Exception) {
              Log.e("DebugOcrEval", "pipeline failed", e)
              emptyList()
            }
            json.append(",{\"name\":\"pipeline\",\"ms\":").append(System.currentTimeMillis() - t1)
              .append(",\"count\":").append(bubbles.size).append(",\"bubbles\":[")
            bubbles.forEachIndexed { idx, b ->
              if (idx > 0) json.append(',')
              val box = b["box"] as? Map<*, *> ?: emptyMap<Any, Any>()
              json.append("{\"text\":\"").append(escape(b["sourceText"] as? String ?: ""))
                .append("\",\"type\":\"").append(b["textType"] as? String ?: "")
                .append("\",\"conf\":").append(fmt((b["confidence"] as? Number)?.toDouble() ?: 0.0))
                .append(",\"x\":").append((box["x"] as? Number)?.toInt() ?: 0)
                .append(",\"y\":").append((box["y"] as? Number)?.toInt() ?: 0)
                .append(",\"w\":").append((box["width"] as? Number)?.toInt() ?: 0)
                .append(",\"h\":").append((box["height"] as? Number)?.toInt() ?: 0)
                .append("}")
            }
            json.append("]}")
          }
          json.append("]}")
          bmp.recycle()
        }
        json.append("],\"elapsedMs\":").append(System.currentTimeMillis() - started).append("}")

        outFile.parentFile?.mkdirs()
        outFile.writeText(json.toString())
        Log.i("DebugOcrEval", "done images=${images.size} out=${outFile.absolutePath} in ${System.currentTimeMillis() - started}ms")
      } catch (e: Exception) {
        Log.e("DebugOcrEval", "eval failed", e)
        try {
          outFile.parentFile?.mkdirs()
          outFile.writeText("{\"error\":\"${escape(e.message ?: "unknown")}\"}")
        } catch (_: Exception) {}
      }
    }.start()
  }

  private fun fmt(v: Double): String = String.format(Locale.US, "%.3f", v)

  private fun escape(s: String): String = s
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
    .replace("\n", "\\n")
    .replace("\r", " ")
    .replace("\t", " ")
}
