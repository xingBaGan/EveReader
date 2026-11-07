const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { iou, cer, normalizeText, matchOneToOne, evaluateCase } = require('./evaluator.cjs');

function fixture(expected, bubbles, extra = {}) {
  return evaluateCase({ id: 'fixture', imageName: 'fixture.png', expected: { imageWidth: 100, imageHeight: 100, partial: false, ignoreRegions: [], bubbles: expected, ...extra } }, { name: 'fixture.png', w: 100, h: 100, runs: [{ name: 'pipeline', ms: 12, bubbles }] });
}

test('IoU and one-to-one matching do not reuse a prediction', () => {
  assert.equal(iou([0, 0, 1, 1], [0, 0, 1, 1]), 1);
  const matches = matchOneToOne([{ box: [0, 0, 1, 1] }, { box: [0, 0, 1, 1] }], [{ box: [0, 0, 1, 1] }]);
  assert.equal(matches.length, 1);
});

test('Unicode normalization and CER handle manga punctuation', () => {
  assert.equal(normalizeText('Ａ … ♥'), normalizeText('A……♡'));
  assert.equal(cer('嫌だ', '嫌た'), 0.5);
});

test('duplicate prediction is a false positive on a complete page', () => {
  const expected = [{ id: 'b1', box: [0.1, 0.1, 0.2, 0.2], text: 'はい' }];
  const actual = [{ x: 10, y: 10, w: 20, h: 20, text: 'はい' }, { x: 11, y: 11, w: 20, h: 20, text: 'はい' }];
  const result = fixture(expected, actual);
  assert.equal(result.matches.length, 1);
  assert.equal(result.falsePositives.length, 1);
  assert.equal(result.passed, false);
});

test('partial pages do not count unannotated predictions as false positives', () => {
  const result = fixture([{ id: 'b1', box: [0.1, 0.1, 0.2, 0.2], text: 'はい' }], [
    { x: 10, y: 10, w: 20, h: 20, text: 'はい' }, { x: 70, y: 70, w: 20, h: 20, text: 'extra' },
  ], { partial: true });
  assert.equal(result.falsePositives.length, 0);
  assert.equal(result.passed, true);
});

test('ignore regions suppress predictions and approved empty pages can pass', () => {
  const result = fixture([], [{ x: 10, y: 10, w: 10, h: 10, text: 'ui' }], { allowEmpty: true, ignoreRegions: [[0, 0, 0.3, 0.3]] });
  assert.equal(result.falsePositives.length, 0);
  assert.equal(result.passed, true);
});

test('short text requires exact match even near CER threshold', () => {
  const result = fixture([{ id: 'b1', box: [0, 0, 1, 1], text: 'ん!?' }], [{ x: 0, y: 0, w: 100, h: 100, text: 'ん?' }]);
  assert.equal(result.passed, false);
});

test('CLI uses success for help and failure for a regressing output', () => {
  const cli = path.resolve(__dirname, '../../scripts/ocr-case.cjs');
  assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-regression-'));
  const output = path.join(temp, 'out.json');
  fs.writeFileSync(output, JSON.stringify({ images: [
    { name: 'page19.png', w: 1035, h: 1460, runs: [{ name: 'pipeline', bubbles: [] }] },
    { name: 'page20.png', w: 1035, h: 1460, runs: [{ name: 'pipeline', bubbles: [] }] },
    { name: 'page21.png', w: 1035, h: 1460, runs: [{ name: 'pipeline', bubbles: [] }] },
  ] }));
  const result = spawnSync(process.execPath, [cli, 'run', '--out', output, '--report-dir', path.join(temp, 'report')]);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(temp, 'report', 'report.html')), true);
});
