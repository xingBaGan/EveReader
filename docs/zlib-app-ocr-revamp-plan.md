# zlib-app 漫画 OCR 模块重构与优化实施蓝图

> **目标**：彻底解决 Android 端侧漫画阅读器 6 秒/页延迟、文字识别幻觉、竖排多列阅读顺序错乱等历史顽疾。  
> **核心改动**：用单模型单次前向的 **`manga-ocr-charspot-small`**（11M 参数，44MB ONNX）全面替换旧版三段式自回归 **Manga-OCR**（62MB 3段 ONNX + 复杂 KV-Cache 循环），配合已有 **`ogkalu RT-DETR`**（11.1MB int8）实现整页 < 1 秒极速、零幻觉、带字符级绝对坐标的漫画 OCR 体验。

---

## 1. 现状痛点与重构对比

| 模块 | 现状（旧架构） | 重构后（新架构） | 优化效果 |
|---|---|---|---|
| **模型资产** | 3 个 ONNX (`encoder` 16M + `decoder_init` 24M + `decoder_step` 22M) 共 62MB | 1 个 ONNX (`charspot_small.onnx`, 44MB) + `vocab.json` (60KB) | **模型体积减少 18MB (-29%)** |
| **推理机制** | 循环自回归解码（单字前向 + KV-Cache，每框循环 20~40 次） | 单次前向密集字符检测 + 排序头（无解码器，单次前向出全结果） | **推理代码从 486 行压减到 ~120 行**，彻底去除 KV Cache |
| **单图 OCR 耗时** | 328 ms / 框（18 框即 6.0 秒） | **25.8 ms / 框**（18 框仅 460 ms） | **OCR 速度提升 12.7 倍** |
| **整页端到端耗时** | **6.0 ~ 7.8 秒 / 页** | **0.69 ~ 0.89 秒 / 页** | **整页速度提升 8.9 倍，实现 < 1 秒即开即读** |
| **字符级坐标输出** | ❌ 无，仅能得到整块模糊文字 | **✅ 内部直接产出每个字符在原图上的 `[x0, y0, x1, y1]`** | 原生支持气泡内划词翻译、点词查词 |
| **阅读顺序还原** | ❌ 外部依赖启发式宽高比与行切分（极易错乱） | **✅ 模型内部直接输出正确的 RTL（右列至左列、自上而下）排序** | 根治「勧げ前誘」类多列穿插阅读倒序 |
| **幻觉与误读** | 横排 CER 29.7%，手写/拟声词 CER 15.1% | **横排 CER 0.0%，手写/拟声词 CER 3.52%，整体 CER 1.22%** | **错误率下降 74%**，彻底杜绝无中生有大段幻觉 |

---

## 2. 改造涉及的具体文件清单

```
modules/screen-translator-overlay/
├── android/src/main/assets/models/
│   ├── comic_detector.onnx                  (保留，11.1MB ogkalu RT-DETR int8)
│   ├── manga_ocr_charspot_small.onnx        (新增，44.0MB 单图 ONNX)
│   ├── charspot_vocab.json                  (新增，60KB 字典文件)
│   ├── manga_ocr_encoder.onnx               (删除，-16MB)
│   ├── manga_ocr_decoder_init.onnx          (删除，-24MB)
│   ├── manga_ocr_decoder_step.onnx          (删除，-22MB)
│   └── manga_ocr_vocab.txt                  (删除，-36KB)
├── android/src/main/java/expo/modules/screentranslator/
│   ├── MangaOcrModel.kt                     (重大重构：单会话前向，输出 Text + CharBoxes)
│   ├── MangaOcrProcessor.kt                 (简化：移除繁琐的多 pass 裁决与幻觉修补逻辑)
│   ├── ComicTextDetector.kt                 (微调：scoreThreshold 设为 0.22~0.25 保证高召回)
│   └── ScreenTranslatorOverlayModule.kt     (扩展：回传给前端每个字符的像素坐标与置信度)
src/
└── utils/
    └── mangaDetector.ts                     (前端：消费字符级坐标，支持精细化文字遮罩与排版)
```

---

## 3. 分阶段具体实施步骤

### 阶段一：准备与替换模型资产文件
1. 从 Windows 验证目录 `E:\code_space\manga-ocr-poc\models\charspot-small\` 中拷贝：
   - `model.onnx` -> 重命名为 `manga_ocr_charspot_small.onnx` 放入 `assets/models/`
   - `vocab.json` -> 放入 `assets/models/charspot_vocab.json`
2. 删除旧的 3 个 `manga_ocr_*.onnx` 与 `manga_ocr_vocab.txt`。

### 阶段二：重写 `MangaOcrModel.kt`
将原先复杂的 3 个 ONNX 会话与自回归 Token 生成循环简化为单图前向：

```kotlin
// 核心数据结构
data class CharBox(val char: String, val score: Float, val box: RectF)
data class OcrResult(val text: String, val chars: List<CharBox>, val avgScore: Float)

object MangaOcrModel {
    private const val MODEL_NAME = "models/manga_ocr_charspot_small.onnx"
    private const val VOCAB_NAME = "models/charspot_vocab.json"
    
    // ONNX 只有 1 个会话：
    // Input: "img" [1, 3, H, W] (Float32, 0~255 范围标准化或模型内置归一化)
    // Outputs:
    //   "boxes"  [N, 4] -> 字符包围盒 [x0, y0, x1, y2]
    //   "scores" [N]    -> 字符中心置信度峰值
    //   "ids"    [N]    -> 对应 vocab 字典索引
    //   "order"  [N]    -> 排序头预测的阅读顺序索引数组 (极关键：按 order[i] 遍历即为正确阅读顺序！)
    
    fun recognize(cropBitmap: Bitmap): OcrResult {
        // 1. 预处理至模型期望尺寸 (维持纵横比 padding 或 bicubic resize)
        // 2. 单次 session.run()
        // 3. 按 order 数组依次提取字符并拼接字符串，同时映射字符级坐标
        // 4. 返回完整 OcrResult
    }
}
```

### 阶段三：精简与升级 `MangaOcrProcessor.kt`
- **移除历史负债**：旧版代码中因为 MangaOCR 极易产生「ああああはは」等幻觉，堆砌了 `arbitrateMultiChannelCandidates`、ML Kit 与 MangaOCR 互投裁决、低置信度双重校验等数百行补丁逻辑。新模型抗幻觉能力极强（手写 CER 3.5% vs 旧版 15.1%），可以直接以 charspot 输出为主，大幅简化流水线。
- **坐标投影还原**：将 `CharBox` 局部坐标累加检测气泡左上角 `(x1, y1)`，直接还原为页面的绝对坐标。

### 阶段四：前端协议适配与 UI 升级 (`src/utils/mangaDetector.ts` & Overlay)
- `ScreenTranslatorOverlayModule.kt` 返回的数据结构由原先简单的 `{ text: string, box: Rect }` 扩展为：
  ```ts
  interface DetectedBubble {
    text: string;
    box: [number, number, number, number];
    confidence: number;
    textType: 'bubble' | 'free_text';
    // 新增字符级信息：
    chars?: Array<{
      char: string;
      score: number;
      box: [number, number, number, number]; // 字符级在整页上的绝对位置
    }>;
  }
  ```
- 漫画阅读器即可利用字符级坐标实现：
  1. 竖排排版时完美按照每列每字精确对齐，避免译文覆盖溢出；
  2. 支持长按/点击单字或单词弹出即时词典；
  3. 涂白抹字（Inpainting/Erase）时只涂抹有字的像素，保留气泡背景纹理。

---

## 4. 验证与回归指标口径

在新对话中实施上述步骤后，使用以下指标验收：
1. **构建包体积**：APK 增量体积不仅不增加，反而净减约 15~18 MB。
2. **端到端延迟（真机测试）**：
   - 第 6 页、第 7 页冷启动时间由原来的 6.0~7.8 秒直接降至 **< 1.0 秒**。
   - 热启动时间维持在 **500~750 ms**。
3. **识别质量回归**：
   - 包含大标题、艺术字的第 6 页 100% 正确识别人名「足立君」与艺术字「淫猥母子」「みな本 Presents」「げ…勧誘…」，无倒序错乱。
