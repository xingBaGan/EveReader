package expo.modules.screentranslator

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.IntentCompat
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class ScreenCaptureOverlayService : Service() {

  companion object {
    const val CHANNEL_ID = "screen_translator_overlay_channel"
    const val NOTIFICATION_ID = 202601
    const val ACTION_START = "expo.modules.screentranslator.START"
    const val ACTION_STOP = "expo.modules.screentranslator.STOP"
    const val EXTRA_RESULT_CODE = "extra_result_code"
    const val EXTRA_RESULT_DATA = "extra_result_data"

    var currentService: ScreenCaptureOverlayService? = null
      private set

    fun isRunning(): Boolean = currentService != null

    fun triggerScreenCapture() {
      currentService?.captureScreen()
    }

    fun updateTranslationResult(bubblesJson: String) {
      currentService?.updateTranslation(bubblesJson)
    }

    fun setRealtimeEnabled(enabled: Boolean) {
      currentService?.setRealtimeMode(enabled)
    }

    fun isRealtimeEnabled(): Boolean {
      return currentService?.isRealtimeActive ?: false
    }

    fun setHudVisibility(visible: Boolean) {
      currentService?.floatingOverlayView?.setHudVisibility(visible)
    }

    fun setHudDisplayMode(mode: String) {
      currentService?.floatingOverlayView?.setHudDisplayMode(mode)
    }

    fun getHudDisplayMode(): String {
      return currentService?.floatingOverlayView?.hudDisplayMode ?: "ocr"
    }

    fun setSourceLanguageFilter(lang: String) {
      currentService?.setSourceLanguageFilter(lang)
    }

    fun getSourceLanguageFilter(): String {
      return currentService?.getSourceLanguageFilter() ?: "ja"
    }

    fun setTargetApp(packageName: String?, appName: String?) {
      currentService?.setTargetApp(packageName, appName)
    }

    fun getTargetAppPackage(): String? = currentService?.targetAppPackage
    fun getTargetAppName(): String? = currentService?.targetAppName

    fun setDestroyBubblesOnAppSwitch(destroy: Boolean) {
      currentService?.setDestroyBubblesOnAppSwitch(destroy)
    }

    fun isDestroyBubblesOnAppSwitch(): Boolean {
      return currentService?.destroyBubblesOnAppSwitch ?: true
    }

    fun setOutsideAppBallBehavior(behavior: String) {
      currentService?.setOutsideAppBallBehavior(behavior)
    }

    fun getOutsideAppBallBehavior(): String {
      return currentService?.outsideAppBallBehavior ?: "dormant"
    }

    fun setViewportMode(mode: String) {
      currentService?.setViewportMode(mode)
    }

    fun getViewportMode(): String {
      return currentService?.viewportMode ?: "golden"
    }

    fun clearAllHudText() {
      currentService?.clearAllHudText()
    }

    fun setBallLoading(isLoading: Boolean, statusText: String = "翻译中") {
      currentService?.setBallLoading(isLoading, statusText)
    }

    fun setBallState(statusText: String, isProcessing: Boolean) {
      currentService?.setBallLoading(isProcessing, statusText)
    }

    fun stop(context: Context) {
      val service = currentService
      if (service != null) {
        service.teardown()
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            service.stopForeground(STOP_FOREGROUND_REMOVE)
          } else {
            @Suppress("DEPRECATION")
            service.stopForeground(true)
          }
        } catch (e: Exception) {
          Log.w("ScreenCaptureService", "Failed to stopForeground", e)
        }
        service.stopSelf()
        currentService = null
      }

      try {
        val intent = Intent(context, ScreenCaptureOverlayService::class.java).apply {
          action = ACTION_STOP
        }
        context.stopService(intent)
      } catch (e: Exception) {
        Log.w("ScreenCaptureService", "Failed to stopService", e)
      }

      try {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        notificationManager?.cancel(NOTIFICATION_ID)
      } catch (e: Exception) {}
    }

    fun stopAndExit(context: Context) {
      val wasResumed = currentService?.isMyActivityResumed ?: false
      stop(context)
      // 如果本应用主界面不在前台（用户在第三方应用中点击悬浮球的退出服务），彻底清理退出所有进程
      if (!wasResumed) {
        killAllAppProcesses(context)
      }
    }

    /**
     * 强力清理并终止当前应用的所有进程（包括残留的多进程/子进程），确保零后台残留
     */
    fun killAllAppProcesses(context: Context) {
      try {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val myPid = android.os.Process.myPid()
        am?.runningAppProcesses?.forEach { processInfo ->
          if (processInfo.pkgList.contains(context.packageName) && processInfo.pid != myPid) {
            Log.i("ScreenCaptureService", "Killing app process: ${processInfo.processName} (pid=${processInfo.pid})")
            android.os.Process.killProcess(processInfo.pid)
          }
        }
      } catch (e: Exception) {
        Log.w("ScreenCaptureService", "Failed to kill other processes", e)
      }
      try {
        android.os.Process.killProcess(android.os.Process.myPid())
      } catch (e: Exception) {}
      try {
        System.exit(0)
      } catch (e: Exception) {}
    }
  }

  private var windowManager: WindowManager? = null
  private var floatingOverlayView: FloatingOverlayView? = null
  private var mediaProjectionManager: MediaProjectionManager? = null
  private var mediaProjection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  private var screenWidth = 1080
  private var screenHeight = 2400
  private var screenDensity = 420
  private var isCapturing = false

  // 路线 B 实时运动检测与协程调度器
  private val serviceScope = CoroutineScope(Dispatchers.Default)
  private var realtimeMonitorJob: Job? = null
  @Volatile private var isRealtimeActive = true
  @Volatile private var isOcrBusy = false
  data class FrameProfile(
    val rowLuminance: IntArray,
    val stepY: Int,
    val sparseSample: IntArray
  )

  @Volatile private var previousProfile: FrameProfile? = null
  @Volatile private var isScreenMoving = false
  @Volatile private var settledOcrPending = false
  @Volatile private var lastMotionTime = 0L
  @Volatile private var lastOcrTime = 0L
  private var cachedLastBitmap: Bitmap? = null
  private var lastStillImage: Image? = null
  @Volatile private var hudRenderImmunityUntil = 0L // 悬浮框渲染免疫期，杜绝自己的框触发二次识别
  @Volatile private var ocrEpoch = 0L // 任务代际计数器，杜绝多次滑动导致的旧任务串扰与闪烁
  private var activeOcrJob: Job? = null // 当前正在运行的 OCR 协程，移动时立刻取消
  private var sourceLanguageFilter: String = "ja" // 默认仅识别指定语言（如 "ja" 仅识别日文）
  var targetAppPackage: String? = null // 指定的目标应用包名（离开时自动销毁屏幕文字）
    private set
  var targetAppName: String? = null // 指定的目标应用名称
    private set
  var destroyBubblesOnAppSwitch: Boolean = true // 切换离开目标应用时是否销毁屏幕文字 (true=销毁, false=保留供查阅)
    private set
  var outsideAppBallBehavior: String = "dormant" // "dormant"(待机不可点) | "hide"(完全隐藏) | "touch_through"(触摸穿透)
    private set
  var viewportMode: String = "full" // "full"(全屏模式，默认) | "golden"(黄金视口) | "center50"(中央50%)
    private set
  private var isOverlayShowingText = false
  private var isTargetAppInForeground = true
  private var lastKnownForegroundPackage: String? = null
  private var lastActiveForegroundPackage: String? = null
  private var isMyActivityResumed = false
  private var isLifecycleCallbacksRegistered = false
  private var cachedLauncherPackages: Set<String> = emptySet()

  private val activityLifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
      if (activity.packageName == packageName) {
        isMyActivityResumed = true
      }
    }
    override fun onActivityPaused(activity: Activity) {
      if (activity.packageName == packageName) {
        isMyActivityResumed = false
      }
    }
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    currentService = this
    try {
      application.registerActivityLifecycleCallbacks(activityLifecycleCallbacks)
      isLifecycleCallbacksRegistered = true
    } catch (e: Exception) {
      Log.w("ScreenCaptureService", "Failed to register ActivityLifecycleCallbacks", e)
    }
    createNotificationChannel()
    // 预热加载轻量端侧漫画文本检测模型 (ONNX RT-DETR-v2)，零冷启动延迟
    CoroutineScope(Dispatchers.IO).launch {
      try {
        ComicTextDetector.init(this@ScreenCaptureOverlayService)
      } catch (e: Exception) {
        Log.w("ScreenCaptureService", "ComicTextDetector pre-warm failed", e)
      }
    }
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    sourceLanguageFilter = prefs.getString("source_language_filter", "ja") ?: "ja"
    targetAppPackage = prefs.getString("target_app_package", null)
    targetAppName = prefs.getString("target_app_name", null)
    destroyBubblesOnAppSwitch = prefs.getBoolean("destroy_bubbles_on_app_switch", true)
    outsideAppBallBehavior = prefs.getString("outside_app_ball_behavior", "dormant") ?: "dormant"
    viewportMode = prefs.getString("viewport_mode", "full") ?: "full"

    val displayMetrics = resources.displayMetrics
    screenDensity = displayMetrics.densityDpi
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = windowManager!!.currentWindowMetrics.bounds
      screenWidth = bounds.width()
      screenHeight = bounds.height()
    } else {
      val realMetrics = android.util.DisplayMetrics()
      @Suppress("DEPRECATION")
      windowManager!!.defaultDisplay.getRealMetrics(realMetrics)
      screenWidth = realMetrics.widthPixels
      screenHeight = realMetrics.heightPixels
    }

    floatingOverlayView = FloatingOverlayView(
      context = this,
      windowManager = windowManager!!,
      onCaptureClicked = { captureScreen() },
      onScreenTapTrigger = {
        if (isTargetAppInForeground) {
          captureScreen()
        }
      },
      onCloseClicked = { stopAndExit(this) },
      onToggleRealtimeMode = { enabled -> setRealtimeMode(enabled) },
      onLanguageFilterChanged = { lang -> setSourceLanguageFilter(lang) },
      onLockCurrentAppClicked = { lockCurrentForegroundApp() },
      onUnlockAppClicked = { setTargetApp(null, null) },
      onDestroyOnAppSwitchChanged = { destroy -> setDestroyBubblesOnAppSwitch(destroy) },
      onOutsideAppBallBehaviorChanged = { behavior -> setOutsideAppBallBehavior(behavior) },
      onViewportModeChanged = { mode -> setViewportMode(mode) }
    )
    floatingOverlayView?.setTargetLanguageFilter(sourceLanguageFilter)
    floatingOverlayView?.setTargetApp(targetAppPackage, targetAppName)
    floatingOverlayView?.setDestroyBubblesOnAppSwitch(destroyBubblesOnAppSwitch)
    floatingOverlayView?.setOutsideAppBallBehavior(outsideAppBallBehavior)
    floatingOverlayView?.setViewportMode(viewportMode)
    floatingOverlayView?.let { setupFloatingOverlayCallbacks(it) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null || intent.action == ACTION_STOP) {
      teardown()
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
          @Suppress("DEPRECATION")
          stopForeground(true)
        }
      } catch (e: Exception) {}
      try {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        nm?.cancel(NOTIFICATION_ID)
      } catch (e: Exception) {}
      stopSelf()
      if (intent?.action == ACTION_STOP && !isMyActivityResumed) {
        killAllAppProcesses(this)
      }
      return START_NOT_STICKY
    }

    if (intent.action == ACTION_START) {
      startForegroundServiceWithNotification()

      val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
      val resultData = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)

      if (resultCode != 0 && resultData != null) {
        initMediaProjection(resultCode, resultData)
      }

      if (floatingOverlayView == null) {
        floatingOverlayView = FloatingOverlayView(
          context = this,
          windowManager = windowManager ?: (getSystemService(Context.WINDOW_SERVICE) as WindowManager),
          onCaptureClicked = { captureScreen() },
          onScreenTapTrigger = {
            if (isTargetAppInForeground) {
              captureScreen()
            }
          },
          onCloseClicked = { stopAndExit(this) },
          onToggleRealtimeMode = { enabled -> setRealtimeMode(enabled) },
          onLanguageFilterChanged = { lang -> setSourceLanguageFilter(lang) },
          onLockCurrentAppClicked = { lockCurrentForegroundApp() },
          onUnlockAppClicked = { setTargetApp(null, null) },
          onDestroyOnAppSwitchChanged = { destroy -> setDestroyBubblesOnAppSwitch(destroy) },
          onOutsideAppBallBehaviorChanged = { behavior -> setOutsideAppBallBehavior(behavior) },
          onViewportModeChanged = { mode -> setViewportMode(mode) }
        )
      }
      floatingOverlayView?.setTargetLanguageFilter(sourceLanguageFilter)
      floatingOverlayView?.setTargetApp(targetAppPackage, targetAppName)
      floatingOverlayView?.setDestroyBubblesOnAppSwitch(destroyBubblesOnAppSwitch)
      floatingOverlayView?.setOutsideAppBallBehavior(outsideAppBallBehavior)
      floatingOverlayView?.setViewportMode(viewportMode)
      floatingOverlayView?.let { setupFloatingOverlayCallbacks(it) }

      floatingOverlayView?.show()

      val inTarget = checkIsInTargetApp()
      isTargetAppInForeground = inTarget
      floatingOverlayView?.setTargetAppForegroundState(inTarget, force = true)

      ScreenTranslatorOverlayModule.emitServiceStateChanged(true)
    }

    return START_NOT_STICKY
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "屏幕文字实时识别与翻译服务",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "运行后台屏幕画面监听与第三方应用原位坐标标注"
        setShowBadge(false)
      }
      val manager = getSystemService(NotificationManager::class.java)
      manager?.createNotificationChannel(channel)
    }
  }

  private fun startForegroundServiceWithNotification() {
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      packageManager.getLaunchIntentForPackage(packageName),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    )

    val stopIntent = Intent(this, ScreenCaptureOverlayService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PendingIntent.getService(this, 1, stopIntent, PendingIntent.FLAG_IMMUTABLE)
    } else {
      PendingIntent.getService(this, 1, stopIntent, 0)
    }

    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("屏幕文字实时识别正在运行")
      .setContentText("点击悬浮球或滚动屏幕即可在第三方应用原位显示文字框")
      .setSmallIcon(android.R.drawable.ic_menu_camera)
      .setContentIntent(pendingIntent)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 停止服务", stopPendingIntent)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  @SuppressLint("WrongConstant")
  private fun initMediaProjection(resultCode: Int, resultData: Intent) {
    try {
      mediaProjection = mediaProjectionManager?.getMediaProjection(resultCode, resultData)
      mediaProjection?.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          stop(this@ScreenCaptureOverlayService)
        }

        // Android 14+ 核心机制：当系统指定的单个共享应用不可见时（用户切走或切桌面）
        override fun onCapturedContentVisibilityChanged(isVisible: Boolean) {
          Log.d("ScreenCaptureService", "onCapturedContentVisibilityChanged: isVisible=$isVisible")
          updateTargetAppForegroundState(isVisible)
        }

        override fun onCapturedContentResize(width: Int, height: Int) {
          Log.d("ScreenCaptureService", "onCapturedContentResize: ${width}x$height")
        }
      }, mainHandler)

      imageReader = ImageReader.newInstance(
        screenWidth,
        screenHeight,
        PixelFormat.RGBA_8888,
        3
      )

      virtualDisplay = mediaProjection?.createVirtualDisplay(
        "ScreenTranslatorDisplay",
        screenWidth,
        screenHeight,
        screenDensity,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        imageReader?.surface,
        null,
        mainHandler
      )

      // 启动路线 B 实时运动侦测调度器
      startRealtimeMonitoring()

      // 服务建立后延时 350ms 自动触发一次初始全屏扫描，保证刚切入第三方应用即有悬浮文本框
      mainHandler.postDelayed({
        captureScreen()
      }, 350)
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  /**
   * 路线 B 核心：轻量级后台高频帧差运动检测循环 (Scroll Motion Detector)
   * 1. 70ms 高频稀疏采样，耗时 < 0.05ms，零 CPU 压力；
   * 2. 滑动中即时渐变淡化旧气泡，杜绝旧文本在旧坐标脱节悬挂；
   * 3. 停顿 80ms 瞬间判定 Settled，同步最新清晰帧并触发端侧极速 OCR；
   * 4. 视口出界销毁与新内容精准 Fixed 对齐同步呈现！
   */
  /**
   * 路线 B 核心：轻量级后台高频运动侦测与静止自动触发识别循环
   * 1. 60ms 高频轻量采样，零 CPU 压力；
   * 2. 移动发生瞬间：立即清空/销毁屏幕上的所有悬浮框（移动的时候消失，不挡漫画画面）；
   * 3. 移动停止瞬间：当画面保持静止稳定 >= 160ms，自动触发极速 OCR 重新识别并原位显示矩形框；
   * 4. 完美攻克静止时 Android 不推送新帧 (image==null) 导致的漏判问题！
   */
  private fun startRealtimeMonitoring() {
    realtimeMonitorJob?.cancel()
    realtimeMonitorJob = serviceScope.launch {
      while (isActive && isRunning()) {
        delay(60) // 60ms 极低延迟采样周期

        // 1. 前台活跃应用包名检测与跨应用切换即时销毁
        val curForeground = getForegroundPackageName()
        val isCurLauncher = isLauncherPackage(curForeground)

        if (curForeground != null && lastActiveForegroundPackage != null && curForeground != lastActiveForegroundPackage) {
          if (destroyBubblesOnAppSwitch) {
            clearAllHudText()
          }
        }
        if (curForeground != null && !isCurLauncher && curForeground != packageName) {
          lastActiveForegroundPackage = curForeground
        }

        // 2. 关键防护：检测前台活跃应用是否处于有效目标应用界面
        val inTarget = checkIsInTargetApp()
        updateTargetAppForegroundState(inTarget)

        if (!inTarget) {
          continue // 处于非目标状态时跳过抓帧与识别！零开销！
        }

        if (!isRealtimeActive || isCapturing) {
          continue
        }

        val now = System.currentTimeMillis()
        val reader = imageReader ?: continue
        var image: Image? = null
        try {
          image = reader.acquireLatestImage()
        } catch (e: Exception) {
          image = null
        }

        if (image != null) {
          try {
            val currProfile = extractFrameProfile(image)
            if (currProfile != null) {
              val prevProfile = previousProfile
              if (prevProfile == null) {
                previousProfile = currProfile
                // 首次启动抓取帧
                handleImageToBitmapAndOcr(image, isRealtime = true)
                continue
              }

              // 1. 全局网格采样差分比例 (捕获滚动、滑动、翻页)
              val diffRatio = computeSampleDiff(prevProfile.sparseSample, currProfile.sparseSample)

              // 2. 垂直滚动位移检测
              val scrollDy = calculateVerticalScrollOffset(
                prevProfile.rowLuminance,
                currProfile.rowLuminance,
                currProfile.stepY
              )

              // 3. 垂直平均亮度差异检测 (双重灵敏防护)
              var sumRowDiff = 0
              val rowCount = minOf(prevProfile.rowLuminance.size, currProfile.rowLuminance.size)
              for (r in 0 until rowCount) {
                sumRowDiff += abs(currProfile.rowLuminance[r] - prevProfile.rowLuminance[r])
              }
              val avgRowDiff = if (rowCount > 0) sumRowDiff.toFloat() / rowCount else 0f

              // 核心防御 1：悬浮框自身渲染免疫期 (HUD Immunity)
              // 当刚完成一次识别并在屏幕上绘制矩形框时，画面像素的变化完全来自于我们自己的悬浮框上屏绘制！
              // 必须彻底吸收为新静态基准，绝不触发运动状态，绝不调用 onScrollActive()，绝不调度二次识别！
              if (now < hudRenderImmunityUntil) {
                previousProfile = currProfile
                try { image.close() } catch (e: Exception) {}
                image = null
                continue
              }

              previousProfile = currProfile

              // 灵敏运动判定阈值：只要有明显的物理位移、翻页或大幅度滚动
              val hasMotion = (diffRatio > 0.020f) || (scrollDy != 0) || (avgRowDiff > 3.0f)

              if (hasMotion) {
                // 真实滑动正在发生！
                lastMotionTime = now
                settledOcrPending = true

                // 核心突破：移动一旦发生，立即取消并作废后台运行的旧 OCR 任务！
                // 彻底杜绝前序任务延时返回导致的历史屏幕文本闪烁与任务串扰覆盖
                ocrEpoch++
                activeOcrJob?.cancel()
                activeOcrJob = null
                isOcrBusy = false

                if (!isScreenMoving) {
                  isScreenMoving = true
                  mainHandler.post {
                    // 用户需求：移动的时候框立即消失，底层漫画干净可见
                    floatingOverlayView?.onScrollActive()
                  }
                }

                // 暂存移动过程中的最新帧以备停稳后识别 (释放上一帧)
                val oldImg = lastStillImage
                lastStillImage = image
                try { oldImg?.close() } catch (e: Exception) {}
                image = null
              } else {
                // 画面在此刻平稳
                // 核心关键：仅在正在等待停稳识别期间 (settledOcrPending == true) 暂存静止帧！
                // 一旦识别完毕、框体展示后，绝不将带有悬浮框的静止帧存入 lastStillImage！
                if (settledOcrPending) {
                  val oldImg = lastStillImage
                  lastStillImage = image
                  try { oldImg?.close() } catch (e: Exception) {}
                  image = null
                } else {
                  // 处于静止展示状态，直接释放丢弃当前帧，防止污染 OCR 输入源
                  try { image.close() } catch (e: Exception) {}
                  image = null
                }
              }
            }
          } catch (e: Exception) {
            Log.e("ScreenCaptureService", "realtime monitor error", e)
          } finally {
            try {
              image?.close()
            } catch (e: Exception) {}
          }
        }

        // 核心突破：移动停止判定 (即使屏幕完全静止导致 image == null，也能精准判定并触发识别！)
        if (settledOcrPending && !isOcrBusy) {
          val stillDuration = now - lastMotionTime
          // 核心优化：停顿时间阈值设为 250ms (完美避开快速多次划屏时的手指微顿)，
          // 且距上次识别完成 >= 600ms 冷却期，杜绝多次滑动累积任务串扰与二次重复触发。
          // 注意：lastOcrTime 在 processBitmapForOcr 的 finally 块中 OCR 完成时更新，
          // 确保冷却期从"识别结束"而非"识别启动"开始计算。
          if (stillDuration >= 250 && (now - lastOcrTime >= 600)) {
            settledOcrPending = false
            isScreenMoving = false
            // lastOcrTime 不在此处更新，由 processBitmapForOcr finally 块在完成时设置

            mainHandler.post {
              floatingOverlayView?.onScrollSettled()
            }

            // 优先尝试从 reader 抓取最新鲜的停稳静止帧
            var freshImg: Image? = null
            try { freshImg = reader.acquireLatestImage() } catch (e: Exception) {}

            val imgToProcess = freshImg ?: lastStillImage
            if (freshImg != null && lastStillImage != null && freshImg != lastStillImage) {
              try { lastStillImage?.close() } catch (e: Exception) {}
            }
            lastStillImage = null

            if (imgToProcess != null) {
              handleImageToBitmapAndOcr(imgToProcess, isRealtime = true)
            } else {
              // 容错兜底：尝试从缓存位图识别
              val cached = cachedLastBitmap
              if (cached != null && !cached.isRecycled) {
                processBitmapForOcr(cached, isRealtime = true, epoch = ++ocrEpoch)
              }
            }
          }
        }
      }
    }
  }

  /**
   * 提取屏幕画面的高灵敏垂直纵向亮度分布剖面与稀疏采样
   * 1. 垂直剖面 (96 行 x 3 列): 用于 1D 极速互相关匹配，精准测量垂直滚动位移 dy (耗时 < 0.03ms)
   * 2. 全屏 16x32 网格采样: 用于判定画面整体变动程度与静止状态
   */
  private fun extractFrameProfile(image: Image): FrameProfile? {
    try {
      val plane = image.planes[0]
      val buffer: ByteBuffer = plane.buffer
      val rowStride = plane.rowStride
      val pixelStride = plane.pixelStride
      val capacity = buffer.capacity()

      val startY = (screenHeight * 0.10f).toInt()
      val endY = (screenHeight * 0.90f).toInt()
      val numRows = 96
      val stepY = maxOf(2, (endY - startY) / numRows)

      val x1 = (screenWidth * 0.25f).toInt()
      val x2 = (screenWidth * 0.50f).toInt()
      val x3 = (screenWidth * 0.75f).toInt()

      val rowLum = IntArray(numRows)
      for (r in 0 until numRows) {
        val y = startY + r * stepY
        val rowOffset = y * rowStride
        val off1 = rowOffset + x1 * pixelStride
        val off2 = rowOffset + x2 * pixelStride
        val off3 = rowOffset + x3 * pixelStride

        if (off3 + 2 < capacity) {
          val l1 = (buffer.get(off1).toInt() and 0xFF) * 299 + (buffer.get(off1 + 1).toInt() and 0xFF) * 587 + (buffer.get(off1 + 2).toInt() and 0xFF) * 114
          val l2 = (buffer.get(off2).toInt() and 0xFF) * 299 + (buffer.get(off2 + 1).toInt() and 0xFF) * 587 + (buffer.get(off2 + 2).toInt() and 0xFF) * 114
          val l3 = (buffer.get(off3).toInt() and 0xFF) * 299 + (buffer.get(off3 + 1).toInt() and 0xFF) * 587 + (buffer.get(off3 + 2).toInt() and 0xFF) * 114
          rowLum[r] = (l1 + l2 + l3) / 3000
        }
      }

      val cols = 14
      val rows = 28
      val sparseSample = IntArray(cols * rows)
      var sIdx = 0
      // 避免屏幕左右最外侧 12% 边缘 (悬浮球区域与通知抽屉手势边缘)，只采样纯漫画阅读内容区
      val startX = (screenWidth * 0.12f).toInt()
      val endX = (screenWidth * 0.88f).toInt()
      val sStepX = maxOf(2, (endX - startX) / (cols + 1))
      val sStepY = maxOf(2, screenHeight / (rows + 1))
      for (sr in 1..rows) {
        val sy = sr * sStepY
        val sRowStart = sy * rowStride
        for (sc in 1..cols) {
          val sx = startX + sc * sStepX
          val sOffset = sRowStart + sx * pixelStride
          if (sOffset + 2 < capacity) {
            val red = buffer.get(sOffset).toInt() and 0xFF
            val green = buffer.get(sOffset + 1).toInt() and 0xFF
            val blue = buffer.get(sOffset + 2).toInt() and 0xFF
            sparseSample[sIdx++] = (red * 299 + green * 587 + blue * 114) / 1000
          } else {
            sparseSample[sIdx++] = 0
          }
        }
      }

      return FrameProfile(rowLum, stepY, sparseSample)
    } catch (e: Exception) {
      return null
    }
  }

  /**
   * 1D 极速互相关匹配：计算相邻两帧画面之间的真实物理垂直滚动偏移量 (px)
   */
  private fun calculateVerticalScrollOffset(prev: IntArray, curr: IntArray, stepY: Int): Int {
    val n = curr.size
    var bestShift = 0
    var minMad = Float.MAX_VALUE
    var zeroShiftMad = Float.MAX_VALUE

    val maxShift = 16 // 搜索 ±16 步 (约 ±300px)

    for (s in -maxShift..maxShift) {
      var sumDiff = 0L
      var count = 0
      val start = maxOf(0, -s)
      val end = minOf(n, n - s)
      for (i in start until end) {
        sumDiff += abs(curr[i + s] - prev[i])
        count++
      }
      if (count > n / 2) {
        val mad = sumDiff.toFloat() / count
        if (s == 0) {
          zeroShiftMad = mad
        }
        if (mad < minMad) {
          minMad = mad
          bestShift = s
        }
      }
    }

    if (zeroShiftMad < 5.5f) {
      return 0
    }

    // bestShift > 0 表示内容下移 (当前帧匹配位置靠下)
    // bestShift < 0 表示内容上移
    if (bestShift != 0 && minMad < zeroShiftMad * 0.70f && minMad < 22.0f) {
      return bestShift * stepY
    }

    return 0
  }

  /**
   * 计算两帧采样点之间的差异比例 (灵敏捕获细微滚动与翻页)
   */
  private fun computeSampleDiff(a: IntArray, b: IntArray): Float {
    val size = minOf(a.size, b.size)
    if (size == 0) return 0f
    var diffCount = 0
    for (i in 0 until size) {
      if (abs(a[i] - b[i]) > 14) {
        diffCount++
      }
    }
    return diffCount.toFloat() / size
  }

  /**
   * 用户轻触悬浮球时触发的即时识别：
   * 立即抓取第三方应用画面，识别全部文字与语种，并原位悬浮展示文本框！
   */
  fun captureScreen() {
    if (isCapturing) return

    // 关键拦截：若不在目标应用中，坚决不响应任何截屏，绝不触发 loading！
    if (!checkIsInTargetApp()) {
      updateTargetAppForegroundState(false)
      return
    }

    isCapturing = true

    floatingOverlayView?.setBallState("识别中...", true)

    mainHandler.postDelayed({
      processImageCapture()
    }, 40)
  }

  private fun processImageCapture() {
    serviceScope.launch {
      var image: Image? = null
      // 容错重试抓帧 (最多 4 次，每次间隔 30ms)
      for (retry in 0..3) {
        try {
          image = imageReader?.acquireLatestImage()
          if (image != null) break
        } catch (e: Exception) {}
        delay(30)
      }

      if (image == null) {
        val cached = cachedLastBitmap
        if (cached != null && !cached.isRecycled) {
          processBitmapForOcr(cached, isRealtime = false, epoch = ++ocrEpoch)
          return@launch
        }
        finishCapture(null, 0, 0, emptyList())
        return@launch
      }

      handleImageToBitmapAndOcr(image, isRealtime = false)
    }
  }

  private fun setupFloatingOverlayCallbacks(view: FloatingOverlayView) {
    view.onReOcrSingleBoxRequested = { item ->
      val boxRect = Rect(item.x, item.y, item.x + item.width, item.y + item.height)
      reOcrSingleBox(boxRect) { result ->
        view.onSingleBoxOcrResult(item, result)
      }
    }
  }

  /**
   * 将 Image 转化为屏幕物理像素对应的 Bitmap
   */
  private fun convertImageToBitmap(image: Image): Bitmap? {
    return try {
      val planes = image.planes
      val buffer = planes[0].buffer
      val pixelStride = planes[0].pixelStride
      val rowStride = planes[0].rowStride
      val rowPadding = rowStride - pixelStride * screenWidth

      val rawBitmap = Bitmap.createBitmap(
        screenWidth + rowPadding / pixelStride,
        screenHeight,
        Bitmap.Config.ARGB_8888
      )
      rawBitmap.copyPixelsFromBuffer(buffer)

      if (rowPadding > 0) {
        val cropped = Bitmap.createBitmap(rawBitmap, 0, 0, screenWidth, screenHeight)
        rawBitmap.recycle()
        cropped
      } else {
        rawBitmap
      }
    } catch (e: Exception) {
      Log.e("ScreenCaptureService", "convertImageToBitmap failed", e)
      null
    }
  }

  /**
   * 针对用户点击的特定文本框区域进行精准局部重新 OCR (不重新抓取或处理全屏幕)
   */
  fun reOcrSingleBox(
    boxRect: Rect,
    callback: (MangaOcrProcessor.SingleRegionOcrResult?) -> Unit
  ) {
    serviceScope.launch {
      var latestBmp: Bitmap? = null
      try {
        val img = imageReader?.acquireLatestImage()
        if (img != null) {
          latestBmp = convertImageToBitmap(img)
          img.close()
          if (latestBmp != null) {
            cachedLastBitmap = latestBmp
          }
        }
      } catch (e: Exception) {}

      val bmp = latestBmp ?: cachedLastBitmap
      if (bmp == null || bmp.isRecycled) {
        mainHandler.post { callback(null) }
        return@launch
      }

      try {
        val ocrEngine = when (sourceLanguageFilter) {
          "ja" -> "ja"
          "zh" -> "zh"
          "en" -> "en"
          "ko" -> "ko"
          else -> "auto"
        }
        val result = MangaOcrProcessor.reOcrSingleRegion(
          sourceBitmap = bmp,
          region = boxRect,
          lang = ocrEngine,
          filterLang = sourceLanguageFilter
        )
        mainHandler.post {
          callback(result)
        }
      } catch (e: Exception) {
        Log.e("ScreenCaptureService", "reOcrSingleBox failed", e)
        mainHandler.post {
          callback(null)
        }
      }
    }
  }

  /**
   * 将 Image 转化为 Bitmap 并送入全语言通用 OCR 管线
   *
   * 修复：epoch 在 bitmap 转换【之前】立即自增并锁定快照。
   * 这样，若在转换期间用户再次滑动触发 ocrEpoch++，当前 currentEpoch 就和全局不一致，
   * processBitmapForOcr 内的校验会正确丢弃已过时的旧任务，彻底杜绝历史帧渲染到错误坐标。
   */
  private fun handleImageToBitmapAndOcr(image: Image, isRealtime: Boolean) {
    if (isOcrBusy) {
      image.close()
      return
    }
    isOcrBusy = true
    // 关键修复：在任何耗时操作之前立即递增并锁定本次任务的代际 epoch 快照！
    // 若后续滑动再次触发 ocrEpoch++，本次任务的 currentEpoch 将与全局不一致，
    // processBitmapForOcr 会正确校验并丢弃此过时结果。
    val currentEpoch = ++ocrEpoch

    try {
      val croppedBitmap = convertImageToBitmap(image)
      image.close()

      // 若 bitmap 转换期间发生了新的滚动（ocrEpoch 被再次递增），立即作废
      if (currentEpoch != ocrEpoch) {
        croppedBitmap?.recycle()
        isOcrBusy = false
        return
      }

      if (croppedBitmap == null) {
        isOcrBusy = false
        finishCapture(null, 0, 0, emptyList())
        return
      }

      // 缓存最新有效帧
      cachedLastBitmap = croppedBitmap

      processBitmapForOcr(croppedBitmap, isRealtime, currentEpoch)
    } catch (e: Exception) {
      isOcrBusy = false
      try { image.close() } catch (ex: Exception) {}
      finishCapture(null, 0, 0, emptyList())
    }
  }

  private fun processBitmapForOcr(bitmap: Bitmap, isRealtime: Boolean, epoch: Long = ocrEpoch) {
    activeOcrJob?.cancel()
    activeOcrJob = serviceScope.launch {
      try {
        // 根据指定的语言选择最优的端侧 OCR 识别引擎与语种过滤
        val ocrEngine = when (sourceLanguageFilter) {
          "ja" -> "ja"
          "zh" -> "zh"
          "en" -> "en"
          "ko" -> "ko"
          else -> "auto"
        }
        val detectedBubbles = MangaOcrProcessor.processImageFast(
          bitmap = bitmap,
          lang = ocrEngine,
          filterLang = sourceLanguageFilter,
          viewportMode = viewportMode,
          context = this@ScreenCaptureOverlayService
        )

        // 核心校验：如果当前协程已被取消、代际已过时 (用户又滑动了)、或屏幕仍在移动中，彻底丢弃！
        if (!isActive || epoch != ocrEpoch || isScreenMoving) {
          return@launch
        }

        // 1. 立即在第三方应用屏幕的原位坐标 HUD 层悬浮显示文本框 (若当前仍在移动中或代际不一致则坚决不显示旧框)
        mainHandler.post {
          if (!isScreenMoving && epoch == ocrEpoch) {
            floatingOverlayView?.updateRealtimeBubbles(detectedBubbles)
            // 修复：在悬浮框实际渲染到 WindowManager 之后才启动免疫期计时，时序更精确。
            // 延长至 1200ms：确保 SurfaceFlinger 多窗口合成、VSync 刷新与 ImageReader 缓冲区
            // 全部吸收新悬浮框像素，彻底杜绝自身渲染引起的"假运动"触发二次识别与坐标错乱。
            hudRenderImmunityUntil = System.currentTimeMillis() + 1200L
          }
        }

        // 2. 静默通知 React Native 记录数据 (不拉起主应用)
        var cacheFilePath: String? = null
        if (!isRealtime) {
          val outputFile = File(cacheDir, "screen_trans_${System.currentTimeMillis()}.jpg")
          val fos = FileOutputStream(outputFile)
          bitmap.compress(Bitmap.CompressFormat.JPEG, 90, fos)
          fos.flush()
          fos.close()
          cacheFilePath = outputFile.absolutePath
        }

        if (epoch == ocrEpoch) {
          finishCapture(cacheFilePath, screenWidth, screenHeight, detectedBubbles)
        }
      } catch (e: Exception) {
        if (e !is kotlinx.coroutines.CancellationException) {
          Log.e("ScreenCaptureService", "OCR execution failed", e)
        }
        finishCapture(null, 0, 0, emptyList())
      } finally {
        if (epoch == ocrEpoch) {
          isOcrBusy = false
          // 修复：lastOcrTime 在 OCR 任务真正完成时更新，而非启动时。
          // 确保 600ms 冷却期从"上次 OCR 结束"开始计算，防止长滑动时冷却期被提前耗尽。
          if (isRealtime) {
            lastOcrTime = System.currentTimeMillis()
          }
        }
      }
    }
  }

  private fun finishCapture(
    filePath: String?,
    width: Int,
    height: Int,
    detectedBubbles: List<Map<String, Any>>
  ) {
    mainHandler.post {
      floatingOverlayView?.setBallVisibility(true)
      isCapturing = false

      if (detectedBubbles.isNotEmpty()) {
        isOverlayShowingText = true
        val currentDisplayMode = floatingOverlayView?.hudDisplayMode ?: "ocr"
        val isTranslatingMode = currentDisplayMode != "box" && currentDisplayMode != "ocr"
        if (isTranslatingMode) {
          // 画面中检测到了文本块且处于翻译模式：悬浮球保持无缝进入“翻译中”动态加载状态
          floatingOverlayView?.setBallState("翻译中", true)
        } else {
          floatingOverlayView?.setBallState("就绪", false)
        }
      } else {
        floatingOverlayView?.setBallState("就绪", false)
      }

      // 发送事件给前端记录（后台静默记录，绝不打扰第三方应用界面）
      ScreenTranslatorOverlayModule.emitScreenCaptured(filePath ?: "", width, height, detectedBubbles)
    }
  }

  fun setBallLoading(isLoading: Boolean, statusText: String = "翻译中") {
    mainHandler.post {
      floatingOverlayView?.setBallState(statusText, isLoading)
    }
  }

  fun updateTranslation(bubblesJson: String) {
    if (!targetAppPackage.isNullOrEmpty()) {
      val curForeground = getForegroundPackageName()
      if (curForeground != null && curForeground != targetAppPackage && curForeground != packageName) {
        if (destroyBubblesOnAppSwitch) {
          // 用户已切出目标应用，且设定为销毁气泡，丢弃延迟回传的结果，不显示到其他应用上
          floatingOverlayView?.setBallState("待机", false)
          return
        }
      }
    }
    mainHandler.post {
      floatingOverlayView?.showTranslationResultCard(bubblesJson)
      floatingOverlayView?.setBallState("就绪", false)
    }
  }

  fun setRealtimeMode(enabled: Boolean) {
    isRealtimeActive = enabled
    floatingOverlayView?.setRealtimeMode(enabled)
  }

  fun setSourceLanguageFilter(lang: String) {
    sourceLanguageFilter = lang.lowercase().trim()
    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    prefs.edit().putString("source_language_filter", sourceLanguageFilter).apply()
    floatingOverlayView?.setTargetLanguageFilter(sourceLanguageFilter)
  }

  fun getSourceLanguageFilter(): String = sourceLanguageFilter

  fun setDestroyBubblesOnAppSwitch(destroy: Boolean) {
    destroyBubblesOnAppSwitch = destroy
    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    prefs.edit().putBoolean("destroy_bubbles_on_app_switch", destroy).apply()
    floatingOverlayView?.setDestroyBubblesOnAppSwitch(destroy)
  }

  fun setOutsideAppBallBehavior(behavior: String) {
    outsideAppBallBehavior = behavior
    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    prefs.edit().putString("outside_app_ball_behavior", behavior).apply()
    floatingOverlayView?.setOutsideAppBallBehavior(behavior)
  }

  fun setViewportMode(mode: String) {
    viewportMode = mode.lowercase().trim()
    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    prefs.edit().putString("viewport_mode", viewportMode).apply()
    floatingOverlayView?.setViewportMode(viewportMode)
  }

  /**
   * 彻底销毁清空屏幕上的全部悬浮文本框
   */
  fun clearAllHudText() {
    cachedLastBitmap?.recycle()
    cachedLastBitmap = null
    previousProfile = null
    ocrEpoch++
    activeOcrJob?.cancel()
    activeOcrJob = null
    isOcrBusy = false
    try {
      lastStillImage?.close()
    } catch (e: Exception) {}
    lastStillImage = null
    hudRenderImmunityUntil = 0L
    isScreenMoving = false
    settledOcrPending = false
    isOverlayShowingText = false
    mainHandler.post {
      floatingOverlayView?.clearHudBubbles()
    }
    ScreenTranslatorOverlayModule.emitHudCleared()
  }

  /**
   * 判断当前翻译器自身应用是否处于前台显示状态（零权限、毫秒级响应）
   */
  fun isMyAppInForeground(): Boolean {
    if (isMyActivityResumed) return true
    return try {
      val appProcessInfo = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(appProcessInfo)
      appProcessInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    } catch (e: Exception) {
      false
    }
  }

  /**
   * 检查是否已授予“使用情况访问权限”
   */
  fun hasUsageStatsPermission(): Boolean {
    val appOps = getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  /**
   * 缓存并获取系统所有桌面启动器包名
   */
  fun getLauncherPackages(): Set<String> {
    if (cachedLauncherPackages.isNotEmpty()) {
      return cachedLauncherPackages
    }
    val pkgs = mutableSetOf<String>()
    try {
      val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
      val defaultResolve = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        packageManager.resolveActivity(intent, 0)
      }
      defaultResolve?.activityInfo?.packageName?.let { pkgs.add(it) }

      val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.queryIntentActivities(
          intent,
          PackageManager.ResolveInfoFlags.of(0)
        )
      } else {
        @Suppress("DEPRECATION")
        packageManager.queryIntentActivities(intent, 0)
      }
      for (info in list) {
        info.activityInfo?.packageName?.let { pkgs.add(it) }
      }
    } catch (e: Exception) {
      Log.w("ScreenCaptureService", "getLauncherPackages failed", e)
    }
    // 覆盖各大品牌主流桌面及 SystemUI 包名兜底
    pkgs.add("com.android.launcher")
    pkgs.add("com.android.launcher3")
    pkgs.add("com.google.android.apps.nexuslauncher")
    pkgs.add("com.miui.home")
    pkgs.add("com.huawei.android.launcher")
    pkgs.add("com.hihonor.android.launcher")
    pkgs.add("com.oppo.launcher")
    pkgs.add("com.coloros.launcher")
    pkgs.add("com.heytap.launcher")
    pkgs.add("net.oneplus.launcher")
    pkgs.add("com.oneplus.launcher")
    pkgs.add("com.bbk.launcher2")
    pkgs.add("com.vivo.upslide")
    pkgs.add("com.vivo.launcher")
    pkgs.add("com.sec.android.app.launcher")
    pkgs.add("com.meizu.flyme.launcher")
    pkgs.add("com.transsion.hilauncher")
    pkgs.add("com.transsion.xoslauncher")
    pkgs.add("com.teslacoilsw.launcher")
    pkgs.add("com.microsoft.launcher")
    pkgs.add("com.android.systemui")

    cachedLauncherPackages = pkgs
    return pkgs
  }

  fun isLauncherPackage(pkg: String?): Boolean {
    if (pkg.isNullOrEmpty()) return false
    return getLauncherPackages().contains(pkg)
  }

  fun getLauncherPackageName(): String? {
    return getLauncherPackages().firstOrNull()
  }

  fun getAppLabel(pkg: String): String {
    return try {
      val pm = packageManager
      val appInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getApplicationInfo(pkg, 0)
      }
      pm.getApplicationLabel(appInfo).toString()
    } catch (e: Exception) {
      pkg
    }
  }

  /**
   * 获取当前前台活跃的第三方应用包名
   */
  fun getForegroundPackageName(): String? {
    if (!hasUsageStatsPermission()) {
      return null
    }

    try {
      val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return lastKnownForegroundPackage
      val now = System.currentTimeMillis()

      // 1. 优先使用 UsageEvents 查询最近 10 秒内的生命周期事件 (毫秒级响应)
      val events = usageStatsManager.queryEvents(now - 10000, now)
      val event = UsageEvents.Event()
      var latestPackage: String? = null
      var latestTime = 0L

      var latestTargetResumeTime = 0L
      var latestTargetStopTime = 0L

      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val eventType = event.eventType
        val pkg = event.packageName
        val time = event.timeStamp

        // 兼容 Android 10+ ACTIVITY_RESUMED (2) 及低版本 MOVE_TO_FOREGROUND (1)
        if ((eventType == UsageEvents.Event.ACTIVITY_RESUMED || eventType == 1) && time >= latestTime) {
          latestPackage = pkg
          latestTime = time
        }

        // 监测目标应用离开状态
        if (targetAppPackage != null && pkg == targetAppPackage) {
          if (eventType == UsageEvents.Event.ACTIVITY_RESUMED || eventType == 1) {
            if (time > latestTargetResumeTime) latestTargetResumeTime = time
          } else if (eventType == 23 || eventType == 4) { // STOPPED or PAUSED
            if (time > latestTargetStopTime) latestTargetStopTime = time
          }
        }
      }

      // 如果目标应用的 stop/pause 晚于 resume 超过 300ms，说明目标应用已不可见（已切出或回到桌面）
      if (targetAppPackage != null && latestTargetStopTime > latestTargetResumeTime + 300) {
        val launcher = getLauncherPackageName() ?: "com.android.launcher"
        lastKnownForegroundPackage = launcher
        return launcher
      }

      if (!latestPackage.isNullOrEmpty()) {
        lastKnownForegroundPackage = latestPackage
        return latestPackage
      }

      // 2. 如果最近 10 秒没有新的前台切换事件，说明用户一直在同一个前台界面停留，
      // 用 queryUsageStats 查询最后使用时间最近的应用
      val statsList = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 60000, now)
      val mostRecent = statsList?.filter { it.lastTimeUsed > 0 }?.maxByOrNull { it.lastTimeUsed }
      if (mostRecent != null && !mostRecent.packageName.isNullOrEmpty()) {
        lastKnownForegroundPackage = mostRecent.packageName
        return mostRecent.packageName
      }

      return lastKnownForegroundPackage
    } catch (e: Exception) {
      return lastKnownForegroundPackage
    }
  }

  /**
   * 综合判定当前用户是否处于有效目标应用界面中
   * - 在本应用配置界面：始终 false（休眠穿透）
   * - 若开启使用情况权限：
   *    - 若已锁定目标应用：严格要求当前前台包名为目标应用且非桌面
   *    - 若未锁定目标应用：只要当前前台包名非桌面且非本应用即判定为有效
   * - 若未开启使用情况权限：
   *    - 离开本应用进入第三方应用即判定为有效（确保零权限下核心翻译可用）
   */
  fun checkIsInTargetApp(): Boolean {
    // 1. 正在本翻译应用界面内：绝对处于非目标状态（保持休眠）
    if (isMyAppInForeground()) {
      return false
    }

    val curForeground = getForegroundPackageName()
    val isCurLauncher = isLauncherPackage(curForeground)

    return if (!targetAppPackage.isNullOrEmpty()) {
      // 已指定锁定目标应用
      if (curForeground != null) {
        curForeground == targetAppPackage && !isCurLauncher
      } else {
        // 无使用情况权限时，用户离开本应用即进入目标阅读状态
        true
      }
    } else {
      // 未指定目标应用（全应用可用）
      if (curForeground != null) {
        !isCurLauncher && curForeground != packageName
      } else {
        true
      }
    }
  }

  fun updateTargetAppForegroundState(inTarget: Boolean) {
    if (isTargetAppInForeground == inTarget) return
    isTargetAppInForeground = inTarget
    mainHandler.post {
      floatingOverlayView?.setTargetAppForegroundState(inTarget)
      if (!inTarget) {
        if (destroyBubblesOnAppSwitch) {
          clearAllHudText()
        }
      } else {
        if (isRealtimeActive) {
          mainHandler.postDelayed({
            captureScreen()
          }, 250)
        }
      }
    }
  }

  /**
   * 设置指定目标应用包名与名称
   */
  fun setTargetApp(pkg: String?, name: String?) {
    val cleanPkg = pkg?.trim()?.ifEmpty { null }
    val cleanName = name?.trim()?.ifEmpty { null }
    if (targetAppPackage == cleanPkg && targetAppName == cleanName) {
      return
    }

    targetAppPackage = cleanPkg
    targetAppName = cleanName
    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    prefs.edit().apply {
      putString("target_app_package", targetAppPackage)
      putString("target_app_name", targetAppName)
      apply()
    }
    floatingOverlayView?.setTargetApp(targetAppPackage, targetAppName)

    val inTarget = checkIsInTargetApp()
    updateTargetAppForegroundState(inTarget)
  }

  /**
   * 一键锁定当前前台正在运行的应用
   */
  fun lockCurrentForegroundApp(): Pair<String, String>? {
    val pkg = getForegroundPackageName()
    if (pkg.isNullOrEmpty() || pkg == packageName || isLauncherPackage(pkg)) {
      return null
    }
    val name = getAppLabel(pkg)
    setTargetApp(pkg, name)
    return Pair(pkg, name)
  }

  private fun teardown() {
    if (isLifecycleCallbacksRegistered) {
      try {
        application.unregisterActivityLifecycleCallbacks(activityLifecycleCallbacks)
        isLifecycleCallbacksRegistered = false
      } catch (e: Exception) {}
    }
    realtimeMonitorJob?.cancel()
    realtimeMonitorJob = null
    ocrEpoch++
    activeOcrJob?.cancel()
    activeOcrJob = null
    isOcrBusy = false
    try {
      serviceScope.coroutineContext.cancelChildren()
    } catch (e: Exception) {}
    try {
      lastStillImage?.close()
    } catch (e: Exception) {}
    lastStillImage = null
    try {
      virtualDisplay?.release()
    } catch (e: Exception) {}
    virtualDisplay = null
    try {
      imageReader?.close()
    } catch (e: Exception) {}
    imageReader = null
    try {
      mediaProjection?.stop()
    } catch (e: Exception) {}
    mediaProjection = null
    try {
      floatingOverlayView?.hide()
    } catch (e: Exception) {}
    floatingOverlayView = null
    try {
      cachedLastBitmap?.recycle()
    } catch (e: Exception) {}
    cachedLastBitmap = null
    currentService = null
    ScreenTranslatorOverlayModule.emitServiceStateChanged(false)
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    Log.d("ScreenCaptureService", "onTaskRemoved: 用户在多任务列表中划掉了应用卡片")
    val prefs = getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    val stopOnTaskRemoved = prefs.getBoolean("stop_service_on_task_removed", true)
    if (stopOnTaskRemoved) {
      stop(this)
      killAllAppProcesses(this)
    }
  }

  override fun onDestroy() {
    teardown()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
    } catch (e: Exception) {}
    try {
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      notificationManager?.cancel(NOTIFICATION_ID)
    } catch (e: Exception) {}
    currentService = null
    super.onDestroy()
  }
}
