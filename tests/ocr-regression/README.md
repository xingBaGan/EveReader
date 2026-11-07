# OCR 与气泡位置回归评测

这套工具把有问题或已经修好的漫画页面保存成可重复运行的真机测试。只有人工确认过的 `approved` 用例会进入回归；错误识别现场绝不会自动变成正确答案。

## Windows 上一键收录当前页面

在 `E:\code_space\EveReader` 打开 PowerShell，确保 `adb devices` 能看到手机：

```powershell
node scripts/ocr-case.cjs capture --page 20 --note "右侧短气泡漏检"
```

工具先保存带识别覆盖层的 `observed.png`，然后提示关闭气泡。保持页面和缩放不变，按 Enter 保存真正送入 OCR 的 `input.png`。如果覆盖层已经关闭：

```powershell
node scripts/ocr-case.cjs capture --clean-only --page 20 --note "原文识别错误"
```

脚本会自动合并同一物理手机的无线 ADB 别名。连接多台手机时使用 `--device SERIAL`。所有 ADB 调用都使用参数数组，PNG 以二进制保存，不经过 PowerShell 重定向。

## 标注与批准

采集完成会显示 `CASE_ID`。打开无依赖标注页面：

```powershell
node scripts/ocr-case.cjs annotate CASE_ID
```

在图片上拖动新增矩形；矩形可移动、缩放和删除。填写正确原文、方向、类型以及是否忽略。点击“下载 expected.json”，将下载文件覆盖：

```text
tests/ocr-regression/cases/CASE_ID/expected.json
```

确认无误后：

```powershell
node scripts/ocr-case.cjs approve CASE_ID
```

`approve` 会校验图片、标注、归一化坐标和元数据。没有文字的合法空页必须显式设置 `"allowEmpty": true`。坐标格式是 `[x,y,width,height]`，范围为 0～1。

每个用例包含：

```text
cases/CASE_ID/
  input.png       无覆盖层的固定评测输入
  observed.png    可选，发生问题时的现场
  expected.json   人工确认的气泡、正确文字和忽略区域
  meta.json       状态、页面、设备、提交号和说明
  annotate.html   临时生成的本地标注页
```

## 真机回归

安装包含 `DebugOcrEvalReceiver` 的 debug build，然后运行：

```powershell
node scripts/ocr-case.cjs run --device DEVICE
```

工具会将全部 approved 输入经 `/data/local/tmp` 安全复制到 debug 应用内部目录（避免 Android 作用域存储导致应用看不到 ADB 创建的外部目录），触发与悬浮窗线上一致的 `MangaOcrProcessor.processImageFast` 流水线、等待结果并生成：

```text
tests/ocr-regression/runs/out-*.json
tests/ocr-regression/reports/<时间>/report.json
tests/ocr-regression/reports/<时间>/report.html
```

已有真机输出也可离线比较：

```powershell
node scripts/ocr-case.cjs run --out .\out.json
```

旧命令仍可使用，它会转发到同一评测器：

```powershell
node tests/ocr-regression/compare.cjs .\out.json
```

评测使用 IoU 阈值 0.5 做气泡框一对一匹配，统计 detection precision/recall/F1、平均 IoU、OCR CER、严格文本匹配、方向/类型准确率和耗时。四个字符以内的短文本必须严格一致。当前 Android 输出没有方向和阅读顺序字段时，报告会明确显示 N/A，不会伪造结果。

HTML 报告颜色：绿色为正确、红色为漏检、紫色为误检、橙色为位置或文字问题。`partial: true` 的旧迁移用例只验证已标注锚点，未标注区域不会被误判成 false positive；补齐整页标注后应改为 `partial: false`。

## 自动测试

```powershell
npm run ocr:test
npm run lint
npx tsc --noEmit
```

现有 page19/page20/page21 是从旧的手工锚点迁移而来，仍属于部分标注，不代表整页完整 ground truth。旧格式保存的是宽松搜索区域；迁移时已根据 2026-11-07 真机结果将框收紧到对应文字块，其中 page20 的短气泡仍保留正确期望 `…はい♡`，不会把错误文本固化为答案。page19 另加入顶部两个独立文字块，用于防止 #5 合并大框与 #2 重复框的重叠回归。

漫画截图可能受版权约束。工具默认只保存在本地；是否提交图片到 Git 或上传 CI 必须由项目所有者决定。建议私有仓库存储，或只在专用回归机器运行。
