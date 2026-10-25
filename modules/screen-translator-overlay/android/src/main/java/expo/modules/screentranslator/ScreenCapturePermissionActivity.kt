package expo.modules.screentranslator

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle

class ScreenCapturePermissionActivity : Activity() {

  companion object {
    private const val REQUEST_MEDIA_PROJECTION = 1001
  }

  private var isResultHandled = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    // Android 14+ 允许用户在系统授权弹窗中指定共享单个应用（Partial Screen Sharing）或整个屏幕
    val captureIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val config = android.media.projection.MediaProjectionConfig.createConfigForUserChoice()
      mediaProjectionManager.createScreenCaptureIntent(config)
    } else {
      mediaProjectionManager.createScreenCaptureIntent()
    }
    @Suppress("DEPRECATION")
    startActivityForResult(captureIntent, REQUEST_MEDIA_PROJECTION)
  }

  @Suppress("DEPRECATION")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)

    if (requestCode == REQUEST_MEDIA_PROJECTION) {
      isResultHandled = true
      if (resultCode == RESULT_OK && data != null) {
        val serviceIntent = Intent(this, ScreenCaptureOverlayService::class.java).apply {
          action = ScreenCaptureOverlayService.ACTION_START
          putExtra(ScreenCaptureOverlayService.EXTRA_RESULT_CODE, resultCode)
          putExtra(ScreenCaptureOverlayService.EXTRA_RESULT_DATA, data)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(serviceIntent)
        } else {
          startService(serviceIntent)
        }

        ScreenTranslatorOverlayModule.onServiceStartResult(true, null)
      } else {
        ScreenTranslatorOverlayModule.onServiceStartResult(false, "用户未允许屏幕录制/截屏权限")
      }
    }

    finish()
  }

  override fun onDestroy() {
    super.onDestroy()
    if (!isResultHandled) {
      isResultHandled = true
      ScreenTranslatorOverlayModule.onServiceStartResult(false, "屏幕录制权限申请已被取消")
    }
  }
}
