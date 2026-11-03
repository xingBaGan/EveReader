# 文本框检测 v2 改动与真机实测（2026-11-01 16:25）

## 改了什么

| 文件 | 改动 |
|---|---|
| `modules/screen-translator-overlay/.../ComicTextDetector.kt` | ① letterbox 等比缩放+灰边，替代直接拉伸到 640×640；② 整页 + 2×2 带重叠网格多视图推理；③ 跨视图/跨类别去重（IoU + 包含度），同一区域只留一个框；④ 艺术字阈值 0.18 → 0.32，剔除大面积脸部/肤色误检；⑤ 孤立 `cat0` 框提升为文本框（拟声词常落在该类）；⑥ 艺术字以整页视图为准，分块碎片丢弃 |
| `.../DebugOcrEvalReceiver.kt`（新增） | debug-only 广播入口：把设备上的图片跑「检测器多配置 + 完整流水线」，结果落盘，**全程零触摸** |
| `.../AndroidManifest.xml` | 注册上述 receiver（内部有 debuggable 兜底） |
| `.../MangaOcrProcessor.kt` | 两处调用改为使用检测器默认策略（原先硬编码 0.28/0.18 会覆盖新阈值） |

真机安装包由 Windows 工程 `E:\code_space\EveReader` 构建（JDK17 = Android Studio JBR，SDK = `%LOCALAPPDATA%\android\Sdk`），Mac 侧只负责改代码与评测。

## 怎么在无点击权限下评测

```bash
# 1) 图片放进应用私有目录（adb push 到外部目录会被 scoped storage 拒绝）
adb shell run-as com.anonymous.zlibapp mkdir -p files/eval/in
adb shell run-as com.anonymous.zlibapp sh -c 'cat > files/eval/in/p6.jpg' < p6.jpg   # 大文件分块追加更稳

# 2) 触发（先 am start 一次，否则 force-stopped 应用收不到广播）
adb shell am start -n com.anonymous.zlibapp/.MainActivity
adb shell am broadcast -a expo.modules.screentranslator.DEBUG_OCR_EVAL \
  -n com.anonymous.zlibapp/expo.modules.screentranslator.DebugOcrEvalReceiver \
  --es indir /data/user/0/com.anonymous.zlibapp/files/eval/in \
  --es out /data/user/0/com.anonymous.zlibapp/files/eval/out.json

# 3) 取结果 + 渲染
adb exec-out run-as com.anonymous.zlibapp cat files/eval/out.json > out.json
/tmp/ortenv/bin/python .dsh/det-eval/render.py out.json
```

## 实测（同一台真机、同三页）

| 指标 | 旧构建 | v2 | 说明 |
|---|---|---|---|
| p6 艺术字区域命中 | 5 | **6**（新增右上 `ピンポーン♪`） | 红标题/logo/`淫猥母子`/`げ…勧誘…` 均命中 |
| p6 同区域重复框 | 2（红标题被认两次） | **0** | 跨视图去重生效 |
| 艺术字框落在脸部/皮肤 | 25 个原始框里 18 个 | **0** | 阈值 0.18→0.32 |
| 检测器耗时 | ~0.20s（单视图拉伸） | 0.21s（整页 letterbox）/ **0.9s**（2×2 网格） | 网格是召回换来的成本 |
| 流水线端到端 p6/p7/p8 | 6.0 / 3.5 / 1.8 s | 6.5 / 6.6 / 3.6 s | 多视图导致 +0.7~3s |

## 已知未解决

1. **红字大标题「勧誘」仍被切成 2–3 个框**：模型在 640 输入下把两个大字当两个区域，需要独立的「同行行聚类」阶段才能合成单框（下一步）。
2. `p7/p8` 总框数略降（20→18、10→9）：删掉的都是噪声框（面部/背景误检），OCR 文本质量不受影响。
3. 首次触发含模型冷启动，耗时偏高；第二次同页约 -30%。

---

## 追加修复（16:50）

针对「瞳孔被框进去 / 空白墙面被框」和「大标题被切成多段」：

| 修复 | 规则 | 证据 |
|---|---|---|
| 瞳孔误检 | 艺术字框面积 < 页面 0.12% 直接丢弃（该框 25×27，占 0.06%） | `[FP_FILTER] drop tiny art box 25x27 at (452,1051)` |
| 空白墙面误检 | 抽样灰度标准差 < 18 且深色占比 >88% 判为平坦区域丢弃 | `[FP_FILTER] drop flat art box 77x169 at (837,964)` |
| 大标题分段 | 检测器按「同高 + 同水平带 + 横向间隙 ≤13% 页宽」合并；流水线中若艺术字框明显大于命中的气泡，则整块重建 | `[ART_EXPAND] replace 152x115 bubble with art box 377x182` |

## 最终落地：方案 B（标题与小字分离独立成框，17:30）

确认方案 A（大框合并）会导致 OCR 识别彻底错乱后，全面切换并固化为**方案 B**：

### 核心机制
1. **收紧横向同族合并**：仅在高度比 $\ge 0.80$、中心线对齐 $\le 0.45\times \min(H)$ 时合并，大标题「勧誘」两字合并，但绝对不吞下方高度更小的小字。
2. **清理暴力吸收规则**：移除流水线阶段强行吞并周围气泡的 `ART_ABSORB` 和 `ART_EXPAND`，杜绝大框吃小框。
3. **安全交叠解耦**：重度重叠合并由原先粗暴的 `overlapRatio > 0.35` 提高为同类型且 `iou > 0.60 || overlapRatio > 0.75`，不同类型或仅轻微上下挨着的标题与副标题，交由边缘退让阶段自动分离，互不消除。
4. **修复默认阈值覆盖**：修正 `ComicTextDetector.detect()` 默认参数会把 `artScoreThreshold` 回退到 `0.18f` 的缺陷，统一使用 `0.32f` 过滤底噪。

### 第 6 页 15 个框实测清单
- 标题「勧誘」：`(328, 682, 377, 155)` 独立完整框
- 副标题「淫猥母子 新シリーズ ご開演♡」：`(484, 847, 111, 79)` 独立小框
- 标识「みな本 Presents」：`(617, 840, 220, 73)` 独立小框
- 拟声词「ピンポーン♪」：`(759, 15, 76, 164)` 准确命中
- 对白气泡与常规文本 11 处：全部精准独立成框，无漏检
- 误检消除：瞳孔框、空白墙面框维持 0 误检
