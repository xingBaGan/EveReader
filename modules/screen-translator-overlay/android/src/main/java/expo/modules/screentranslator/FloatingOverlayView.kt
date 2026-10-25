package expo.modules.screentranslator

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.RelativeSizeSpan
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

@SuppressLint("ClickableViewAccessibility")
class FloatingOverlayView(
  private val context: Context,
  private val windowManager: WindowManager,
  private val onCaptureClicked: () -> Unit,
  private val onScreenTapTrigger: () -> Unit,
  private val onCloseClicked: () -> Unit,
  private val onToggleRealtimeMode: ((Boolean) -> Unit)? = null,
  private val onLanguageFilterChanged: ((String) -> Unit)? = null,
  private val onLockCurrentAppClicked: (() -> Unit)? = null,
  private val onUnlockAppClicked: (() -> Unit)? = null,
  private val onDestroyOnAppSwitchChanged: ((Boolean) -> Unit)? = null,
  private val onOutsideAppBallBehaviorChanged: ((String) -> Unit)? = null,
  private val onViewportModeChanged: ((String) -> Unit)? = null
) {

  private val mainHandler = Handler(Looper.getMainLooper())
  private var isBallAdded = false

  private val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
  } else {
    @Suppress("DEPRECATION")
    WindowManager.LayoutParams.TYPE_PHONE
  }

  // 1. 悬浮球 View
  private val ballView: FrameLayout = FrameLayout(context)
  private val ballText: TextView = TextView(context)
  private val ballLoadingView: TextView = TextView(context) // 识别/翻译中的动态 Loading Icon
  private var loadingRotateAnimator: ObjectAnimator? = null
  private var loadingPulseAnimator: AnimatorSet? = null
  private val ballStatusBadge: TextView = TextView(context)
  private val ballParams: WindowManager.LayoutParams

  // 2. 悬浮快捷控制与结果卡片 View
  private val cardView: FrameLayout = FrameLayout(context)
  private val cardContentLayout: LinearLayout = LinearLayout(context)
  private val cardParams: WindowManager.LayoutParams
  private var isCardVisible = false

  // 3. 全屏触摸穿透实时原位坐标标注层 (Touch-Through HUD Overlay)
  // 关键：FLAG_NOT_TOUCHABLE 确保第三方应用所有滑动手势和点击 100% 丝滑穿透！
  private val hudOverlayView: FrameLayout = FrameLayout(context)
  private val hudParams: WindowManager.LayoutParams
  private var isHudAdded = false

  // 4. 全屏幕触摸监听锚点 (Touch Watcher)
  // 核心机制：利用 FLAG_WATCH_OUTSIDE_TOUCH 在 100% 穿透不拦截第三方应用点击的前提下，精准感知用户“轻触/点击屏幕”并瞬间触发识别！
  private val touchWatcher: View = View(context)
  private val touchWatcherParams: WindowManager.LayoutParams
  private var isTouchWatcherAdded = false
  private var lastScreenTapTriggerTime = 0L

  // 5. 全屏气泡原地覆盖层 (Inpaint 交互测试)
  private val inpaintOverlayView: FrameLayout = FrameLayout(context)
  private val inpaintParams: WindowManager.LayoutParams
  private var isInpaintOverlayVisible = false

  // 运行配置状态
  var isRealtimeMode: Boolean = true
    private set
  var isHudVisible: Boolean = true
    private set
  var hudDisplayMode: String = "box" // "box" (仅标出矩形大小) | "ocr" | "target" | "both"
    private set
  var targetLangFilter: String = "ja" // 默认只识别指定语言（如日文 ja，或 en/zh/ko/auto）
    private set
  var targetAppPackage: String? = null // 指定的目标应用包名（若指定，切换离开时自动销毁屏幕文字）
    private set
  var targetAppName: String? = null // 指定的目标应用名称
    private set
  var destroyBubblesOnAppSwitch: Boolean = true // 切换离开目标应用时是否销毁屏幕文字 (true=销毁, false=保留供查阅)
    private set
  var isTargetAppForeground: Boolean = true // 当前是否处于指定的锁定的目标应用前台
    private set
  var outsideAppBallBehavior: String = "dormant" // "dormant"(待机不可点) | "hide"(完全隐藏) | "touch_through"(触摸穿透)
    private set
  var viewportMode: String = "full" // "full"(全屏模式，默认) | "golden"(黄金阅读视口) | "center50"(中央50%)
    private set

  private var allRawBubbles: List<Map<String, Any>> = emptyList()
  private var currentBubbles: List<Map<String, Any>> = emptyList()

  private var screenWidth: Int
  private var screenHeight: Int
  private var edgeAnimator: ValueAnimator? = null

  var onReOcrSingleBoxRequested: ((ActiveHudItem) -> Unit)? = null

  data class SingleHudViewData(
    val view: View,
    val targetW: Int,
    val fixedLeft: Int,
    val fixedTop: Int,
    val targetH: Int = 0
  )

  // 活跃 HUD 悬浮框追踪：每个气泡均为独立 WindowManager 悬浮窗，支持原生直接点击与外部穿透！
  data class ActiveHudItem(
    val id: String,
    var view: View,
    var windowParams: WindowManager.LayoutParams,
    var sourceText: String,
    var targetText: String = "",
    var langName: String = "文本",
    var langColorHex: String = "#0EA5E9",
    var isVertical: Boolean = false,
    var columnCount: Int = 0,
    var originalLines: List<String>? = null,
    var x: Int,
    var y: Int,
    var width: Int,
    var height: Int,
    var fontSizePx: Float = 0f,
    var isReOcring: Boolean = false,
    var baseAlpha: Float = 1.0f,
    var currentHudMode: String = "ocr",
    var confidence: Float = 0.90f,
    var originalId: String = ""
  )
  private val activeHudMap = HashMap<String, ActiveHudItem>()

  private fun getRealScreenWidth(): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      return windowManager.currentWindowMetrics.bounds.width()
    }
    val realMetrics = android.util.DisplayMetrics()
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(realMetrics)
    return realMetrics.widthPixels
  }

  private fun getRealScreenHeight(): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      return windowManager.currentWindowMetrics.bounds.height()
    }
    val realMetrics = android.util.DisplayMetrics()
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(realMetrics)
    return realMetrics.heightPixels
  }

  init {
    screenWidth = getRealScreenWidth()
    screenHeight = getRealScreenHeight()

    val ballSize = dpToPx(58f)

    val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
    hudDisplayMode = prefs.getString("hud_display_mode", "ocr") ?: "ocr"

    // 1. 初始化悬浮球参数
    ballParams = WindowManager.LayoutParams(
      ballSize,
      ballSize,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenWidth - ballSize - dpToPx(16f)
      y = screenHeight / 3
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }

    setupBallView(ballSize)

    // 2. 初始化悬浮控制卡片参数
    val cardWidth = (screenWidth * 0.88).toInt()
    val cardMaxHeight = (screenHeight * 0.55).toInt()
    cardParams = WindowManager.LayoutParams(
      cardWidth,
      WindowManager.LayoutParams.WRAP_CONTENT,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
      y = screenHeight / 5
    }

    setupCardView(cardMaxHeight)

    // 3. 初始化全屏触摸穿透实时原位标注层 (HUD Overlay)
    hudParams = WindowManager.LayoutParams(
      screenWidth,
      screenHeight,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = 0
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
    hudOverlayView.clipChildren = false
    hudOverlayView.clipToPadding = false

    // 4. 初始化全屏幕外部点击监听锚点参数 (FLAG_WATCH_OUTSIDE_TOUCH)
    // 尺寸为 1x1 像素透明点，不阻拦不拦截第三方应用的任何点击，同时感知用户在屏幕任意区域的轻点手势！
    touchWatcherParams = WindowManager.LayoutParams(
      1,
      1,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = 0
    }

    // 5. 初始化全屏气泡覆盖层参数 (不可穿透模态测试)
    inpaintParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
    }
  }

  private fun setupBallView(ballSize: Int) {
    val bgDrawable = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      colors = intArrayOf(Color.parseColor("#4F46E5"), Color.parseColor("#06B6D4"))
      orientation = GradientDrawable.Orientation.TL_BR
      setStroke(dpToPx(2f), Color.parseColor("#FFFFFF"))
    }
    ballView.background = bgDrawable
    ballView.elevation = dpToPx(8f).toFloat()

    ballText.text = "⚡"
    ballText.setTextColor(Color.WHITE)
    ballText.textSize = 20f
    ballText.typeface = Typeface.DEFAULT_BOLD
    ballText.gravity = Gravity.CENTER

    val textParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    )
    ballView.addView(ballText, textParams)

    // 旋转加载 Icon：识别中时平滑顺畅旋转，提供强视觉反馈
    ballLoadingView.apply {
      text = "↻"
      setTextColor(Color.WHITE)
      textSize = 26f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      visibility = View.GONE
    }
    val loadingParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    )
    ballView.addView(ballLoadingView, loadingParams)

    loadingRotateAnimator = ObjectAnimator.ofFloat(ballLoadingView, View.ROTATION, 0f, 360f).apply {
      duration = 750
      repeatCount = ValueAnimator.INFINITE
      interpolator = LinearInterpolator()
    }

    val pulseX = ObjectAnimator.ofFloat(ballLoadingView, View.SCALE_X, 0.88f, 1.15f).apply {
      duration = 600
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      interpolator = AccelerateDecelerateInterpolator()
    }
    val pulseY = ObjectAnimator.ofFloat(ballLoadingView, View.SCALE_Y, 0.88f, 1.15f).apply {
      duration = 600
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      interpolator = AccelerateDecelerateInterpolator()
    }
    loadingPulseAnimator = AnimatorSet().apply {
      playTogether(pulseX, pulseY)
    }

    // 悬浮球右上角微型状态胶囊 (LIVE / 数量)
    ballStatusBadge.apply {
      text = "LIVE"
      setTextColor(Color.WHITE)
      textSize = 8.5f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      val badgeBg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dpToPx(4f).toFloat()
        setColor(Color.parseColor("#10B981")) // 绿色激活
      }
      background = badgeBg
      setPadding(dpToPx(3f), dpToPx(1f), dpToPx(3f), dpToPx(1f))
    }
    val badgeParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.WRAP_CONTENT,
      FrameLayout.LayoutParams.WRAP_CONTENT
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      topMargin = dpToPx(2f)
      rightMargin = dpToPx(2f)
    }
    ballView.addView(ballStatusBadge, badgeParams)

    var initialX = 0
    var initialY = 0
    var initialTouchX = 0f
    var initialTouchY = 0f
    var isDragging = false
    var downTime = 0L
    val touchSlop = dpToPx(6f)

    ballView.setOnTouchListener { _, event ->
      if (!isTargetAppForeground) {
        // 切出目标应用：变不可点击，完全不响应不消费任何触摸事件，直接穿透给底层应用
        return@setOnTouchListener false
      }
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          edgeAnimator?.cancel()
          initialX = ballParams.x
          initialY = ballParams.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          isDragging = false
          downTime = System.currentTimeMillis()
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - initialTouchX
          val dy = event.rawY - initialTouchY
          if (isDragging || Math.hypot(dx.toDouble(), dy.toDouble()) > touchSlop) {
            isDragging = true
            val curWidth = getRealScreenWidth()
            val curHeight = getRealScreenHeight()
            ballParams.x = (initialX + dx).toInt().coerceIn(0, curWidth - ballSize)
            ballParams.y = (initialY + dy).toInt().coerceIn(0, curHeight - ballSize)
            try {
              windowManager.updateViewLayout(ballView, ballParams)
            } catch (e: Exception) {}
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          val pressDuration = System.currentTimeMillis() - downTime
          if (!isDragging) {
            if (pressDuration > 450) {
              // 长按悬浮球：展开/收起快捷设置卡片（切换语种、模式等）
              toggleControlCard()
            } else {
              // 单击悬浮球：
              if (!isTargetAppForeground) {
                return@setOnTouchListener false
              }

              if (isCardVisible) {
                dismissCard()
              }
              onCaptureClicked()
            }
          } else {
            // 拖拽松开：自动平滑吸附到最近边缘
            snapToEdge(ballParams.x, ballSize)
          }
          true
        }
        else -> false
      }
    }
  }

  private fun snapToEdge(currentX: Int, ballSize: Int) {
    edgeAnimator?.cancel()
    val curWidth = getRealScreenWidth()
    val targetX = if (currentX + ballSize / 2 < curWidth / 2) {
      dpToPx(8f)
    } else {
      curWidth - ballSize - dpToPx(8f)
    }

    edgeAnimator = ValueAnimator.ofInt(currentX, targetX).apply {
      duration = 200
      addUpdateListener { animation ->
        ballParams.x = animation.animatedValue as Int
        try {
          windowManager.updateViewLayout(ballView, ballParams)
        } catch (e: Exception) {}
      }
      start()
    }
  }

  private fun setupCardView(maxHeight: Int) {
    val cardBg = GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = dpToPx(16f).toFloat()
      setColor(Color.parseColor("#F10F172A")) // 深色毛玻璃质感底色
      setStroke(dpToPx(1.5f), Color.parseColor("#334155"))
    }
    cardView.background = cardBg
    cardView.setPadding(dpToPx(16f), dpToPx(16f), dpToPx(16f), dpToPx(16f))

    cardContentLayout.orientation = LinearLayout.VERTICAL
    cardView.addView(cardContentLayout, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.WRAP_CONTENT
    ))
  }

  fun attachTouchWatcher() {
    mainHandler.post {
      try {
        if (!isTouchWatcherAdded && isTargetAppForeground) {
          touchWatcher.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_OUTSIDE) {
              if (isCardVisible) {
                dismissCard()
              }
            }
            false
          }
          windowManager.addView(touchWatcher, touchWatcherParams)
          isTouchWatcherAdded = true
        }
      } catch (e: Exception) {
        Log.e("FloatingOverlayView", "attachTouchWatcher failed", e)
      }
    }
  }

  fun removeTouchWatcher() {
    mainHandler.post {
      try {
        if (isTouchWatcherAdded) {
          windowManager.removeView(touchWatcher)
          isTouchWatcherAdded = false
        }
      } catch (e: Exception) {
        Log.e("FloatingOverlayView", "removeTouchWatcher failed", e)
      }
    }
  }

  fun show() {
    mainHandler.post {
      try {
        if (!isBallAdded) {
          windowManager.addView(ballView, ballParams)
          isBallAdded = true
        }
        ballView.visibility = View.VISIBLE
        ballView.bringToFront()

        if (isTargetAppForeground) {
          attachTouchWatcher()
        } else {
          applyDormantVisualState()
        }
      } catch (e: Exception) {
        Log.e("FloatingOverlayView", "show() failed", e)
      }
    }
  }

  fun hide() {
    val action = Runnable {
      try {
        if (isBallAdded) {
          try {
            windowManager.removeView(ballView)
          } catch (e: Exception) {}
          isBallAdded = false
        }
        clearHudBubbles()
        removeTouchWatcher()
        dismissCard()
        dismissInpaintOverlay()
      } catch (e: Exception) {
        Log.e("FloatingOverlayView", "hide() failed", e)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action.run()
    } else {
      mainHandler.post(action)
    }
  }

  /**
   * 触发特定文本框重新 OCR：
   * 1. 文本框瞬间变完全透明 (alpha -> 0.0f)，使底下的漫画原图露出来方便核对；
   * 2. 仅通知服务对该特定文本框对应的裁剪区域做局部重新 OCR，绝不触发全屏识别！
   * 3. 识别出新文字后，恢复原来的透明度。
   */
  fun triggerSingleBoxReOcr(item: ActiveHudItem) {
    if (item.isReOcring) return
    item.isReOcring = true

    // 记录该气泡当前的基准透明度 (例如 1.0f，或重叠顶层的 0.72f)
    item.baseAlpha = if (item.view.alpha > 0.2f) item.view.alpha else 1.0f

    // 重新 OCR 的时候，文本框变透明
    item.view.animate().cancel()
    item.view.animate()
      .alpha(0.0f)
      .setDuration(100)
      .start()

    setBallState("气泡重识...", isProcessing = true)

    // 仅针对此框对应的坐标区域触发局部 OCR
    onReOcrSingleBoxRequested?.invoke(item)
  }

  /**
   * 单个气泡重新 OCR 结果回调：
   * 更新文字与列排版，重算重叠透明度，恢复原来的透明度！
   */
  fun onSingleBoxOcrResult(item: ActiveHudItem, result: MangaOcrProcessor.SingleRegionOcrResult?) {
    mainHandler.post {
      try {
        if (!activeHudMap.containsValue(item)) {
          return@post
        }

        if (result != null && result.text.isNotBlank()) {
          item.sourceText = result.text
          item.originalLines = result.lines
          item.isVertical = result.isVertical
          item.columnCount = result.columnCount
          item.fontSizePx = result.fontSizePx
          item.langName = result.langName
          item.langColorHex = result.langColor
          item.confidence = result.confidence

          // 创建更新后的内容 View
          val viewData = createSingleHudItemView(
            x = item.x,
            y = item.y,
            width = item.width,
            height = item.height,
            sourceText = item.sourceText,
            targetText = item.targetText,
            langName = item.langName,
            langColorHex = item.langColorHex,
            fontSizePx = item.fontSizePx,
            isVertical = item.isVertical,
            columnCount = item.columnCount,
            originalLines = item.originalLines,
            confidence = item.confidence
          )
          viewData.view.alpha = 0.0f
          viewData.view.isClickable = true
          viewData.view.setOnClickListener {
            triggerSingleBoxReOcr(item)
          }

          item.windowParams.x = viewData.fixedLeft
          item.windowParams.y = viewData.fixedTop
          item.windowParams.width = viewData.targetW
          item.windowParams.height = viewData.targetH

          try {
            windowManager.removeView(item.view)
          } catch (e: Exception) {}
          try {
            windowManager.addView(viewData.view, item.windowParams)
          } catch (e: Exception) {}
          item.view = viewData.view
        }

        // 重新核算重叠气泡透明度（顶层 0.72f，底层 1.0f）
        adjustOverlappingBubblesOpacity()

        // 识别出来恢复原来的透明度
        val targetAlpha = if (item.view.alpha > 0.2f) item.view.alpha else item.baseAlpha
        item.view.animate().cancel()
        item.view.animate()
          .alpha(targetAlpha)
          .setDuration(180)
          .start()

        setBallState("就绪", false)
      } catch (e: Exception) {
        Log.e("FloatingOverlayView", "onSingleBoxOcrResult error", e)
        item.view.animate().alpha(item.baseAlpha).setDuration(150).start()
        setBallState("就绪", false)
      } finally {
        item.isReOcring = false
      }
    }
  }

  fun setBallVisibility(visible: Boolean) {
    mainHandler.post {
      ballView.visibility = if (visible) View.VISIBLE else View.INVISIBLE
    }
  }

  /**
   * 更新悬浮球状态与 Loading 动画
   * 识别/翻译中时：展示旋转加载 Icon (↻ 360° 无限平滑旋转 + 呼吸缩放) + 动态渐变与状态徽章
   *   - 翻译中 (DeepSeek / 在线大模型)：梦幻科技紫蓝渐变 + "翻译中" 紫色微型胶囊
   *   - 识别中 (端侧 OCR / 局部截屏)：橙黄渐变 + "识别中" 红色微型胶囊
   * 处理完成后：停止动画，恢复常态 icon (⚡)，展示最新对白条数
   */
  fun setBallState(statusText: String, isProcessing: Boolean) {
    mainHandler.post {
      if (!isTargetAppForeground) {
        // 切出目标应用时绝不允许触发任何 loading 或旋转动画！强制维持待机静默状态
        loadingRotateAnimator?.cancel()
        loadingPulseAnimator?.cancel()
        ballLoadingView.rotation = 0f
        ballLoadingView.scaleX = 1f
        ballLoadingView.scaleY = 1f
        ballLoadingView.visibility = View.GONE
        ballText.visibility = View.VISIBLE
        ballText.text = "🔒"
        ballStatusBadge.text = "待机"
        return@post
      }
      val bg = ballView.background as? GradientDrawable
      if (isProcessing) {
        // 1. 显示旋转加载 Icon 并启动平滑旋转与呼吸动效
        ballText.visibility = View.GONE
        ballLoadingView.visibility = View.VISIBLE
        if (loadingRotateAnimator?.isRunning != true) {
          loadingRotateAnimator?.start()
        }
        if (loadingPulseAnimator?.isRunning != true) {
          loadingPulseAnimator?.start()
        }

        val isTranslating = statusText.contains("译") ||
          statusText.contains("trans", ignoreCase = true) ||
          statusText.contains("deepseek", ignoreCase = true)

        if (isTranslating) {
          // 翻译中：采用科技感梦幻紫蓝渐变，状态徽章清晰提示“翻译中”
          bg?.colors = intArrayOf(Color.parseColor("#6366F1"), Color.parseColor("#8B5CF6"))
          ballStatusBadge.text = if (statusText.isNotBlank()) statusText else "翻译中"
          (ballStatusBadge.background as? GradientDrawable)?.setColor(Color.parseColor("#8B5CF6"))
        } else {
          // 识别中 / 截屏处理中：采用橙黄渐变
          bg?.colors = intArrayOf(Color.parseColor("#F59E0B"), Color.parseColor("#EA580C"))
          ballStatusBadge.text = if (statusText.isNotBlank()) statusText else "识别中"
          (ballStatusBadge.background as? GradientDrawable)?.setColor(Color.parseColor("#EF4444"))
        }
      } else {
        // 2. 停止旋转与呼吸动效，恢复常态
        loadingRotateAnimator?.cancel()
        loadingPulseAnimator?.cancel()
        ballLoadingView.rotation = 0f
        ballLoadingView.scaleX = 1f
        ballLoadingView.scaleY = 1f
        ballLoadingView.visibility = View.GONE
        ballText.visibility = View.VISIBLE

        ballText.text = if (isRealtimeMode) "⚡" else "译"
        if (isRealtimeMode) {
          bg?.colors = intArrayOf(Color.parseColor("#059669"), Color.parseColor("#0D9488"))
          ballStatusBadge.text = if (currentBubbles.isNotEmpty()) "${currentBubbles.size}条" else "就绪"
          (ballStatusBadge.background as? GradientDrawable)?.setColor(Color.parseColor("#10B981"))
        } else {
          bg?.colors = intArrayOf(Color.parseColor("#4F46E5"), Color.parseColor("#06B6D4"))
          ballStatusBadge.text = "PAUSE"
          (ballStatusBadge.background as? GradientDrawable)?.setColor(Color.parseColor("#64748B"))
        }
      }
    }
  }

  /**
   * 设置指定的目标应用信息
   */
  fun setTargetApp(packageName: String?, appName: String?) {
    targetAppPackage = packageName
    targetAppName = appName
    mainHandler.post {
      if (isCardVisible) {
        showControlCard()
      }
    }
  }

  fun setDestroyBubblesOnAppSwitch(destroy: Boolean) {
    destroyBubblesOnAppSwitch = destroy
    mainHandler.post {
      if (isCardVisible) {
        showControlCard()
      }
    }
  }

  fun setOutsideAppBallBehavior(behavior: String) {
    outsideAppBallBehavior = behavior
    mainHandler.post {
      if (!isTargetAppForeground) {
        applyDormantVisualState()
      }
    }
  }

  fun setTargetAppForegroundState(isForeground: Boolean, force: Boolean = false) {
    if (!force && isTargetAppForeground == isForeground) return
    isTargetAppForeground = isForeground

    mainHandler.post {
      if (!isForeground) {
        // 切出目标应用：变不可点击，不监听任何事件！
        // 1. 彻底移除全屏幕触摸监听器，绝不监听其他应用的点击，绝不触发识别与 loading！
        removeTouchWatcher()

        // 2. 停止任何正在进行的旋转 loading 与呼吸动效
        loadingRotateAnimator?.cancel()
        loadingPulseAnimator?.cancel()
        ballLoadingView.rotation = 0f
        ballLoadingView.scaleX = 1f
        ballLoadingView.scaleY = 1f
        ballLoadingView.visibility = View.GONE
        ballText.visibility = View.VISIBLE

        // 3. 关键：切出目标应用时立即彻底销毁清空屏幕上的全部悬浮文字框！
        if (destroyBubblesOnAppSwitch) {
          clearHudBubbles()
        }

        // 4. 根据设置呈现休眠或隐藏（应用 FLAG_NOT_TOUCHABLE）
        applyDormantVisualState()

        // 5. 收起控制卡片
        dismissCard()
      } else {
        // 切回目标应用：恢复悬浮球可见与交互
        ballView.visibility = View.VISIBLE
        ballView.alpha = 1.0f
        ballView.isClickable = true
        ballView.isFocusable = true

        // 恢复 ballParams 触摸标记（移除 FLAG_NOT_TOUCHABLE）
        if (ballParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE != 0) {
          ballParams.flags = ballParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
          try {
            windowManager.updateViewLayout(ballView, ballParams)
          } catch (e: Exception) {}
        }

        setBallState(if (isRealtimeMode) "就绪" else "暂停", false)

        // 重新挂载全屏触摸监听器
        attachTouchWatcher()
      }
    }
  }

  private fun applyDormantVisualState() {
    // 停止任何正在进行的旋转 loading 与呼吸动效
    loadingRotateAnimator?.cancel()
    loadingPulseAnimator?.cancel()
    ballLoadingView.rotation = 0f
    ballLoadingView.scaleX = 1f
    ballLoadingView.scaleY = 1f
    ballLoadingView.visibility = View.GONE
    ballText.visibility = View.VISIBLE
    ballView.isClickable = false
    ballView.isFocusable = false

    when (outsideAppBallBehavior) {
      "hide" -> {
        // 完全隐藏悬浮球
        ballView.visibility = View.GONE
      }
      "touch_through" -> {
        // 完全穿透不可点击：FLAG_NOT_TOUCHABLE
        ballView.visibility = View.VISIBLE
        ballView.alpha = 0.28f
        ballText.text = "🔒"
        ballStatusBadge.text = "穿透"
        (ballStatusBadge.background as? GradientDrawable)?.setColor(Color.parseColor("#475569"))
        (ballView.background as? GradientDrawable)?.colors = intArrayOf(
          Color.parseColor("#334155"),
          Color.parseColor("#1E293B")
        )
        if (ballParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0) {
          ballParams.flags = ballParams.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
          try {
            windowManager.updateViewLayout(ballView, ballParams)
          } catch (e: Exception) {}
        }
      }
      else -> {
        // dormant (默认): 变不可点击待机，添加 FLAG_NOT_TOUCHABLE，不监听任何事件，点击完全穿透
        ballView.visibility = View.VISIBLE
        ballView.alpha = 0.32f
        ballText.text = "🔒"
        ballStatusBadge.text = "待机"
        (ballStatusBadge.background as? GradientDrawable)?.setColor(Color.parseColor("#475569"))
        (ballView.background as? GradientDrawable)?.colors = intArrayOf(
          Color.parseColor("#334155"),
          Color.parseColor("#1E293B")
        )
        if (ballParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0) {
          ballParams.flags = ballParams.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
          try {
            windowManager.updateViewLayout(ballView, ballParams)
          } catch (e: Exception) {}
        }
      }
    }
  }

  private var accumulatedScrollY: Float = 0f

  /**
   * 实时垂直滚动位移跟踪：
   * 核心机制：当底层第三方漫画应用滚动时，实时将位移 delta 施加在 HUD 悬浮层上，
   * 使得展示文本如影随形、与原画面气泡 100% 紧密同步移动，绝不发生脱离！
   */
  fun applyScrollOffset(dy: Int) {
    if (activeHudMap.isEmpty()) return
    mainHandler.post {
      accumulatedScrollY += dy
      val screenH = getRealScreenHeight()
      for ((_, item) in activeHudMap) {
        item.windowParams.y += dy
        val actualScreenY = item.windowParams.y
        if (actualScreenY + item.height < 0 || actualScreenY > screenH) {
          item.view.visibility = View.INVISIBLE
        } else {
          item.view.visibility = View.VISIBLE
        }
        try {
          windowManager.updateViewLayout(item.view, item.windowParams)
        } catch (e: Exception) {}
      }
    }
  }

  /**
   * 重置实时滚动偏移（当最新静止帧 OCR 识别结果就绪更新时调用）
   */
  fun resetScrollOffset() {
    mainHandler.post {
      accumulatedScrollY = 0f
      for ((_, item) in activeHudMap) {
        item.view.visibility = View.VISIBLE
      }
    }
  }

  /**
   * 移动发生时的通知：
   * 用户需求：移动的时候框消失，底层漫画完全干净可见
   */
  fun onScrollActive() {
    mainHandler.post {
      clearHudBubbles()
      setBallState("移动中", false)
    }
  }

  /**
   * 移动停止时的通知：
   * 用户需求：重新停止移动的时候，再次识别
   */
  fun onScrollSettled() {
    mainHandler.post {
      clearHudBubbles()
      setBallState("识别中", true)
    }
  }

  /**
   * 彻底销毁清空屏幕上原位显示的所有文字悬浮框
   * 当切换离开指定应用或页面重置时自动调用，确保屏幕不残留任何悬浮文字
   */
  fun clearHudBubbles() {
    allRawBubbles = emptyList()
    currentBubbles = emptyList()
    val action = Runnable {
      try {
        resetScrollOffset()
        for ((_, item) in activeHudMap) {
          try {
            windowManager.removeView(item.view)
          } catch (e: Exception) {}
        }
        activeHudMap.clear()
      } catch (e: Exception) {}
      if (isTargetAppForeground) {
        setBallState(if (isRealtimeMode) "就绪" else "暂停", false)
      } else {
        setBallState("待机", false)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action.run()
    } else {
      mainHandler.post(action)
    }
  }

  /**
   * 设置目标识别语言过滤器并重新渲染
   */
  fun setTargetLanguageFilter(lang: String) {
    targetLangFilter = lang.lowercase().trim()
    mainHandler.post {
      currentBubbles = MangaOcrProcessor.filterByTargetLanguage(allRawBubbles, targetLangFilter)
      renderBubblesToHud(currentBubbles)
    }
  }

  /**
   * 设置识别视口模式并刷新控制卡片
   */
  fun setViewportMode(mode: String) {
    viewportMode = mode.lowercase().trim()
    mainHandler.post {
      if (isCardVisible) {
        showControlCard()
      }
    }
  }

  /**
   * 实时更新第三方应用上的全屏原位坐标悬浮层 (Touch-Through HUD Overlay)
   * 核心生命周期机制：
   * 1. 出界销毁：滚出顶部或底部的旧文本框彻底注销移除，严禁边缘残留；
   * 2. 新进创建：滑入屏幕的新文本即时识别并在当前坐标创建 Fixed 文本框；
   * 3. 留屏对齐：停留在屏幕中的文字平滑更新至最新 (x, y) 坐标，完美钉在原文字位置！
   */
  fun updateRealtimeBubbles(bubbles: List<Map<String, Any>>) {
    allRawBubbles = bubbles
    currentBubbles = MangaOcrProcessor.filterByTargetLanguage(bubbles, targetLangFilter)
    mainHandler.post {
      renderBubblesToHud(currentBubbles)
    }
  }

  private fun renderBubblesToHud(bubbles: List<Map<String, Any>>) {
    try {
      if (!isHudAdded && isHudVisible) {
        windowManager.addView(hudOverlayView, hudParams)
        isHudAdded = true
      }
      hudOverlayView.alpha = 1.0f

      if (!isHudVisible || bubbles.isEmpty()) {
        for ((_, item) in activeHudMap) {
          try {
            windowManager.removeView(item.view)
          } catch (e: Exception) {}
        }
        activeHudMap.clear()
        setBallState("就绪", false)
        return
      }

      val screenW = getRealScreenWidth()
      val screenH = getRealScreenHeight()
      val marginH = dpToPx(4f)
      val marginV = dpToPx(6f)

      // 1. 边缘残缺截断过滤 (Edge-Clipping Omission Filter)
      // 用户需求：扫描整个屏幕，但对边缘文字省略 (因为有一部分在屏幕外，无法识别整个上下文)
      val validBubbles = bubbles.filter { item ->
        val boxMap = item["box"] as? Map<*, *> ?: return@filter false
        val y = (boxMap["y"] as? Number)?.toInt() ?: 0
        val h = (boxMap["height"] as? Number)?.toInt() ?: 0
        val x = (boxMap["x"] as? Number)?.toInt() ?: 0
        val w = (boxMap["width"] as? Number)?.toInt() ?: 0
        val sourceText = item["sourceText"] as? String ?: ""
        val targetText = item["targetText"] as? String ?: ""

        // 判定文字块是否紧贴或跨越屏幕物理极边缘 (用户要求：上下边缘残缺文字被切断不好翻译，彻底过滤)
        val isClippedByEdge = (y <= 10) || (y + h >= screenH - 12)
        if (isClippedByEdge) {
          return@filter false
        }

        val isWithinScreen = (y + h > 0) && (y < screenH) && (x + w > 0) && (x < screenW)
        if (!isWithinScreen) {
          return@filter false
        }
        // 在 box 检测框调试模式下，始终展示模型检出的检测框；文本模式下需要有内容
        if (hudDisplayMode != "box" && sourceText.isBlank() && targetText.isBlank()) {
          return@filter false
        }

        // 过滤纯横线/长音符/波浪线噪点 (解决"一次性返回十几个----"，已翻译内容除外)
        val pureLineChars = setOf('-', '—', '―', 'ー', '─', '━', '_', '=', '~', '〜')
        val cleanSrc = sourceText.replace(Regex("[\\s\\r\\n]+"), "")
        if (targetText.isBlank() && cleanSrc.isNotEmpty() && cleanSrc.all { it in pureLineChars }) {
          return@filter false
        }

        true
      }

      if (validBubbles.isEmpty()) {
        for ((_, item) in activeHudMap) {
          try {
            windowManager.removeView(item.view)
          } catch (e: Exception) {}
        }
        activeHudMap.clear()
        setBallState("就绪", false)
        return
      }

      // 2. 重置实时滚动偏移（最新帧 OCR 结果就绪，基准恢复）
      resetScrollOffset()

      // 3. 智能 Diff 与动态生命周期处理（100% 紧贴原始气泡坐标，绝不平移偏移！）
      val newKeys = HashSet<String>()

      for ((index, item) in validBubbles.withIndex()) {
        val boxMap = item["box"] as? Map<*, *>
        val x = (boxMap?.get("x") as? Number)?.toInt() ?: 0
        val y = (boxMap?.get("y") as? Number)?.toInt() ?: 0
        val w = (boxMap?.get("width") as? Number)?.toInt() ?: 100
        val h = (boxMap?.get("height") as? Number)?.toInt() ?: 50

        val sourceText = item["sourceText"] as? String ?: ""
        val targetText = item["targetText"] as? String ?: ""
        val langName = item["langName"] as? String ?: "文本"
        val langColorHex = item["langColor"] as? String ?: "#0EA5E9"
        val fontSizePx = (item["fontSize"] as? Number)?.toFloat() ?: 0f
        val direction = item["direction"] as? String ?: ""
        val isVertical = (direction == "vertical") || (h > w * 1.15f && direction != "horizontal")
        val linesFromItem = (item["lines"] as? List<*>)?.mapNotNull { it as? String }
        val detectedColumnCount = (item["columnCount"] as? Number)?.toInt() ?: linesFromItem?.size ?: 0

        val itemId = item["id"] as? String ?: ""
        // 查找是否已有相同 ID、物理坐标紧密重合、或相同文本且纵向距离相近的已存在气泡
        val normalizedText = if (sourceText.length > 12) sourceText.substring(0, 12) else sourceText
        val existingEntry = activeHudMap.entries.firstOrNull { entry ->
          val ex = entry.value
          if (newKeys.contains(entry.key)) return@firstOrNull false
          // 1. 优先通过业务/模型唯一 ID 匹配
          if (itemId.isNotBlank() && (ex.originalId == itemId || entry.key == itemId)) return@firstOrNull true
          // 2. 次选物理空间坐标重合 (水平与垂直距离均在 25dp 以内，确定为同一个气泡框)
          val isSameLocation = kotlin.math.abs(ex.x - x) < dpToPx(25f) && kotlin.math.abs(ex.y - y) < dpToPx(25f)
          if (isSameLocation) return@firstOrNull true
          // 3. 兜底原文与相对纵向距离匹配 (保证滚动时平滑过渡)
          ex.sourceText == sourceText && kotlin.math.abs(ex.y - y) < screenH * 0.35f
        }
        val blockKey = existingEntry?.key ?: (if (itemId.isNotBlank()) itemId else "b_${normalizedText.hashCode()}_${index}_${System.currentTimeMillis() % 100000}")
        newKeys.add(blockKey)

        val textType = item["textType"] as? String ?: "bubble"
        val isFromModel = (item["detectorSource"] == "comic_model") || (item["id"] as? String)?.startsWith("comic_det_") == true
        val confidence = (item["confidence"] as? Number)?.toFloat() ?: 0.90f
        val existing = existingEntry?.value
        if (existing != null) {
          // A. 仍在屏幕中的元素：平滑更新坐标至最新 Fixed 位置 (根据实际气泡框边界对齐，杜绝重叠邻近气泡)
          val modeOrTextChanged = (existing.currentHudMode != hudDisplayMode) ||
            (existing.targetText != targetText && targetText.isNotBlank()) ||
            (existing.sourceText != sourceText)

          if (itemId.isNotBlank()) existing.originalId = itemId
          existing.x = x
          existing.y = y
          existing.width = w
          existing.height = h
          if (fontSizePx > 0f) existing.fontSizePx = fontSizePx
          existing.sourceText = sourceText
          if (targetText.isNotBlank()) existing.targetText = targetText
          if (langName.isNotBlank() && langName != "文本") existing.langName = langName
          if (langColorHex.isNotBlank() && langColorHex != "#0EA5E9") existing.langColorHex = langColorHex
          if (direction.isNotBlank()) {
            existing.isVertical = (direction == "vertical")
          } else if (item["direction"] == null && isVertical != existing.isVertical) {
            existing.isVertical = isVertical
          }
          if (detectedColumnCount > 0) existing.columnCount = detectedColumnCount
          if (!linesFromItem.isNullOrEmpty()) existing.originalLines = linesFromItem
          existing.currentHudMode = hudDisplayMode
          if (confidence > 0f) existing.confidence = confidence

          val effectiveFontSizePx = if (fontSizePx > 0f) fontSizePx else existing.fontSizePx
          val effectiveColumnCount = if (detectedColumnCount > 0) detectedColumnCount else existing.columnCount
          val effectiveLines = if (!linesFromItem.isNullOrEmpty()) linesFromItem else existing.originalLines
          val effectiveIsVertical = existing.isVertical

          if (modeOrTextChanged && hudDisplayMode != "box") {
            // 文本/译文发生变化或模式切换时，按最新文字重新计算 Fit-To-Box
            val updatedViewData = createSingleHudItemView(
              x = x,
              y = y,
              width = w,
              height = h,
              sourceText = sourceText,
              targetText = targetText,
              langName = existing.langName,
              langColorHex = existing.langColorHex,
              fontSizePx = effectiveFontSizePx,
              isVertical = effectiveIsVertical,
              columnCount = effectiveColumnCount,
              originalLines = effectiveLines,
              textType = textType,
              isFromModel = isFromModel,
              confidence = existing.confidence
            )
            try {
              windowManager.removeView(existing.view)
            } catch (e: Exception) {}
            existing.view = updatedViewData.view
            existing.windowParams.x = updatedViewData.fixedLeft
            existing.windowParams.y = updatedViewData.fixedTop
            existing.windowParams.width = updatedViewData.targetW
            existing.windowParams.height = updatedViewData.targetH
            try {
              windowManager.addView(existing.view, existing.windowParams)
            } catch (e: Exception) {}
          } else if (hudDisplayMode == "box") {
            existing.windowParams.x = max(0, x)
            existing.windowParams.y = max(0, y)
            existing.windowParams.width = max(dpToPx(36f), w)
            existing.windowParams.height = max(dpToPx(24f), h)

            val baseLabel = when (textType) {
              "art_text" -> "艺术字"
              "sfx" -> "拟声词"
              "bubble" -> "气泡"
              else -> langName
            }
            val typeLabel = if (isFromModel) "⚡模型·$baseLabel" else "常规·$baseLabel"
            val borderColor = when {
              textType == "art_text" -> Color.parseColor("#F59E0B")
              textType == "sfx" -> Color.parseColor("#10B981")
              isFromModel -> Color.parseColor("#A855F7")
              textType == "bubble" -> Color.parseColor("#00E5FF")
              else -> try { Color.parseColor(langColorHex) } catch (e: Exception) { Color.parseColor("#0EA5E9") }
            }
            val container = existing.view as? ViewGroup
            val badgeView = container?.getChildAt(0) as? TextView
            val confPct = (confidence * 100).toInt()
            badgeView?.text = "${w}×${h} $typeLabel ${confPct}%"
            (badgeView?.background as? GradientDrawable)?.setStroke(dpToPx(1f), borderColor)
            (container?.background as? GradientDrawable)?.setStroke(dpToPx(2.5f), borderColor)
            try {
              windowManager.updateViewLayout(existing.view, existing.windowParams)
            } catch (e: Exception) {}
          } else {
            // 文本/译文模式：严格限定在气泡物理包围盒内，绝不向外大幅度膨胀，杜绝跨框重叠
            val targetW = min(screenW - marginH * 2, max(dpToPx(24f), w + dpToPx(3f)))
            val targetH = max(existing.windowParams.height, min(screenH - marginV * 2, max(dpToPx(18f), h + dpToPx(3f))))
            val fixedLeft = (x - dpToPx(1.5f)).coerceIn(marginH, max(marginH, screenW - targetW - marginH))
            val fixedTop = (y - dpToPx(1.5f)).coerceIn(marginV, max(marginV, screenH - targetH - marginV))

            existing.windowParams.x = fixedLeft
            existing.windowParams.y = fixedTop
            existing.windowParams.width = targetW
            existing.windowParams.height = targetH
            try {
              windowManager.updateViewLayout(existing.view, existing.windowParams)
            } catch (e: Exception) {}
          }
        } else {
          // B. 新进入屏幕的内容：即时创建独立 WindowManager 悬浮窗 (支持原生直接点击局部重识，外部完全穿透)
          val viewData = createSingleHudItemView(
            x = x,
            y = y,
            width = w,
            height = h,
            sourceText = sourceText,
            targetText = targetText,
            langName = langName,
            langColorHex = langColorHex,
            fontSizePx = fontSizePx,
            isVertical = isVertical,
            columnCount = detectedColumnCount,
            originalLines = linesFromItem,
            textType = textType,
            isFromModel = isFromModel,
            confidence = confidence
          )
          val bubbleLp = if (hudDisplayMode == "box") {
            createBubbleLayoutParams(max(dpToPx(36f), w), max(0, x), max(0, y), max(dpToPx(24f), h))
          } else {
            createBubbleLayoutParams(viewData.targetW, viewData.fixedLeft, viewData.fixedTop, viewData.targetH)
          }
          val activeItem = ActiveHudItem(
            id = blockKey,
            view = viewData.view,
            windowParams = bubbleLp,
            sourceText = sourceText,
            targetText = targetText,
            langName = langName,
            langColorHex = langColorHex,
            isVertical = isVertical,
            columnCount = detectedColumnCount,
            originalLines = linesFromItem,
            x = x,
            y = y,
            width = w,
            height = h,
            fontSizePx = fontSizePx,
            currentHudMode = hudDisplayMode,
            confidence = confidence,
            originalId = itemId
          )
          viewData.view.isClickable = true
          viewData.view.setOnClickListener {
            // 点击某个特定文本框，仅对该文本框内容重新 OCR，绝不触发全屏识别！
            triggerSingleBoxReOcr(activeItem)
          }
          try {
            windowManager.addView(viewData.view, bubbleLp)
          } catch (e: Exception) {}
          activeHudMap[blockKey] = activeItem
        }
      }

      // C. 移出屏幕的旧内容：彻底注销并销毁！
      val iterator = activeHudMap.entries.iterator()
      while (iterator.hasNext()) {
        val entry = iterator.next()
        if (!newKeys.contains(entry.key)) {
          try {
            windowManager.removeView(entry.value.view)
          } catch (e: Exception) {}
          iterator.remove()
        }
      }

      // 4. 重叠检测与上层透明度自适应调节
      adjustOverlappingBubblesOpacity()

      setBallState("更新完成", false)
    } catch (e: Exception) {
      Log.e("FloatingOverlayView", "renderBubblesToHud failed", e)
    }
  }

  /**
   * 重叠气泡自适应透明度调节：
   * 严格按照活跃气泡层级排序：
   * - 压在下面的气泡 (bottomItem) 坚决保持 1.0f 纯正清晰不透明度，绝不调低；
   * - 覆盖在上面的气泡 (topItem) 调低透明度为 0.72f，微透出下层文字且字体清晰可辨（绝不调得太低）；
   * - 坚决不平移不挪动坐标，确保文字永远 100% 紧密贴合漫画原作气泡！
   */
  private fun adjustOverlappingBubblesOpacity() {
    val sortedItems = activeHudMap.values.toList()

    // 先将所有非正在重识的气泡重置为标准不透明度 1.0f
    for (item in sortedItems) {
      if (!item.isReOcring) {
        item.view.alpha = 1.0f
        item.baseAlpha = 1.0f
      }
    }

    // 检查所有两两相交的气泡
    for (i in 0 until sortedItems.size) {
      val bottomItem = sortedItems[i] // 压在底层（先添加）的项
      val leftBottom = bottomItem.windowParams.x
      val topBottom = bottomItem.windowParams.y
      val widthBottom = if (bottomItem.windowParams.width > 0) bottomItem.windowParams.width else max(bottomItem.width, dpToPx(30f))
      val heightBottom = bottomItem.windowParams.height.takeIf { it > 0 } ?: bottomItem.view.height.takeIf { it > 0 } ?: max(bottomItem.height, dpToPx(20f))
      val rectBottom = android.graphics.Rect(leftBottom, topBottom, leftBottom + widthBottom, topBottom + heightBottom)

      for (j in i + 1 until sortedItems.size) {
        val topItem = sortedItems[j] // 覆盖在顶层（后添加）的项
        val leftTop = topItem.windowParams.x
        val topTop = topItem.windowParams.y
        val widthTop = if (topItem.windowParams.width > 0) topItem.windowParams.width else max(topItem.width, dpToPx(30f))
        val heightTop = topItem.windowParams.height.takeIf { it > 0 } ?: topItem.view.height.takeIf { it > 0 } ?: max(topItem.height, dpToPx(20f))
        val rectTop = android.graphics.Rect(leftTop, topTop, leftTop + widthTop, topTop + heightTop)

        if (android.graphics.Rect.intersects(rectBottom, rectTop)) {
          // 仅调低覆盖在【上面】那个展示文本的透明度 (0.72f，字体清晰可读绝不泛白)
          // 压在【下面】的 bottomItem 保持 1.0f 完全清晰！
          if (!topItem.isReOcring) {
            topItem.view.alpha = 0.72f
          }
          topItem.baseAlpha = 0.72f
        }
      }
    }
  }

  /**
   * 像素级精确计算 Fixed 在原文本位置上的边界与对齐参数
   */
  private fun computeFixedBounds(
    x: Int,
    y: Int,
    width: Int,
    height: Int,
    screenW: Int,
    screenH: Int,
    marginH: Int,
    marginV: Int,
    dynamicFontSizeSp: Float = 10.5f,
    isVertical: Boolean = false,
    columnCount: Int = 1
  ): Triple<Int, Int, Int> {
    val fixedLeft: Int
    val targetW: Int
    val density = context.resources.displayMetrics.density

    if (!isVertical && width >= dpToPx(55f)) {
      // 横排或中大宽度文本：左侧直接对齐原文字起点，宽度紧密包裹原文字
      fixedLeft = x.coerceIn(marginH, max(marginH, screenW - dpToPx(45f)))
      val availW = screenW - fixedLeft - marginH
      targetW = max(width + dpToPx(3f), dpToPx(45f)).coerceAtMost(availW)
    } else {
      // 竖排或较窄文本：以原文字水平轴心为准居中展开，单列/多列竖排紧凑包裹
      val centerX = x + width / 2
      val comfortableW = if (isVertical) {
        val calculatedColW = (columnCount * (dynamicFontSizeSp * density + dpToPx(8f)) + dpToPx(16f)).toInt()
        max(width + dpToPx(8f), calculatedColW).coerceAtMost(screenW - marginH * 2)
      } else {
        max(dpToPx(75f), (dynamicFontSizeSp * density * 3.2f).toInt()).coerceAtMost(screenW - marginH * 2)
      }
      targetW = comfortableW
      fixedLeft = (centerX - comfortableW / 2).coerceIn(marginH, max(marginH, screenW - comfortableW - marginH))
    }

    val fixedTop = y.coerceIn(marginV, max(marginV, screenH - dpToPx(20f)))
    return Triple(fixedLeft, fixedTop, targetW)
  }

  data class VerticalLayoutResult(
    val columns: List<String>,
    val fontSizeSp: Float,
    val fittedWidth: Int,
    val fittedHeight: Int
  )

  /**
   * 智能多列竖排布局求解器：
   * 1. 优先 100% 遵循译文显式换行符 (\n)
   * 2. 若无显式换行，基于气泡物理几何尺寸 (width, height) 智能评估 k (1~6 列)
   * 3. 严格控制字号在黄金可读区间 (10.0sp ~ 13.5sp)，下限绝不低于 8.5sp，杜绝字体过大爆框或过小看不清
   * 4. 紧凑包裹原漫画气泡，绝不将多字文本盲目压缩为 1 单列，绝不纵向无限拉长
   */
  private fun calculateOptimalVerticalLayout(
    text: String,
    bubbleW: Int,
    bubbleH: Int,
    density: Float,
    originalLines: List<String>? = null,
    hintColumnCount: Int = 0,
    textType: String = "bubble"
  ): VerticalLayoutResult {
    val clean = text.trim()
    if (clean.isEmpty()) {
      return VerticalLayoutResult(emptyList(), 11.5f, bubbleW, bubbleH)
    }

    val padH = dpToPx(3.0f)
    val padV = dpToPx(3.0f)
    val availW = max(dpToPx(20f), bubbleW - padH * 2)
    val availH = max(dpToPx(20f), bubbleH - padV * 2)

    val minFontSp = 8.5f
    val maxFontSp = when (textType) {
      "bubble" -> 13.5f
      "title", "sfx", "art_text" -> 18.0f
      else -> 14.0f
    }
    val idealFontSp = 11.5f

    // 1. 若文本自带显式换行符 (\n)，优先遵循原有分行排版
    if (clean.contains("\n")) {
      val explicitLines = clean.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
      if (explicitLines.size >= 2) {
        val maxChars = explicitLines.maxOf { it.length }.coerceAtLeast(1)
        val k = explicitLines.size
        val colMargin = if (k >= 4) dpToPx(0.8f) else dpToPx(1.2f)
        val spFromH = availH.toFloat() / (maxChars * 1.16f * density)
        val spFromW = (availW.toFloat() - (k - 1) * colMargin * 2) / (k * 1.15f * density)
        val fittedSp = min(maxFontSp, min(spFromH, spFromW)).coerceAtLeast(minFontSp)
        val fittedW = (k * (fittedSp * density * 1.15f) + (k - 1) * colMargin * 2 + padH * 2).toInt()
        val fittedH = (maxChars * (fittedSp * density * 1.16f) + padV * 2).toInt()
        return VerticalLayoutResult(explicitLines, fittedSp, fittedW, fittedH)
      }
    }

    val origCols = when {
      !originalLines.isNullOrEmpty() -> originalLines.size
      hintColumnCount > 0 -> hintColumnCount
      else -> 0
    }

    val totalChars = clean.length
    // 极短文本 (1~3 字) 且气泡为纵向时，自然单列
    if (totalChars <= 3 && bubbleH >= bubbleW) {
      val spFromH = availH.toFloat() / (totalChars * 1.16f * density)
      val spFromW = availW.toFloat() / (1.15f * density)
      val fittedSp = min(maxFontSp, min(spFromH, spFromW)).coerceAtLeast(minFontSp)
      val fittedW = (fittedSp * density * 1.15f + padH * 2).toInt()
      val fittedH = (totalChars * (fittedSp * density * 1.16f) + padV * 2).toInt()
      return VerticalLayoutResult(listOf(clean), fittedSp, fittedW, fittedH)
    }

    // 2. 多列候选评估 (1 ~ 6 列)
    val maxPossibleCols = 6
    val candidateCols = (1..maxPossibleCols).filter { k ->
      val colMargin = if (k >= 4) dpToPx(0.8f) else dpToPx(1.2f)
      val wPerCol = (availW.toFloat() - (k - 1) * colMargin * 2) / k
      (wPerCol / density) >= 7.5f // 宽度方向至少能容纳 ~7.5sp
    }.ifEmpty { listOf(1) }

    var bestK = 1
    var bestSp = idealFontSp
    var bestScore = -Float.MAX_VALUE

    for (k in candidateCols) {
      val charsPerCol = Math.ceil(totalChars.toDouble() / k.toDouble()).toInt().coerceAtLeast(1)
      val colMargin = if (k >= 4) dpToPx(0.8f) else dpToPx(1.2f)
      val spFromH = availH.toFloat() / (charsPerCol * 1.16f * density)
      val spFromW = (availW.toFloat() - (k - 1) * colMargin * 2) / (k * 1.15f * density)
      val achievableSp = min(spFromH, spFromW)

      var score = 0f
      if (achievableSp < minFontSp) {
        score -= (minFontSp - achievableSp) * 50f // 严厉惩罚字体过小看不清
      } else if (achievableSp > maxFontSp) {
        score -= (achievableSp - maxFontSp) * 10f // 惩罚字体过大爆框
      } else {
        score += 30f - abs(achievableSp - idealFontSp) * 5f // 鼓励贴近 11.5sp 黄金阅读字号
      }

      // 气泡几何长宽比适应度
      val bubbleRatio = availH.toFloat() / availW.toFloat()
      val textRatio = (charsPerCol * 1.16f) / (k * 1.15f)
      val ratioDiff = abs(ln(bubbleRatio / textRatio))
      score -= ratioDiff * 15f

      // 原作检测列数加成
      if (origCols in 1..maxPossibleCols && k == origCols) {
        score += 25f
      }

      if (score > bestScore) {
        bestScore = score
        bestK = k
        bestSp = achievableSp.coerceIn(minFontSp, maxFontSp)
      }
    }

    // 3. 按照最优列数进行语意/标点平滑切分
    val columns = partitionIntoKColumns(clean, bestK)
    val maxChars = columns.maxOfOrNull { it.length }?.coerceAtLeast(1) ?: totalChars
    val colMargin = if (bestK >= 4) dpToPx(0.8f) else dpToPx(1.2f)
    val fittedW = (bestK * (bestSp * density * 1.15f) + (bestK - 1) * colMargin * 2 + padH * 2).toInt()
    val fittedH = (maxChars * (bestSp * density * 1.16f) + padV * 2).toInt()

    return VerticalLayoutResult(columns, bestSp, fittedW, fittedH)
  }

  /**
   * 将文本平滑切分为 K 列，优先在标点符号 (，、。！？…—― 空格) 处自然断列
   */
  private fun partitionIntoKColumns(text: String, k: Int): List<String> {
    if (k <= 1 || text.length <= 1) return listOf(text)

    val puncs = "，、。！？…—― "
    val cols = mutableListOf<String>()
    var remaining = text

    for (colIdx in 0 until k - 1) {
      val idealEnd = Math.round(remaining.length.toDouble() / (k - colIdx).toDouble()).toInt()
      var bestCut = idealEnd
      var minDist = Int.MAX_VALUE
      val searchMin = max(1, idealEnd - 2)
      val searchMax = min(remaining.length - 1, idealEnd + 2)
      for (i in searchMin..searchMax) {
        if (puncs.contains(remaining[i - 1])) {
          val dist = abs(i - idealEnd)
          if (dist < minDist) {
            minDist = dist
            bestCut = i
          }
        }
      }
      val seg = remaining.substring(0, bestCut).trim()
      if (seg.isNotEmpty()) {
        cols.add(seg)
      }
      remaining = remaining.substring(bestCut).trim()
    }
    if (remaining.isNotEmpty()) {
      cols.add(remaining)
    }
    return cols
  }

  /**
   * 规范化标点、超长横线与省略号：
   * 1. 彻底压缩过长的破折号/长横线/长音符/波浪线 (如 ------、――――――、ーーーーー 压缩为最多 2 个)；
   * 2. 竖排：将所有连续点号（包括带有空格的 . . .）、连续句号、中点、多重省略号等统一压缩为单一垂直省略号 '⋮'；
   * 3. 横排：将连续点号规范化压缩为标准简洁的 '…'。
   */
  private fun normalizeExcessiveSymbols(text: String, isVertical: Boolean): String {
    if (text.isBlank()) return text
    var result = text

    // 压缩连续 3 个及以上的横线破折号（包括半角减号、全角破折号、日文全角横线、长音符）为最多 2 个
    result = result.replace(Regex("[-—―─━ー]{3,}"), if (isVertical) "丨丨" else "――")
    result = result.replace(Regex("[~〜]{3,}"), "~~")
    result = result.replace(Regex("={3,}"), "==")
    result = result.replace(Regex("_{3,}"), "__")
    result = result.replace(Regex("[!！]{3,}"), "！！")
    result = result.replace(Regex("[?？]{3,}"), "？？")

    return if (isVertical) {
      result.replace(Regex("\\s*(?:\\.(?:\\s*\\.){1,}|…+|[·・](?:\\s*[·・]){1,}|[。]{2,}|[⋮︙]+)"), "⋮")
        .replace(Regex("\\s*…"), "⋮")
    } else {
      result.replace(Regex("\\s*(?:\\.(?:\\s*\\.){1,}|…{2,}|[·・](?:\\s*[·・]){1,}|[。]{2,})"), "…")
    }
  }

  /**
   * 纵向标点符号规范化旋转映射 (长音符、省略号、括号等)
   */
  private fun formatVerticalChar(ch: Char): Char {
    return when (ch) {
      'ー', '―', '—' -> '丨'
      '…' -> '⋮'
      '（', '(' -> '︵'
      '）', ')' -> '︶'
      '「' -> '﹁'
      '」' -> '﹂'
      '『' -> '﹃'
      '』' -> '﹄'
      '【', '[' -> '︻'
      '】', ']' -> '︼'
      '《' -> '︽'
      '》' -> '︾'
      else -> ch
    }
  }

  /**
   * 创建挂载在原位文字坐标上的轻量半透明 HUD 视图
   * 核心特色：根据 OCR 实际识别到的字符物理像素大小 (fontSizePx) 动态自适应字体大小 (8.5sp ~ 24.0sp)；
   * 严格高度保护约束 + 空格自然断列换列 + 日漫 RTL 从右向左阅读流！
   */
  private fun createSingleHudItemView(
    x: Int,
    y: Int,
    width: Int,
    height: Int,
    sourceText: String,
    targetText: String,
    langName: String,
    langColorHex: String,
    fontSizePx: Float,
    isVertical: Boolean = false,
    columnCount: Int = 0,
    originalLines: List<String>? = null,
    textType: String = "bubble",
    isFromModel: Boolean = false,
    confidence: Float = 0.90f
  ): SingleHudViewData {
    val themeColor = try { Color.parseColor(langColorHex) } catch (e: Exception) { Color.parseColor("#0EA5E9") }

    val isBoxMode = (hudDisplayMode == "box")
    val defaultBorderColor = when {
      textType == "art_text" -> Color.parseColor("#F59E0B") // 琥珀金 (艺术字/标题字)
      textType == "sfx" -> Color.parseColor("#10B981")      // 翡翠绿 (拟声词/音效)
      isFromModel -> Color.parseColor("#A855F7")            // 霓虹紫 (模型检出气泡)
      textType == "bubble" -> Color.parseColor("#00E5FF")   // 电光青 (常规气泡)
      else -> themeColor
    }

    if (isBoxMode) {
      // 路径 A 纯矩形检测框调试模式：不展示 OCR 文字，只高亮标出矩形大小和类型
      val container = FrameLayout(context).apply {
        clipChildren = false
        clipToPadding = false

        val bg = GradientDrawable().apply {
          shape = GradientDrawable.RECTANGLE
          cornerRadius = dpToPx(3f).toFloat()
          setColor(Color.parseColor("#1200E5FF")) // ~7% 超透微光底色，漫画原图清晰可见
          setStroke(dpToPx(2.5f), defaultBorderColor) // 2.5dp 醒目荧光矩形边框
        }
        background = bg
        minimumWidth = max(dpToPx(36f), width)
        minimumHeight = max(dpToPx(24f), height)
        setPadding(dpToPx(3f), dpToPx(3f), dpToPx(3f), dpToPx(3f))
      }

      val badge = TextView(context).apply {
        val baseLabel = when (textType) {
          "art_text" -> "艺术字"
          "sfx" -> "拟声词"
          "bubble" -> "气泡"
          else -> langName
        }
        val typeLabel = if (isFromModel) "⚡模型·$baseLabel" else "常规·$baseLabel"
        val confPct = (confidence * 100).toInt()
        text = "${width}×${height} $typeLabel ${confPct}%"
        setTextColor(Color.WHITE)
        textSize = 9.5f
        typeface = Typeface.DEFAULT_BOLD
        val badgeBg = GradientDrawable().apply {
          shape = GradientDrawable.RECTANGLE
          cornerRadius = dpToPx(2f).toFloat()
          setColor(Color.argb(220, 15, 23, 42))
          setStroke(dpToPx(1f), defaultBorderColor)
        }
        background = badgeBg
        setPadding(dpToPx(4f), dpToPx(1f), dpToPx(4f), dpToPx(1f))
        layoutParams = FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
          gravity = Gravity.TOP or Gravity.START
        }
      }
      container.addView(badge)

      return SingleHudViewData(
        view = container,
        targetW = max(dpToPx(36f), width),
        fixedLeft = x,
        fixedTop = y,
        targetH = max(dpToPx(24f), height)
      )
    }

    val screenW = getRealScreenWidth()
    val screenH = getRealScreenHeight()
    val marginH = dpToPx(4f)
    val marginV = dpToPx(4f)
    val density = context.resources.displayMetrics.density

    // 核心定位算法：以原文字物理几何中心为基准居中定位展开，1:1 复刻原作漫画排版与列数
    val centerX = x + width / 2
    val centerY = y + height / 2
    val padH = dpToPx(3.0f)
    val padV = dpToPx(3.0f)

    // 文本显示区域 (无语言标签，字号根据 OCR 原文大小自适应)
    val rawText = when (hudDisplayMode) {
      "target" -> if (targetText.isNotBlank()) targetText else sourceText
      "both" -> if (targetText.isNotBlank()) "$sourceText\n➜ $targetText" else sourceText
      else -> sourceText // 默认显示 OCR 识别到的真实文本与位置
    }

    // 关键优化：规范化符号与省略号 (压缩超长破折号/长横线，压缩连续省略号，杜绝文本框被拉长)
    val processedText = normalizeExcessiveSymbols(rawText, isVertical)

    // 智能竖排断列与换列处理：
    val isMultiColVertical = isVertical && hudDisplayMode != "both"
    val minFontSizeSp = 8.5f
    val maxFontSizeSp = when (textType) {
      "bubble" -> 13.5f
      "title", "sfx", "art_text" -> 18.0f
      else -> 14.0f
    }

    val verticalResult: VerticalLayoutResult? = if (isMultiColVertical) {
      if (hudDisplayMode != "target" && !originalLines.isNullOrEmpty()) {
        // 原文模式：直接使用 OCR 物理识别出的列集合，漫画有几列就展示几列
        val origColumns = originalLines.map { normalizeExcessiveSymbols(it, true) }
        val maxChars = origColumns.maxOfOrNull { it.length }?.coerceAtLeast(1) ?: 1
        val k = origColumns.size
        val colMargin = if (k >= 4) dpToPx(0.8f) else dpToPx(1.2f)
        val spFromH = (height - padV * 2).toFloat() / (maxChars * 1.16f * density)
        val spFromW = ((width - padH * 2).toFloat() - (k - 1) * colMargin * 2) / (k * 1.15f * density)
        val fittedSp = min(maxFontSizeSp, min(spFromH, spFromW)).coerceAtLeast(minFontSizeSp)
        val fittedW = (k * (fittedSp * density * 1.15f) + (k - 1) * colMargin * 2 + padH * 2).toInt()
        val fittedH = (maxChars * (fittedSp * density * 1.16f) + padV * 2).toInt()
        VerticalLayoutResult(origColumns, fittedSp, fittedW, fittedH)
      } else {
        // 译文模式：基于气泡实际几何尺寸进行智能最优多列竖排布局求解 (严控字号在 10.0sp~13.5sp)
        calculateOptimalVerticalLayout(
          text = processedText,
          bubbleW = width,
          bubbleH = height,
          density = density,
          originalLines = originalLines,
          hintColumnCount = columnCount,
          textType = textType
        )
      }
    } else {
      null
    }

    val segments: List<String> = verticalResult?.columns ?: emptyList()
    var dynamicFontSizeSp: Float = verticalResult?.fontSizeSp ?: 11.5f

    var targetW: Int
    var targetH: Int
    var fixedLeft: Int
    var fixedTop: Int
    var availW: Int
    var availH: Int

    if (isMultiColVertical && verticalResult != null) {
      targetW = max(width + dpToPx(4f), verticalResult.fittedWidth).coerceIn(dpToPx(24f), screenW - marginH * 2)
      targetH = max(height + dpToPx(4f), verticalResult.fittedHeight).coerceIn(dpToPx(20f), screenH - marginV * 2)

      fixedLeft = (centerX - targetW / 2).coerceIn(marginH, screenW - targetW - marginH)
      fixedTop = (centerY - targetH / 2).coerceIn(marginV, screenH - targetH - marginV)

      availW = max(dpToPx(16f), targetW - padH * 2)
      availH = max(dpToPx(14f), targetH - padV * 2)
    } else {
      // 横排排版：以可用宽度折行，确保字号清晰可读 (>= 8.5sp, <= 13.5sp for dialogue)
      val approxW = max(width + dpToPx(8f), dpToPx(40f)).coerceAtMost(screenW - marginH * 2)
      val availHorizontalW = max(dpToPx(24f), approxW - padH * 2)

      val textPaint = TextPaint().apply {
        typeface = Typeface.DEFAULT_BOLD
        isAntiAlias = true
      }

      val initialSp = if (fontSizePx > 6f) {
        (fontSizePx / density).coerceIn(minFontSizeSp, maxFontSizeSp)
      } else {
        (height.toFloat() * 0.75f / density).coerceIn(minFontSizeSp, maxFontSizeSp)
      }

      var bestFontSizeSp = initialSp
      var chosenLayout: StaticLayout? = null
      while (bestFontSizeSp >= minFontSizeSp) {
        textPaint.textSize = bestFontSizeSp * density
        val lineSpacingDp = if (bestFontSizeSp >= 13f) 1.2f else 0.8f
        val staticLayout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          StaticLayout.Builder.obtain(processedText, 0, processedText.length, textPaint, availHorizontalW)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(false)
            .setLineSpacing(dpToPx(lineSpacingDp).toFloat(), 1.0f)
            .build()
        } else {
          @Suppress("DEPRECATION")
          StaticLayout(processedText, textPaint, availHorizontalW, Layout.Alignment.ALIGN_NORMAL, 1.0f, dpToPx(lineSpacingDp).toFloat(), false)
        }
        chosenLayout = staticLayout
        if (staticLayout.height <= max(height, dpToPx(20f))) {
          break
        }
        bestFontSizeSp -= 0.5f
      }
      dynamicFontSizeSp = max(minFontSizeSp, bestFontSizeSp)

      val layoutW = (chosenLayout?.width ?: availHorizontalW) + padH * 2
      val layoutH = (chosenLayout?.height ?: height) + padV * 2 + dpToPx(2f)

      targetW = max(width + dpToPx(4f), layoutW).coerceIn(dpToPx(24f), screenW - marginH * 2)
      targetH = max(height + dpToPx(4f), layoutH).coerceIn(dpToPx(18f), screenH - marginV * 2)

      fixedLeft = (centerX - targetW / 2).coerceIn(marginH, screenW - targetW - marginH)
      fixedTop = (centerY - targetH / 2).coerceIn(marginV, screenH - targetH - marginV)

      availW = max(dpToPx(16f), targetW - padH * 2)
      availH = max(dpToPx(14f), targetH - padV * 2)
    }

    val container = LinearLayout(context).apply {
      orientation = if (isMultiColVertical && segments.size > 1) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      clipChildren = false
      clipToPadding = false

      // 调低透明度：优雅微透暗黑玻璃背景 (~60% 不透明度) + 1dp 精细微光边框
      val bg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dpToPx(4f).toFloat()
        setColor(Color.parseColor("#99090E18")) // ~60% 低不透明度暗黑微透底
        val strokeAlphaColor = Color.argb(160, Color.red(themeColor), Color.green(themeColor), Color.blue(themeColor))
        setStroke(dpToPx(1f), strokeAlphaColor)  // 1dp 柔和微光细边框
      }
      background = bg
      setPadding(padH, padV, padH, padV)

      minimumWidth = targetW
      minimumHeight = targetH

      layoutParams = FrameLayout.LayoutParams(targetW, targetH).apply {
        gravity = Gravity.TOP or Gravity.START
        leftMargin = fixedLeft
        topMargin = fixedTop
      }
    }

    if (isMultiColVertical && segments.isNotEmpty()) {
      // 日漫 RTL 列流转：从右往左排列列 (第一段在最右侧，第二段在左侧)
      val rtlCols = if (segments.size > 1) segments.reversed() else segments
      for (seg in rtlCols) {
        val colText = seg.filter { !it.isWhitespace() }.map { formatVerticalChar(it) }.joinToString("\n")
        val tvCol = TextView(context).apply {
          if (colText.contains('⋮')) {
            val spannable = SpannableString(colText)
            var idx = colText.indexOf('⋮')
            while (idx >= 0) {
              spannable.setSpan(RelativeSizeSpan(0.85f), idx, idx + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
              idx = colText.indexOf('⋮', idx + 1)
            }
            text = spannable
          } else {
            text = colText
          }
          setTextColor(Color.WHITE)
          typeface = Typeface.DEFAULT_BOLD
          textSize = dynamicFontSizeSp
          includeFontPadding = false
          isSingleLine = false
          maxLines = 100
          ellipsize = null // 框内文字全部显示，绝不截断省略
          val lineSpacingDp = 0.5f
          setLineSpacing(dpToPx(lineSpacingDp).toFloat(), 1.0f)
          setShadowLayer(dpToPx(2f).toFloat(), 0f, dpToPx(1f).toFloat(), Color.parseColor("#E6000000"))
          gravity = Gravity.CENTER_HORIZONTAL
          layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
          ).apply {
            if (segments.size > 1) {
              val colMargin = if (segments.size >= 4) dpToPx(0.8f) else dpToPx(1.2f)
              setMargins(colMargin, 0, colMargin, 0)
            }
          }
        }
        container.addView(tvCol)
      }
    } else {
      val tvContent = TextView(context).apply {
        text = processedText
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        textSize = dynamicFontSizeSp
        includeFontPadding = false
        isSingleLine = false
        maxLines = 100
        ellipsize = null // 框内文字全部显示，绝不截断省略
        maxWidth = availW
        val lineSpacingDp = if (dynamicFontSizeSp >= 13f) 1.5f else 0.8f
        setLineSpacing(dpToPx(lineSpacingDp).toFloat(), 1.0f)
        setShadowLayer(dpToPx(2f).toFloat(), 0f, dpToPx(1f).toFloat(), Color.parseColor("#E6000000"))
        gravity = if (dynamicFontSizeSp <= 8.5f) Gravity.START else (Gravity.CENTER_VERTICAL or Gravity.START)
        layoutParams = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT
        )
      }
      container.addView(tvContent)
    }

    return SingleHudViewData(container, targetW, fixedLeft, fixedTop, targetH)
  }

  private fun createBubbleLayoutParams(
    targetW: Int,
    fixedLeft: Int,
    fixedTop: Int,
    targetH: Int = WindowManager.LayoutParams.WRAP_CONTENT
  ): WindowManager.LayoutParams {
    return WindowManager.LayoutParams(
      targetW,
      targetH,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = fixedLeft
      y = fixedTop
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
  }

  /**
   * 展开/收起悬浮控制卡片
   */
  fun toggleControlCard() {
    if (isCardVisible) {
      dismissCard()
    } else {
      showControlCard()
    }
  }

  /**
   * 构建并展示悬浮快捷控制与统计卡片
   */
  fun showControlCard() {
    mainHandler.post {
      try {
        cardContentLayout.removeAllViews()

        // 1. 顶部标题栏
        val header = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
        }

        val title = TextView(context).apply {
          text = "🎯 实时屏幕识别与原位标注"
          setTextColor(Color.WHITE)
          textSize = 15f
          typeface = Typeface.DEFAULT_BOLD
          layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val btnClose = TextView(context).apply {
          text = "✕"
          setTextColor(Color.parseColor("#94A3B8"))
          textSize = 18f
          setPadding(dpToPx(8f), dpToPx(4f), dpToPx(8f), dpToPx(4f))
          setOnClickListener { dismissCard() }
        }

        header.addView(title)
        header.addView(btnClose)
        cardContentLayout.addView(header)

        // 2. 状态信息与端侧模型诊断
        val infoBox = TextView(context).apply {
          val modelStatus = ComicTextDetector.statusMessage
          val modelCount = currentBubbles.count { (it["detectorSource"] == "comic_model") || (it["id"] as? String)?.startsWith("comic_det_") == true }
          val artCount = currentBubbles.count { it["textType"] == "art_text" }
          val sfxCount = currentBubbles.count { it["textType"] == "sfx" }
          val triggerText = "👆 轻触屏幕任意位置：即刻触发识别并原位显示"
          val countText = "已就绪 · 当前识别 ${currentBubbles.size} 处 (模型: ${modelCount} | 艺术字: $artCount | 拟声词: $sfxCount)"
          val modelInferText = "🤖 端侧模型: $modelStatus (${ComicTextDetector.lastInferenceTimeMs}ms)"
          text = "$triggerText\n$countText\n$modelInferText"
          setTextColor(Color.parseColor("#38BDF8"))
          textSize = 11.5f
          setPadding(0, dpToPx(4f), 0, dpToPx(8f))
        }
        cardContentLayout.addView(infoBox)

        // 3. 核心开关控制行
        val controlsRow = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          weightSum = 2f
          setPadding(0, 0, 0, dpToPx(8f))
        }

        // 开关 A: 实时滚动跟踪
        val btnToggleRealtime = createOptionButton(
          label = if (isRealtimeMode) "实时跟踪: 开" else "实时跟踪: 关",
          isActive = isRealtimeMode,
          activeColor = "#10B981"
        ) {
          isRealtimeMode = !isRealtimeMode
          onToggleRealtimeMode?.invoke(isRealtimeMode)
          setBallState(if (isRealtimeMode) "实时" else "暂停", false)
          showControlCard()
        }
        btnToggleRealtime.layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
          rightMargin = dpToPx(4f)
        }
        controlsRow.addView(btnToggleRealtime)

        // 开关 B: 原位 HUD 显示
        val btnToggleHud = createOptionButton(
          label = if (isHudVisible) "原位显示: 开" else "原位显示: 关",
          isActive = isHudVisible,
          activeColor = "#6366F1"
        ) {
          setHudVisibility(!isHudVisible)
          showControlCard()
        }
        btnToggleHud.layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
          leftMargin = dpToPx(4f)
        }
        controlsRow.addView(btnToggleHud)

        cardContentLayout.addView(controlsRow)

        // 4. 显示内容切换行 (OCR 原文 / 译文 / 双语)
        val modeRow = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(0, dpToPx(4f), 0, dpToPx(8f))
        }

        val modeLabel = TextView(context).apply {
          text = "原位显示内容: "
          setTextColor(Color.parseColor("#94A3B8"))
          textSize = 12f
        }
        modeRow.addView(modeLabel)

        val modes = listOf("box" to "📐 矩形框", "ocr" to "OCR原文", "target" to "译文", "both" to "双语")
        for ((mKey, mLabel) in modes) {
          val isSel = (hudDisplayMode == mKey)
          val btnMode = TextView(context).apply {
            text = mLabel
            setTextColor(if (isSel) Color.WHITE else Color.parseColor("#94A3B8"))
            textSize = 11f
            typeface = if (isSel) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(if (isSel) Color.parseColor("#4F46E5") else Color.parseColor("#1E293B"))
            }
            background = bg
            setPadding(dpToPx(8f), dpToPx(4f), dpToPx(8f), dpToPx(4f))
            setOnClickListener {
              setHudDisplayMode(mKey)
              showControlCard()
            }
          }
          val mlp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
          ).apply { leftMargin = dpToPx(4f) }
          btnMode.layoutParams = mlp
          modeRow.addView(btnMode)
        }

        cardContentLayout.addView(modeRow)

        // 5. 指定识别语言选择行 (仅识别需要被翻译的语言文本)
        val langRow = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(0, dpToPx(4f), 0, dpToPx(8f))
        }

        val langLabel = TextView(context).apply {
          text = "仅识别语言: "
          setTextColor(Color.parseColor("#94A3B8"))
          textSize = 12f
        }
        langRow.addView(langLabel)

        val langs = listOf(
          "ja" to "🇯🇵 日语",
          "en" to "🇬🇧 英语",
          "zh" to "🇨🇳 中文",
          "ko" to "🇰🇷 韩语",
          "all" to "🌐 全部"
        )
        for ((lKey, lLabel) in langs) {
          val isSel = (targetLangFilter == lKey)
          val btnLang = TextView(context).apply {
            text = lLabel
            setTextColor(if (isSel) Color.WHITE else Color.parseColor("#94A3B8"))
            textSize = 10.5f
            typeface = if (isSel) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(if (isSel) Color.parseColor("#059669") else Color.parseColor("#1E293B"))
            }
            background = bg
            setPadding(dpToPx(6f), dpToPx(4f), dpToPx(6f), dpToPx(4f))
            setOnClickListener {
              setTargetLanguageFilter(lKey)
              onLanguageFilterChanged?.invoke(lKey)
              showControlCard()
            }
          }
          val llp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
          ).apply { leftMargin = dpToPx(3f) }
          btnLang.layoutParams = llp
          langRow.addView(btnLang)
        }

        cardContentLayout.addView(langRow)

        // 5.2 视口范围聚焦选择行 (提升复杂密集字如「凛子」笔画清晰度与识别速度)
        val viewportRow = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(0, dpToPx(4f), 0, dpToPx(8f))
        }

        val viewportLabel = TextView(context).apply {
          text = "识别视口: "
          setTextColor(Color.parseColor("#94A3B8"))
          textSize = 12f
        }
        viewportRow.addView(viewportLabel)

        val viewports = listOf(
          "golden" to "👑 黄金视口",
          "center50" to "🔍 中央50%",
          "full" to "📱 全屏"
        )
        for ((vKey, vLabel) in viewports) {
          val isSel = (viewportMode == vKey)
          val btnViewport = TextView(context).apply {
            text = vLabel
            setTextColor(if (isSel) Color.WHITE else Color.parseColor("#94A3B8"))
            textSize = 10.5f
            typeface = if (isSel) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(if (isSel) Color.parseColor("#8B5CF6") else Color.parseColor("#1E293B"))
            }
            background = bg
            setPadding(dpToPx(7f), dpToPx(4f), dpToPx(7f), dpToPx(4f))
            setOnClickListener {
              setViewportMode(vKey)
              onViewportModeChanged?.invoke(vKey)
              showControlCard()
            }
          }
          val vlp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
          ).apply { leftMargin = dpToPx(3f) }
          btnViewport.layoutParams = vlp
          viewportRow.addView(btnViewport)
        }

        cardContentLayout.addView(viewportRow)

        // 6. 指定目标应用联动行 (离开目标应用自动销毁屏幕文字)
        val targetAppRow = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(0, dpToPx(4f), 0, dpToPx(6f))
        }

        val targetAppLabel = TextView(context).apply {
          text = "目标应用: "
          setTextColor(Color.parseColor("#94A3B8"))
          textSize = 12f
        }
        targetAppRow.addView(targetAppLabel)

        if (targetAppPackage == null) {
          val badgeAll = TextView(context).apply {
            text = "全部应用 (不限)"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 11f
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(Color.parseColor("#1E293B"))
            }
            background = bg
            setPadding(dpToPx(6f), dpToPx(3.5f), dpToPx(6f), dpToPx(3.5f))
          }
          targetAppRow.addView(badgeAll)

          val btnLock = TextView(context).apply {
            text = "🎯 锁定当前应用"
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(Color.parseColor("#2563EB"))
            }
            background = bg
            setPadding(dpToPx(8f), dpToPx(3.5f), dpToPx(8f), dpToPx(3.5f))
            setOnClickListener {
              onLockCurrentAppClicked?.invoke()
            }
          }
          val blp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
          ).apply { leftMargin = dpToPx(6f) }
          btnLock.layoutParams = blp
          targetAppRow.addView(btnLock)
        } else {
          val badgeLocked = TextView(context).apply {
            val displayName = targetAppName ?: targetAppPackage ?: "已指定应用"
            text = "🔒 $displayName"
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(Color.parseColor("#059669"))
            }
            background = bg
            setPadding(dpToPx(6f), dpToPx(3.5f), dpToPx(6f), dpToPx(3.5f))
          }
          targetAppRow.addView(badgeLocked)

          val btnUnlock = TextView(context).apply {
            text = "✕ 解除锁定"
            setTextColor(Color.parseColor("#EF4444"))
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(6f).toFloat()
              setColor(Color.parseColor("#1E293B"))
              setStroke(dpToPx(1f), Color.parseColor("#EF4444"))
            }
            background = bg
            setPadding(dpToPx(6f), dpToPx(3.5f), dpToPx(6f), dpToPx(3.5f))
            setOnClickListener {
              onUnlockAppClicked?.invoke()
            }
          }
          val ulp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
          ).apply { leftMargin = dpToPx(6f) }
          btnUnlock.layoutParams = ulp
          targetAppRow.addView(btnUnlock)
        }

        cardContentLayout.addView(targetAppRow)

        // 如果已锁定目标应用，提供“切出时销毁/保留”动作切换开关
        if (targetAppPackage != null) {
          val actionRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dpToPx(3f), 0, dpToPx(5f))
          }
          val actionLabel = TextView(context).apply {
            text = "切出应用动作: "
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 11.5f
          }
          actionRow.addView(actionLabel)

          val btnActionToggle = TextView(context).apply {
            text = if (destroyBubblesOnAppSwitch) "🗑️ 销毁屏幕文字" else "📌 保留文字对照"
            setTextColor(Color.WHITE)
            textSize = 10.5f
            typeface = Typeface.DEFAULT_BOLD
            val bg = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              cornerRadius = dpToPx(5f).toFloat()
              setColor(if (destroyBubblesOnAppSwitch) Color.parseColor("#DC2626") else Color.parseColor("#059669"))
            }
            background = bg
            setPadding(dpToPx(7f), dpToPx(3.5f), dpToPx(7f), dpToPx(3.5f))
            setOnClickListener {
              val next = !destroyBubblesOnAppSwitch
              destroyBubblesOnAppSwitch = next
              onDestroyOnAppSwitchChanged?.invoke(next)
              showControlCard()
            }
          }
          actionRow.addView(btnActionToggle)
          cardContentLayout.addView(actionRow)
        }

        // 切出时悬浮小球状态 (变不可点击 / 完全隐藏 / 触摸穿透)
        if (targetAppPackage != null) {
          val behaviorRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dpToPx(3f), 0, dpToPx(5f))
          }
          val behaviorLabel = TextView(context).apply {
            text = "切出悬浮球: "
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 11.5f
          }
          behaviorRow.addView(behaviorLabel)

          val behaviors = listOf(
            "dormant" to "待机不可点",
            "hide" to "完全隐藏",
            "touch_through" to "触摸穿透"
          )
          for ((bKey, bLabel) in behaviors) {
            val isSel = (outsideAppBallBehavior == bKey)
            val btnB = TextView(context).apply {
              text = bLabel
              setTextColor(if (isSel) Color.WHITE else Color.parseColor("#94A3B8"))
              textSize = 10f
              typeface = if (isSel) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
              val bg = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dpToPx(5f).toFloat()
                setColor(if (isSel) Color.parseColor("#2563EB") else Color.parseColor("#1E293B"))
              }
              background = bg
              setPadding(dpToPx(6f), dpToPx(3.5f), dpToPx(6f), dpToPx(3.5f))
              setOnClickListener {
                setOutsideAppBallBehavior(bKey)
                onOutsideAppBallBehaviorChanged?.invoke(bKey)
                showControlCard()
              }
            }
            val blp = LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.WRAP_CONTENT,
              LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dpToPx(3f) }
            btnB.layoutParams = blp
            behaviorRow.addView(btnB)
          }
          cardContentLayout.addView(behaviorRow)
        }

        // 提示小字
        val tipView = TextView(context).apply {
          val viewportTip = when (viewportMode) {
            "center50" -> "⚡ 中央50%：聚焦屏幕中间，识别速度提升 50%"
            "golden" -> "👑 黄金视口：聚焦核心阅读区(76%)"
            else -> "📱 全屏模式 (默认)：扫描整个屏幕，自动省略贴边残缺文字"
          }
          val lockTip = if (targetAppPackage != null) {
            val behaviorTip = when (outsideAppBallBehavior) {
              "hide" -> "切出时自动隐藏悬浮球"
              "touch_through" -> "切出时悬浮球完全穿透不可点击"
              else -> "切出时悬浮球待机且不可点击"
            }
            "💡 锁定保护：$behaviorTip，切出时不监听屏幕点击"
          } else {
            "💡 提示：锁定应用后，切换到其他应用时小球变不可点击且不监听屏幕事件"
          }
          text = "$viewportTip\n$lockTip"
          setTextColor(Color.parseColor("#64748B"))
          textSize = 10f
          setPadding(0, 0, 0, dpToPx(4f))
        }
        cardContentLayout.addView(tipView)

        // 7. 底部操作栏 (手动单次刷新 / 关闭服务)
        val footerRow = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.END
          setPadding(0, dpToPx(8f), 0, 0)
        }

        val btnManualCapture = TextView(context).apply {
          text = "📸 立即全量扫描"
          setTextColor(Color.parseColor("#38BDF8"))
          textSize = 12.5f
          setPadding(dpToPx(10f), dpToPx(6f), dpToPx(10f), dpToPx(6f))
          setOnClickListener {
            dismissCard()
            onCaptureClicked()
          }
        }

        val btnStop = TextView(context).apply {
          text = "🛑 退出服务"
          setTextColor(Color.parseColor("#EF4444"))
          textSize = 12.5f
          setPadding(dpToPx(10f), dpToPx(6f), dpToPx(10f), dpToPx(6f))
          setOnClickListener {
            dismissCard()
            onCloseClicked()
          }
        }

        footerRow.addView(btnManualCapture)
        footerRow.addView(btnStop)
        cardContentLayout.addView(footerRow)

        // 显示弹窗
        if (!isCardVisible) {
          if (cardView.windowToken == null) {
            windowManager.addView(cardView, cardParams)
          }
          isCardVisible = true
        } else {
          windowManager.updateViewLayout(cardView, cardParams)
        }
      } catch (e: Exception) {
        Log.e("FloatingOverlayView", "showControlCard failed", e)
      }
    }
  }

  private fun createOptionButton(
    label: String,
    isActive: Boolean,
    activeColor: String,
    onClick: () -> Unit
  ): TextView {
    return TextView(context).apply {
      text = label
      setTextColor(if (isActive) Color.WHITE else Color.parseColor("#94A3B8"))
      textSize = 12f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      val bg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dpToPx(8f).toFloat()
        setColor(if (isActive) Color.parseColor(activeColor) else Color.parseColor("#1E293B"))
      }
      background = bg
      setPadding(dpToPx(8f), dpToPx(8f), dpToPx(8f), dpToPx(8f))
      setOnClickListener { onClick() }
    }
  }

  fun setRealtimeMode(enabled: Boolean) {
    isRealtimeMode = enabled
    setBallState(if (enabled) "实时" else "暂停", false)
  }

  fun setHudVisibility(visible: Boolean) {
    isHudVisible = visible
    mainHandler.post {
      if (!visible) {
        clearHudBubbles()
      } else {
        updateRealtimeBubbles(currentBubbles)
      }
    }
  }

  fun setHudDisplayMode(mode: String) {
    hudDisplayMode = mode.lowercase().trim()
    try {
      val prefs = context.getSharedPreferences("screen_translator_prefs", Context.MODE_PRIVATE)
      prefs.edit().putString("hud_display_mode", hudDisplayMode).apply()
      ScreenTranslatorOverlayModule.emitHudDisplayModeChanged(hudDisplayMode)
    } catch (e: Exception) {}
    mainHandler.post {
      updateRealtimeBubbles(currentBubbles)
    }
  }

  fun showTranslationResultCard(bubblesJson: String) {
    try {
      val bubbles = JSONArray(bubblesJson)
      val list = mutableListOf<Map<String, Any>>()
      for (i in 0 until bubbles.length()) {
        val obj = bubbles.getJSONObject(i)
        val boxObj = obj.optJSONObject("box")
        val boxMap = if (boxObj != null) {
          mapOf(
            "x" to boxObj.optInt("x", 0),
            "y" to boxObj.optInt("y", 0),
            "width" to boxObj.optInt("width", 100),
            "height" to boxObj.optInt("height", 50)
          )
        } else mapOf("x" to 0, "y" to 0, "width" to 100, "height" to 50)

        val linesArr = obj.optJSONArray("lines")
        val linesList = if (linesArr != null) {
          val res = mutableListOf<String>()
          for (j in 0 until linesArr.length()) {
            val lineStr = linesArr.optString(j, "")
            if (lineStr.isNotBlank()) res.add(lineStr)
          }
          res
        } else emptyList<String>()

        list.add(
          mapOf(
            "id" to obj.optString("id", "b_$i"),
            "box" to boxMap,
            "sourceText" to obj.optString("sourceText", ""),
            "targetText" to obj.optString("targetText", ""),
            "detectedLang" to obj.optString("detectedLang", "ja"),
            "detectorSource" to obj.optString("detectorSource", ""),
            "readingOrderIndex" to obj.optInt("readingOrderIndex", i),
            "langName" to obj.optString("langName", "文本"),
            "langColor" to obj.optString("langColor", "#0EA5E9"),
            "fontSize" to obj.optDouble("fontSize", 0.0).toFloat(),
            "direction" to obj.optString("direction", ""),
            "columnCount" to obj.optInt("columnCount", linesList.size),
            "lines" to linesList,
            "textType" to obj.optString("textType", "bubble"),
            "confidence" to obj.optDouble("confidence", 0.90).toFloat()
          )
        )
      }
      updateRealtimeBubbles(list)
      setBallState("就绪", false)
    } catch (e: Exception) {}
  }

  fun renderInpaintOverlay(bubblesJson: String) {
    // 兼容原有的全屏消字模态测试
    showTranslationResultCard(bubblesJson)
  }

  fun dismissCard() {
    try {
      if (isCardVisible && cardView.windowToken != null) {
        windowManager.removeView(cardView)
        isCardVisible = false
      }
    } catch (e: Exception) {}
  }

  fun dismissInpaintOverlay() {
    try {
      if (isInpaintOverlayVisible && inpaintOverlayView.windowToken != null) {
        windowManager.removeView(inpaintOverlayView)
        isInpaintOverlayVisible = false
      }
    } catch (e: Exception) {}
  }

  private fun dpToPx(dp: Float): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      dp,
      context.resources.displayMetrics
    ).toInt()
  }
}
