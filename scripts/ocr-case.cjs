#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const evaluator = require('../tests/ocr-regression/evaluator.cjs');

const root = path.resolve(__dirname, '..');
const suiteRoot = path.join(root, 'tests', 'ocr-regression');
const casesRoot = path.join(suiteRoot, 'cases');
const manifestPath = path.join(suiteRoot, 'manifest.json');
const args = process.argv.slice(2);
const command = args[0];
const adb = process.env.ADB || 'adb';
const appId = 'com.anonymous.zlibapp';

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`);
  return value;
}
function has(name) { return args.includes(name); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function manifest() { return fs.existsSync(manifestPath) ? json(manifestPath) : { version: 1, cases: [] }; }
function caseDirectory(id) {
  if (!/^[a-zA-Z0-9._-]+$/.test(id || '')) throw new Error('无效 CASE_ID');
  return path.join(casesRoot, id);
}
function adbRun(argv, binary = false, timeout = 30000) {
  return execFileSync(adb, argv, { encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true });
}
function devices() {
  const online = adbRun(['devices']).split(/\r?\n/).map((line) => line.match(/^(\S+)\s+device(?:\s|$)/)?.[1]).filter(Boolean);
  const physical = new Map();
  for (const serial of online) {
    const stable = adbRun(['-s', serial, 'shell', 'getprop', 'ro.serialno']).trim() || serial;
    if (!physical.has(stable)) physical.set(stable, serial);
  }
  return { online, physical };
}
function chooseDevice() {
  const found = devices();
  const requested = option('--device');
  if (requested && found.online.includes(requested)) return requested;
  if (!requested && found.physical.size === 1) return [...found.physical.values()][0];
  throw new Error(`请选择在线设备 --device SERIAL；当前在线：${found.online.join(', ') || '无'}`);
}
function capturePng(serial, target) {
  const data = adbRun(['-s', serial, 'exec-out', 'screencap', '-p'], true);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('adb 没有返回有效 PNG');
  fs.writeFileSync(target, data, { flag: 'wx' });
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function capture() {
  const serial = chooseDevice();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = option('--id', `case-${stamp}-${crypto.randomBytes(3).toString('hex')}`);
  const directory = caseDirectory(id);
  fs.mkdirSync(directory, { recursive: false });
  const model = adbRun(['-s', serial, 'shell', 'getprop', 'ro.product.model']).trim();
  const meta = { id, status: 'draft', annotationStatus: 'needs-review', page: option('--page', null), note: option('--note', ''), capturedAt: new Date().toISOString(), device: serial, model };
  if (!has('--clean-only')) {
    capturePng(serial, path.join(directory, 'observed.png'));
    console.log('已保存 observed.png。请关闭识别气泡，保持同页和相同缩放。');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { await rl.question('准备好后按 Enter 截取干净输入：'); } finally { rl.close(); }
  }
  const dimensions = capturePng(serial, path.join(directory, 'input.png'));
  meta.imageWidth = dimensions.width;
  meta.imageHeight = dimensions.height;
  try { meta.gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { meta.gitCommit = null; }
  writeJson(path.join(directory, 'meta.json'), meta);
  writeJson(path.join(directory, 'expected.json'), { imageWidth: dimensions.width, imageHeight: dimensions.height, partial: false, allowEmpty: false, bubbles: [], ignoreRegions: [] });
  updateManifest(id, 'draft');
  console.log(`已创建 ${id}：${directory}`);
  console.log(`下一步：node scripts/ocr-case.cjs annotate ${id}`);
}

function updateManifest(id, status) {
  const data = manifest();
  const existing = data.cases.find((item) => item.id === id);
  if (existing) existing.status = status;
  else data.cases.push({ id, status });
  data.updatedAt = new Date().toISOString();
  writeJson(manifestPath, data);
}

function validateExpected(expected) {
  if (!Number.isFinite(expected.imageWidth) || !Number.isFinite(expected.imageHeight)) throw new Error('expected.json 缺少图片尺寸');
  if (!Array.isArray(expected.bubbles) || !Array.isArray(expected.ignoreRegions || [])) throw new Error('bubbles/ignoreRegions 必须为数组');
  if (!expected.bubbles.length && !expected.allowEmpty) throw new Error('没有标注；若确认是空页，请设置 allowEmpty: true');
  const boxes = [...expected.bubbles.map((item) => item.box), ...(expected.ignoreRegions || [])];
  for (const box of boxes) {
    if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box.some((value) => value < 0 || value > 1) || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1.000001 || box[1] + box[3] > 1.000001) throw new Error(`无效归一化坐标：${JSON.stringify(box)}`);
  }
  for (const bubble of expected.bubbles) if (!bubble.ignore && typeof bubble.text !== 'string') throw new Error(`气泡 ${bubble.id || '?'} 缺少 text`);
}

function approve(id) {
  const directory = caseDirectory(id);
  const expectedPath = path.join(directory, 'expected.json');
  const metaPath = path.join(directory, 'meta.json');
  if (!fs.existsSync(path.join(directory, 'input.png')) || !fs.existsSync(expectedPath) || !fs.existsSync(metaPath)) throw new Error('用例缺少 input.png、expected.json 或 meta.json');
  const expected = json(expectedPath);
  validateExpected(expected);
  const meta = json(metaPath);
  meta.status = 'approved';
  meta.annotationStatus = 'reviewed';
  meta.approvedAt = new Date().toISOString();
  writeJson(metaPath, meta);
  updateManifest(id, 'approved');
  console.log(`${id} 已批准并加入回归集。`);
}

function annotationHtml(id, imageData, expected) {
  const embedded = JSON.stringify(expected).replace(/</g, '\\u003c');
  return `<!doctype html><html><meta charset="utf-8"><title>标注 ${id}</title><style>body{font:14px system-ui;margin:0;background:#111;color:#eee;display:grid;grid-template-columns:1fr 320px;height:100vh}.stage{overflow:auto;padding:20px}.canvas{position:relative;display:inline-block}.canvas img{display:block;max-width:calc(100vw - 380px);user-select:none}.box{position:absolute;border:2px solid #22c55e;box-sizing:border-box;cursor:move}.box.selected{border-color:#f59e0b}.handle{position:absolute;width:12px;height:12px;right:-7px;bottom:-7px;background:#fff;border:1px solid #000;cursor:nwse-resize}.side{padding:18px;background:#222;overflow:auto}label{display:block;margin:12px 0}input,select,textarea,button{width:100%;box-sizing:border-box;margin-top:4px;padding:8px}button{margin:5px 0}.hint{color:#aaa}</style><body><main class="stage"><div class="canvas" id="canvas"><img id="img" src="data:image/png;base64,${imageData}"></div></main><aside class="side"><h2>${id}</h2><p class="hint">在图片空白处拖动新增框；框可拖动，右下角可缩放。</p><label>文字<textarea id="text"></textarea></label><label>方向<select id="direction"><option value="auto">auto</option><option value="vertical">vertical</option><option value="horizontal">horizontal</option></select></label><label>类型<select id="type"><option>bubble</option><option>free_text</option><option>title</option><option>sfx</option></select></label><label><input id="ignore" type="checkbox" style="width:auto"> 忽略该框</label><button id="remove">删除选中框</button><button id="save">下载 expected.json</button><p class="hint">下载后请用它覆盖 tests/ocr-regression/cases/${id}/expected.json，再执行 approve。</p></aside><script>const data=${embedded};const canvas=document.querySelector('#canvas'),img=document.querySelector('#img');let selected=null,drag=null;const fields={text:document.querySelector('#text'),direction:document.querySelector('#direction'),type:document.querySelector('#type'),ignore:document.querySelector('#ignore')};function point(e){const r=img.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}}function clamp(v){return Math.max(0,Math.min(1,v))}function render(){canvas.querySelectorAll('.box').forEach(n=>n.remove());data.bubbles.forEach((b,i)=>{const n=document.createElement('div');n.className='box'+(i===selected?' selected':'');Object.assign(n.style,{left:b.box[0]*100+'%',top:b.box[1]*100+'%',width:b.box[2]*100+'%',height:b.box[3]*100+'%'});n.onpointerdown=e=>{e.stopPropagation();selected=i;const p=point(e);drag={mode:'move',p,box:[...b.box]};render();sync()};const h=document.createElement('i');h.className='handle';h.onpointerdown=e=>{e.stopPropagation();selected=i;drag={mode:'resize',p:point(e),box:[...b.box]}};n.append(h);canvas.append(n)})}function sync(){const b=data.bubbles[selected];fields.text.value=b?.text||'';fields.direction.value=b?.direction||'auto';fields.type.value=b?.textType||'bubble';fields.ignore.checked=!!b?.ignore}canvas.onpointerdown=e=>{if(e.target!==img)return;const p=point(e);selected=data.bubbles.push({id:'b'+(data.bubbles.length+1),box:[p.x,p.y,.01,.01],text:'',direction:'auto',textType:'bubble',ignore:false})-1;drag={mode:'new',p,box:[p.x,p.y,.01,.01]};render();sync()};window.onpointermove=e=>{if(!drag||selected===null)return;const p=point(e),b=data.bubbles[selected],dx=p.x-drag.p.x,dy=p.y-drag.p.y;if(drag.mode==='move'){b.box=[clamp(drag.box[0]+dx),clamp(drag.box[1]+dy),drag.box[2],drag.box[3]];b.box[0]=Math.min(b.box[0],1-b.box[2]);b.box[1]=Math.min(b.box[1],1-b.box[3])}else{b.box[2]=Math.max(.005,Math.min(1-b.box[0],p.x-b.box[0]));b.box[3]=Math.max(.005,Math.min(1-b.box[1],p.y-b.box[1]))}render()};window.onpointerup=()=>drag=null;Object.entries(fields).forEach(([key,n])=>n.oninput=()=>{if(selected===null)return;const b=data.bubbles[selected];if(key==='type')b.textType=n.value;else b[key]=key==='ignore'?n.checked:n.value});document.querySelector('#remove').onclick=()=>{if(selected===null)return;data.bubbles.splice(selected,1);selected=null;render();sync()};document.querySelector('#save').onclick=()=>{const blob=new Blob([JSON.stringify(data,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='expected.json';a.click();URL.revokeObjectURL(a.href)};img.onload=render;</script></body></html>`;
}

function annotate(id) {
  const directory = caseDirectory(id);
  const input = path.join(directory, 'input.png');
  const expected = path.join(directory, 'expected.json');
  if (!fs.existsSync(input) || !fs.existsSync(expected)) throw new Error('用例不存在或文件不完整');
  const target = path.join(directory, 'annotate.html');
  fs.writeFileSync(target, annotationHtml(id, fs.readFileSync(input).toString('base64'), json(expected)));
  console.log(`标注页面：${target}`);
  if (!has('--no-open')) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
    spawnSync(opener[0], opener[1], { stdio: 'ignore', windowsHide: true });
  }
}

function loadApproved() {
  const data = manifest();
  return data.cases.filter((item) => item.status === 'approved').map((entry) => {
    const directory = caseDirectory(entry.id);
    const expected = json(path.join(directory, 'expected.json'));
    validateExpected(expected);
    return { id: entry.id, imageName: `${entry.id}.png`, expected, directory };
  });
}

function evaluateOutput(outputFile, reportDirectory = option('--report-dir', path.join(suiteRoot, 'reports', new Date().toISOString().replace(/[:.]/g, '-')))) {
  const output = json(outputFile);
  if (output.error || !Array.isArray(output.images)) throw new Error(output.error || 'out.json 缺少 images');
  const cases = loadApproved();
  if (!cases.length) throw new Error('没有 approved 用例');
  const results = cases.map((testCase) => evaluator.evaluateCase(testCase, output.images.find((item) => item.name === testCase.imageName)));
  const report = { generatedAt: new Date().toISOString(), source: path.resolve(outputFile), summary: evaluator.aggregate(results), results };
  fs.mkdirSync(reportDirectory, { recursive: true });
  writeJson(path.join(reportDirectory, 'report.json'), report);
  fs.writeFileSync(path.join(reportDirectory, 'report.html'), evaluator.reportHtml(report, casesRoot));
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}: ${result.metrics.matched}/${result.metrics.expected} matched, CER=${result.metrics.meanCer?.toFixed(3) ?? 'N/A'}, false+=${result.falsePositives.length}`);
  console.log(`${report.summary.passedPages}/${report.summary.pages} pages passed；报告：${reportDirectory}`);
  if (results.some((item) => !item.passed)) process.exitCode = 1;
}

function runDevice() {
  const serial = chooseDevice();
  const cases = loadApproved();
  const internal = 'files/eval/regression';
  adbRun(['-s', serial, 'shell', 'run-as', appId, 'rm', '-rf', internal]);
  adbRun(['-s', serial, 'shell', 'run-as', appId, 'mkdir', '-p', internal]);
  for (const testCase of cases) {
    const staging = `/data/local/tmp/zlib-ocr-${process.pid}-${testCase.imageName}`;
    adbRun(['-s', serial, 'push', path.join(testCase.directory, 'input.png'), staging]);
    adbRun(['-s', serial, 'shell', 'chmod', '644', staging]);
    adbRun(['-s', serial, 'shell', 'run-as', appId, 'cp', staging, `${internal}/${testCase.imageName}`]);
    adbRun(['-s', serial, 'shell', 'rm', staging]);
  }
  adbRun(['-s', serial, 'shell', 'run-as', appId, 'rm', '-f', 'files/eval/out.json']);
  const internalAbsolute = `/data/user/0/${appId}/${internal}`;
  adbRun(['-s', serial, 'shell', 'am', 'broadcast', '-a', 'expo.modules.screentranslator.DEBUG_OCR_EVAL', '-n', `${appId}/expo.modules.screentranslator.DebugOcrEvalReceiver`, '--es', 'indir', internalAbsolute, '--ez', 'pipeline', 'true']);
  const deadline = Date.now() + Number(option('--timeout-ms', '300000'));
  let data = null;
  while (Date.now() < deadline) {
    try {
      const candidate = adbRun(['-s', serial, 'exec-out', 'run-as', appId, 'cat', 'files/eval/out.json'], true, 10000);
      JSON.parse(candidate.toString('utf8'));
      data = candidate;
      break;
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  if (!data) throw new Error('等待真机评测超时；请确认安装的是包含 DebugOcrEvalReceiver 的 debug build');
  const runDirectory = path.join(suiteRoot, 'runs');
  fs.mkdirSync(runDirectory, { recursive: true });
  const output = path.join(runDirectory, `out-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(output, data);
  evaluateOutput(output);
}

function help() {
  console.log(`OCR 气泡回归工具\n\n用法：\n  node scripts/ocr-case.cjs capture [--page N] [--note TEXT] [--device SERIAL] [--clean-only]\n  node scripts/ocr-case.cjs annotate CASE_ID [--no-open]\n  node scripts/ocr-case.cjs approve CASE_ID\n  node scripts/ocr-case.cjs run [--device SERIAL] [--timeout-ms 300000]\n  node scripts/ocr-case.cjs run --out PATH [--report-dir PATH]`);
}

async function main() {
  if (!command || has('--help') || command === 'help') return help();
  if (command === 'capture') return capture();
  if (command === 'annotate') return annotate(args[1]);
  if (command === 'approve') return approve(args[1]);
  if (command === 'run') return option('--out') ? evaluateOutput(option('--out')) : runDevice();
  throw new Error(`未知命令：${command}`);
}
main().catch((error) => { console.error(`失败：${error.message}`); process.exitCode = 1; });
