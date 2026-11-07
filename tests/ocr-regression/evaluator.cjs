const fs = require('node:fs');
const path = require('node:path');

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/\s/gu, '')
    .replace(/[♥❤♡]/gu, '♡')
    .replace(/(?:[.…⋮︙・·。]{2,}|[…⋮︙])/gu, '…');
}

function editDistance(a, b) {
  const left = [...normalizeText(a)];
  const right = [...normalizeText(b)];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function cer(expected, actual) {
  const length = [...normalizeText(expected)].length;
  return length === 0 ? (normalizeText(actual) ? 1 : 0) : editDistance(expected, actual) / length;
}

function iou(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]))
    * Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const union = a[2] * a[3] + b[2] * b[3] - intersection;
  return union > 0 ? intersection / union : 0;
}

function centerIn(box, region) {
  const x = box[0] + box[2] / 2;
  const y = box[1] + box[3] / 2;
  return x >= region[0] && x <= region[0] + region[2]
    && y >= region[1] && y <= region[1] + region[3];
}

function matchOneToOne(expected, actual, threshold = 0.5) {
  const pairs = [];
  for (let ei = 0; ei < expected.length; ei += 1) {
    for (let ai = 0; ai < actual.length; ai += 1) {
      const overlap = iou(expected[ei].box, actual[ai].box);
      if (overlap >= threshold) pairs.push({ ei, ai, iou: overlap });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);
  const usedExpected = new Set();
  const usedActual = new Set();
  return pairs.filter((pair) => {
    if (usedExpected.has(pair.ei) || usedActual.has(pair.ai)) return false;
    usedExpected.add(pair.ei);
    usedActual.add(pair.ai);
    return true;
  });
}

function actualBox(bubble, width, height) {
  return [bubble.x / width, bubble.y / height, bubble.w / width, bubble.h / height];
}

function evaluateCase(testCase, imageResult, options = {}) {
  const threshold = options.iouThreshold ?? 0.5;
  const expected = (testCase.expected.bubbles || []).filter((item) => !item.ignore);
  const ignored = (testCase.expected.bubbles || []).filter((item) => item.ignore);
  const run = imageResult?.runs?.find((item) => item.name === 'pipeline');
  const width = imageResult?.w || testCase.expected.imageWidth;
  const height = imageResult?.h || testCase.expected.imageHeight;
  const rawActual = (run?.bubbles || []).map((item, index) => ({
    ...item,
    id: `prediction-${index + 1}`,
    box: actualBox(item, width, height),
  }));
  const actual = rawActual.filter((item) => !ignored.some((entry) => centerIn(item.box, entry.box))
    && !(testCase.expected.ignoreRegions || []).some((region) => centerIn(item.box, region)));
  const matches = matchOneToOne(expected, actual, threshold);
  const matchedExpected = new Set(matches.map((item) => item.ei));
  const matchedActual = new Set(matches.map((item) => item.ai));
  const details = matches.map((match) => {
    const wanted = expected[match.ei];
    const found = actual[match.ai];
    const textCer = cer(wanted.text, found.text);
    const exact = normalizeText(wanted.text) === normalizeText(found.text);
    return {
      expectedId: wanted.id,
      expected: wanted,
      actual: found,
      iou: match.iou,
      cer: textCer,
      exact,
      directionCorrect: wanted.direction && found.direction ? wanted.direction === found.direction : null,
      typeCorrect: wanted.textType && found.type ? wanted.textType === found.type : null,
      status: exact ? 'pass' : 'text-mismatch',
    };
  });
  const missed = expected.filter((_, index) => !matchedExpected.has(index));
  const falsePositives = testCase.expected.partial
    ? []
    : actual.filter((_, index) => !matchedActual.has(index));
  const matchedCount = matches.length;
  const precisionDenominator = matchedCount + falsePositives.length;
  const precision = precisionDenominator ? matchedCount / precisionDenominator : (expected.length ? 0 : 1);
  const recall = expected.length ? matchedCount / expected.length : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const shortTextFailures = details.filter((item) => [...normalizeText(item.expected.text)].length <= 4 && !item.exact);
  const passed = missed.length === 0 && falsePositives.length === 0
    && details.every((item) => item.cer <= 0.1) && shortTextFailures.length === 0;
  return {
    id: testCase.id,
    image: testCase.imageName,
    partial: Boolean(testCase.expected.partial),
    passed,
    metrics: {
      expected: expected.length,
      predicted: actual.length,
      matched: matchedCount,
      precision,
      recall,
      f1,
      meanIou: mean(details.map((item) => item.iou)),
      meanCer: mean(details.map((item) => item.cer)),
      exactMatchRate: mean(details.map((item) => item.exact ? 1 : 0)),
      directionAccuracy: mean(details.filter((item) => item.directionCorrect !== null).map((item) => item.directionCorrect ? 1 : 0)),
      typeAccuracy: mean(details.filter((item) => item.typeCorrect !== null).map((item) => item.typeCorrect ? 1 : 0)),
      readingOrderAccuracy: null,
      runtimeMs: run?.ms ?? null,
    },
    matches: details,
    missed,
    falsePositives,
    error: run ? null : 'pipeline result missing',
  };
}

function aggregate(results) {
  const totals = results.reduce((acc, result) => {
    acc.expected += result.metrics.expected;
    acc.predicted += result.partial ? result.metrics.matched : result.metrics.predicted;
    acc.matched += result.metrics.matched;
    acc.runtimeMs += result.metrics.runtimeMs || 0;
    return acc;
  }, { expected: 0, predicted: 0, matched: 0, runtimeMs: 0 });
  const precision = totals.predicted ? totals.matched / totals.predicted : (totals.expected ? 0 : 1);
  const recall = totals.expected ? totals.matched / totals.expected : 1;
  return {
    pages: results.length,
    passedPages: results.filter((item) => item.passed).length,
    ...totals,
    precision,
    recall,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    meanIou: averageMetric(results, 'meanIou'),
    meanCer: averageMetric(results, 'meanCer'),
    exactMatchRate: averageMetric(results, 'exactMatchRate'),
  };
}

function averageMetric(results, name) {
  const values = results.map((item) => item.metrics[name]).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function reportHtml(report, caseRoot) {
  const pages = report.results.map((result) => {
    const input = path.join(caseRoot, result.id, 'input.png');
    const image = fs.existsSync(input) ? `data:image/png;base64,${fs.readFileSync(input).toString('base64')}` : '';
    const boxes = [
      ...result.matches.map((item) => ({ box: item.expected.box, cls: item.exact ? 'ok' : 'warn', label: `${item.expected.text} → ${item.actual.text} / IoU ${item.iou.toFixed(2)} / CER ${item.cer.toFixed(2)}` })),
      ...result.missed.map((item) => ({ box: item.box, cls: 'miss', label: `漏检: ${item.text}` })),
      ...result.falsePositives.map((item) => ({ box: item.box, cls: 'fp', label: `误检: ${item.text}` })),
    ].map((item) => `<div class="box ${item.cls}" style="left:${item.box[0] * 100}%;top:${item.box[1] * 100}%;width:${item.box[2] * 100}%;height:${item.box[3] * 100}%"><span>${escapeHtml(item.label)}</span></div>`).join('');
    return `<section><h2>${escapeHtml(result.id)} — ${result.passed ? 'PASS' : 'FAIL'}${result.partial ? '（部分标注）' : ''}</h2><p>Precision ${pct(result.metrics.precision)} · Recall ${pct(result.metrics.recall)} · F1 ${pct(result.metrics.f1)} · IoU ${num(result.metrics.meanIou)} · CER ${num(result.metrics.meanCer)} · direction ${nullablePct(result.metrics.directionAccuracy)} · type ${nullablePct(result.metrics.typeAccuracy)} · reading order N/A · ${result.metrics.runtimeMs ?? 'N/A'} ms</p><div class="canvas"><img src="${image}" alt="${escapeHtml(result.id)}">${boxes}</div></section>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>OCR regression report</title><style>body{font-family:system-ui;margin:24px;background:#111;color:#eee}section{margin:32px 0}.canvas{position:relative;display:inline-block;max-width:900px}.canvas img{display:block;max-width:100%;height:auto}.box{position:absolute;border:3px solid;box-sizing:border-box}.box span{position:absolute;left:0;top:100%;z-index:2;background:#111;color:#fff;font-size:12px;white-space:nowrap;padding:2px}.ok{border-color:#22c55e}.miss{border-color:#ef4444}.fp{border-color:#a855f7}.warn{border-color:#f59e0b}</style><h1>OCR 回归报告</h1><p>${report.summary.passedPages}/${report.summary.pages} pages passed · Precision ${pct(report.summary.precision)} · Recall ${pct(report.summary.recall)} · F1 ${pct(report.summary.f1)} · CER ${num(report.summary.meanCer)}</p>${pages}`;
}

const pct = (value) => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
const nullablePct = pct;
const num = (value) => value === null ? 'N/A' : value.toFixed(3);

module.exports = { normalizeText, editDistance, cer, iou, matchOneToOne, evaluateCase, aggregate, reportHtml };
