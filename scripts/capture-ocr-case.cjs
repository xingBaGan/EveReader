#!/usr/bin/env node
// Run on the development machine connected to adb. No dependencies required.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} 缺少参数`);
  return args[index + 1];
}
const root = path.resolve(__dirname, '..');
const adb = process.env.ADB || 'adb';
function run(argv, binary = false) {
  return execFileSync(adb, argv, {
    encoding: binary ? undefined : 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: 30000, windowsHide: true,
  });
}
function capture(serial, filename) {
  const png = run(['-s', serial, 'exec-out', 'screencap', '-p'], true);
  if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error('adb 没有返回有效 PNG，截图未写入');
  }
  fs.writeFileSync(filename, png, { flag: 'wx' });
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function main() {
  if (args.includes('--help')) {
    console.log('node scripts/capture-ocr-case.cjs [--page 20] [--note "漏检"] [--device SERIAL] [--clean-only]');
    console.log('默认先截识别现场，再提示手动关闭气泡框，按 Enter 保存干净输入；在 Windows 项目目录运行。');
    return;
  }
  const lines = run(['devices']).split(/\r?\n/);
  const devices = lines.map(line => line.match(/^(\S+)\s+device(?:\s|$)/)?.[1]).filter(Boolean);
  // adb may expose the same wireless phone by both IP and mDNS. Query stable serials.
  const physical = new Map();
  for (const serial of devices) {
    const identity = run(['-s', serial, 'shell', 'getprop', 'ro.serialno']).trim() || serial;
    if (!physical.has(identity)) physical.set(identity, serial);
  }
  const serial = option('--device') || (physical.size === 1 ? [...physical.values()][0] : undefined);
  if (!serial || !devices.includes(serial)) {
    throw new Error(`请选择在线设备 --device SERIAL；当前在线：${devices.join(', ') || '无'}`);
  }
  const page = option('--page') || null;
  const note = option('--note') || '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `case-${stamp}-${require('node:crypto').randomBytes(3).toString('hex')}`;
  const directory = path.join(root, 'tests', 'ocr-regression', 'captures', id);
  fs.mkdirSync(directory, { recursive: true });
  const metadata = {
    id, capturedAt: new Date().toISOString(), page, note, device: serial,
    model: run(['-s', serial, 'shell', 'getprop', 'ro.product.model']).trim(),
    status: 'pending-clean-capture', expectedText: null, expectedRegion: null,
    annotationStatus: 'needs-review',
  };
  const metadataPath = path.join(directory, 'case.json');
  const save = () => fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  save();
  console.log(`设备：${metadata.model} (${serial})\n保存目录：${directory}`);
  if (!args.includes('--clean-only')) {
    metadata.screenshot = 'overlay.png';
    metadata.dimensions = capture(serial, path.join(directory, 'overlay.png'));
    save();
    console.log('已保存当前识别现场。请在手机上关闭气泡框，保持同一页、同一缩放。');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { await rl.question('准备好后按 Enter 保存干净原图（Ctrl+C 退出，已截图片会保留）：'); }
    finally { rl.close(); }
  }
  metadata.input = 'clean.png';
  metadata.dimensions = capture(serial, path.join(directory, 'clean.png'));
  metadata.status = 'captured-needs-annotation';
  try { metadata.gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { metadata.gitCommit = null; }
  save();
  console.log('样本已保存。填写 case.json 的正确原文与区域，再加入 cases.json 进行准确率评测。');
  console.log('clean.png 是完整手机截图；正式评测前请裁剪漫画区域，避免界面文字干扰。');
}
main().catch(error => { console.error(`采集失败：${error.message}`); process.exitCode = 1; });
