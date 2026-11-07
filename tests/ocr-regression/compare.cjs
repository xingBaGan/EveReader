const path = require('node:path');
const { spawnSync } = require('node:child_process');

const output = process.argv[2];
if (!output) {
  console.error('Usage: node tests/ocr-regression/compare.cjs <out.json>');
  process.exit(2);
}
const cli = path.resolve(__dirname, '../../scripts/ocr-case.cjs');
const result = spawnSync(process.execPath, [cli, 'run', '--out', path.resolve(output)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
