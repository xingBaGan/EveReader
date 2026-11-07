// Unit tests for manga bubble text recognition and reading order rules
// Verifies all core requirements:
// 1. Legal "あああ" and onomatopoeia/reduplication are NOT truncated
// 2. Degenerative runaway repetition loops (e.g. 10+ chars, endless hyphens) ARE suppressed
// 3. Adjacent distinct text lines are NOT merged even if bounding boxes overlap
// 4. Same-sentence multi-channel scans are cleanly merged into one preferred line
// 5. RTL Japanese manga reading order (Right-to-Left, Top-to-Bottom)
// 6. Regression fix: Conflicting noisy candidates (e.g. "は1い今ははーい出1まい" vs "今出ますー") are arbitrated by quality, NOT stitched
// 7. Regression fix: Suffix fragment pollution (e.g. "あれ..." and "れ") is absorbed, preventing "あれ...れ"
// 8. Regression fix: Prefix fragment pollution (e.g. "今 幸せですか?." and "今") is absorbed, preventing "今 幸せですか?.今"
// 9. Legitimate complementary sequential lines ARE merged when strictly proven complementary

const assert = require('assert');

function evaluateCandidateQuality(text, confidenceWeight = 1.0, rawConfidence = null) {
  const clean = text.replace(/\s+/g, '');
  if (!clean) return 0;

  let kanaCount = 0;
  let kanjiCount = 0;
  let noiseCount = 0;
  let punctCount = 0;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const ch = clean[i];
    if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FA && ch !== 'ー')) {
      kanaCount++;
    } else if (code >= 0x4E00 && code <= 0x9FFF) {
      kanjiCount++;
    } else if ((code >= 48 && code <= 57) || ['|', 'l', '1', 'I', '/', '\\', '^', '`', ';'].includes(ch)) {
      noiseCount++;
    } else if (['ー', '―', '—', '…', '・', '！', '!', '？', '?', '。', '、', '〜', '~', '♡', '♥', '.', '．'].includes(ch)) {
      punctCount++;
    }
  }

  const totalLen = clean.length;
  const cjkCount = kanaCount + kanjiCount;
  if (cjkCount === 0 && noiseCount > 0) return 0;

  // 1. 脚本纯度：奖励有效字符，严厉扣减数字/ASCII噪点
  const scriptPurity = (cjkCount * 1.5 + punctCount * 0.8 - noiseCount * 3.0) / totalLen;

  // 2. 完整性加成：长度适中的完整语句显著优于碎断孤立单字
  const completenessBonus = Math.min(4.0, cjkCount * 0.8);

  // 3. 冗余词语/口吃重复惩罚（如 "は1い今ははーい" 中的重叠词）
  let redundancyPenalty = 0;
  if (clean.length >= 6) {
    for (let subLen = 2; subLen <= Math.min(5, Math.floor(clean.length / 2)); subLen++) {
      for (let i = 0; i <= clean.length - subLen * 2; i++) {
        const sub = clean.substring(i, i + subLen);
        if (clean.indexOf(sub, i + subLen) !== -1) {
          redundancyPenalty += 0.8;
          break;
        }
      }
    }
  }

  // 4. 单字符碎片惩罚：单字缺乏语义互信息，绝不能压制完整句子
  let score = scriptPurity * 2.0 + completenessBonus - redundancyPenalty;
  if (cjkCount <= 1) {
    score *= 0.5;
  }

  const baseConf = rawConfidence != null ? rawConfidence : (0.65 + Math.min(0.30, confidenceWeight / 8.0));
  return Math.max(0.01, score) * baseConf;
}

function compressExcessiveRepeatedCharacters(text) {
  if (!text) return text;
  let result = text;
  result = result.replace(/[-—―─━ー]{4,}/g, '――');
  result = result.replace(/[~〜]{4,}/g, '~~');
  result = result.replace(/={4,}/g, '==');
  result = result.replace(/_{4,}/g, '__');
  result = result.replace(/[!！]{4,}/g, '！！');
  result = result.replace(/[?？]{4,}/g, '？？');
  result = result.replace(/(?:\.{4,}|…{3,}|[·・]{4,})/g, '……');

  result = result.replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF])\1{5,}/g, '$1$1$1');

  result = removeDuplicatePhrases(result);
  result = cleanTrailingDuplicateFragments(result);
  return result;
}

function cleanTrailingDuplicateFragments(text) {
  if (text.length <= 3) return text;
  let res = text;
  const match = res.match(/([\s\p{P}]+)([^\s\p{P}\d])$/u);
  if (match) {
    const trailingChar = match[2];
    const prefix = res.substring(0, match.index);
    if (prefix.includes(trailingChar)) {
      res = prefix + match[1].trimEnd();
    }
  }
  return res;
}

function removeDuplicatePhrases(text) {
  if (!text) return text;
  let result = text;
  result = result.replace(/([^\s\n]{3,15})\s*\1+/g, '$1');
  return result;
}

function hasExcessiveRepeats(text) {
  if (text.length <= 6) return false;
  const counts = {};
  for (const ch of text) {
    counts[ch] = (counts[ch] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(counts));
  return (maxCount / text.length) >= 0.60;
}

function computeNormalizedSequenceSimilarity(s1, s2) {
  const c1 = s1.replace(/[\s\p{P}\d]+/gu, '');
  const c2 = s2.replace(/[\s\p{P}\d]+/gu, '');
  if (!c1 && !c2) return s1 === s2 ? 1.0 : 0.0;
  if (!c1 || !c2) return 0.0;
  if (c1 === c2) return 1.0;

  if (c1.includes(c2) || c2.includes(c1)) {
    const ratio = Math.min(c1.length, c2.length) / Math.max(c1.length, c2.length);
    if (ratio >= 0.70) return ratio;
  }

  const len1 = c1.length;
  const len2 = c2.length;
  const maxLen = Math.max(len1, len2);
  if (maxLen === 0) return 1.0;

  const dp = Array.from({ length: len2 + 1 }, (_, i) => i);
  for (let i = 1; i <= len1; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= len2; j++) {
      const temp = dp[j];
      const cost = c1[i - 1] === c2[j - 1] ? 0 : 1;
      dp[j] = Math.min(Math.min(dp[j] + 1, dp[j - 1] + 1), prev + cost);
      prev = temp;
    }
  }
  const dist = dp[len2];
  return Math.max(0.0, 1.0 - dist / maxLen);
}

function computeIntersection(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

function computeIoU(a, b) {
  const inter = computeIntersection(a, b);
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function areCandidatesConflicting(a, b, isVertical) {
  const cleanA = a.text.replace(/[\s\p{P}\d]+/gu, '');
  const cleanB = b.text.replace(/[\s\p{P}\d]+/gu, '');

  const iou = computeIoU(a.rect, b.rect);
  const inter = computeIntersection(a.rect, b.rect);
  const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
  const overlapRatio = minArea > 0 ? inter / minArea : 0;

  // 1. 碎片包含关系
  if (cleanA && cleanB) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
      if (iou > 0.05 || overlapRatio > 0.15) return true;
      if (isVertical) {
        const xDist = Math.abs((a.rect.x + a.rect.width / 2) - (b.rect.x + b.rect.width / 2));
        const maxW = Math.max(a.rect.width, b.rect.width);
        if (xDist <= maxW * 0.65) return true;
      } else {
        const yDist = Math.abs((a.rect.y + a.rect.height / 2) - (b.rect.y + b.rect.height / 2));
        const maxH = Math.max(a.rect.height, b.rect.height);
        if (yDist <= maxH * 0.65) return true;
      }
    }

    const seqSim = computeNormalizedSequenceSimilarity(a.text, b.text);
    if (seqSim >= 0.50) return true;
  }

  // 2. 空间与文本双重冲突判定：
  // 文字完全不同且无包含时，必须物理重叠极端一致 (IoU >= 0.55 或 overlapRatio >= 0.75) 才判定冲突
  const hasTextMatch = cleanA && cleanB && (cleanA.includes(cleanB) || cleanB.includes(cleanA) || computeNormalizedSequenceSimilarity(a.text, b.text) >= 0.50);

  if (hasTextMatch) {
    if (iou >= 0.15 || overlapRatio >= 0.30) return true;
    if (isVertical) {
      const xDist = Math.abs((a.rect.x + a.rect.width / 2) - (b.rect.x + b.rect.width / 2));
      const maxW = Math.max(a.rect.width, b.rect.width);
      if (xDist <= maxW * 0.45) {
        const yOverlap = Math.max(0, Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y));
        const minH = Math.min(a.rect.height, b.rect.height);
        if (minH > 0 && (yOverlap / minH) >= 0.20) return true;
      }
    } else {
      const yDist = Math.abs((a.rect.y + a.rect.height / 2) - (b.rect.y + b.rect.height / 2));
      const maxH = Math.max(a.rect.height, b.rect.height);
      if (yDist <= maxH * 0.45) {
        const xOverlap = Math.max(0, Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x));
        const minW = Math.min(a.rect.width, b.rect.width);
        if (minW > 0 && (xOverlap / minW) >= 0.20) return true;
      }
    }
  } else {
    if (iou >= 0.55 || overlapRatio >= 0.75) return true;
  }

  return false;
}

function areStrictlyComplementary(first, second, isVertical) {
  if (areCandidatesConflicting(first, second, isVertical)) return false;

  const clean1 = first.text.replace(/[\s\p{P}]+/gu, '');
  const clean2 = second.text.replace(/[\s\p{P}]+/gu, '');
  if (!clean1 || !clean2) return false;

  if (computeNormalizedSequenceSimilarity(first.text, second.text) >= 0.30) return false;

  const charSizeA = first.charSize || (isVertical ? first.rect.width : first.rect.height);
  const charSizeB = second.charSize || (isVertical ? second.rect.width : second.rect.height);
  const avgCharSize = (charSizeA + charSizeB) / 2.0;

  if (isVertical) {
    const topItem = first.rect.y <= second.rect.y ? first : second;
    const bottomItem = first.rect.y <= second.rect.y ? second : first;

    const xDist = Math.abs((topItem.rect.x + topItem.rect.width / 2) - (bottomItem.rect.x + bottomItem.rect.width / 2));
    const maxW = Math.max(topItem.rect.width, bottomItem.rect.width);
    if (xDist > maxW * 0.40) return false;

    const gap = bottomItem.rect.y - (topItem.rect.y + topItem.rect.height);
    return gap >= -avgCharSize * 0.20 && gap <= avgCharSize * 2.5;
  } else {
    const leftItem = first.rect.x <= second.rect.x ? first : second;
    const rightItem = first.rect.x <= second.rect.x ? second : first;

    const yDist = Math.abs((leftItem.rect.y + leftItem.rect.height / 2) - (rightItem.rect.y + rightItem.rect.height / 2));
    const maxH = Math.max(leftItem.rect.height, rightItem.rect.height);
    if (yDist > maxH * 0.40) return false;

    const gap = rightItem.rect.x - (leftItem.rect.x + leftItem.rect.width);
    return gap >= -avgCharSize * 0.20 && gap <= avgCharSize * 2.5;
  }
}

function consolidateGroupCandidates(items, isVertical) {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0].text.trim();

  const sorted = isVertical
    ? [...items].sort((a, b) => a.rect.y - b.rect.y)
    : [...items].sort((a, b) => {
        const yDiff = (a.rect.y + a.rect.height / 2) - (b.rect.y + b.rect.height / 2);
        const minH = Math.min(a.rect.height, b.rect.height);
        if (Math.abs(yDiff) > minH * 0.40) {
          return a.rect.y - b.rect.y;
        } else {
          return a.rect.x - b.rect.x;
        }
      });

  const segments = [];
  for (const item of sorted) {
    let matchedSeg = null;
    for (const seg of segments) {
      if (seg.some((existing) => areCandidatesConflicting(existing, item, isVertical))) {
        matchedSeg = seg;
        break;
      }
    }
    if (matchedSeg) {
      matchedSeg.push(item);
    } else {
      segments.push([item]);
    }
  }

  const resolvedSegments = segments.map((seg) => {
    if (seg.length === 1) return seg[0];
    return seg.reduce((best, cur) => {
      const cleanBest = best.text.replace(/[\s\p{P}\d]+/gu, '');
      const cleanCur = cur.text.replace(/[\s\p{P}\d]+/gu, '');
      const bestScore = evaluateCandidateQuality(best.text, best.confidenceWeight || 1.0, best.rawConfidence);
      const curScore = evaluateCandidateQuality(cur.text, cur.confidenceWeight || 1.0, cur.rawConfidence);

      // Sub-fragment absorption rule: longer parent candidate absorbs sub-fragment
      if (cleanBest.includes(cleanCur) && cleanCur.length < cleanBest.length && bestScore >= curScore * 0.7) {
        return best;
      }
      if (cleanCur.includes(cleanBest) && cleanBest.length < cleanCur.length && curScore >= bestScore * 0.7) {
        return cur;
      }

      return curScore > bestScore ? cur : best;
    });
  });

  const sortedSegments = isVertical
    ? resolvedSegments.sort((a, b) => a.rect.y - b.rect.y)
    : resolvedSegments.sort((a, b) => {
        const yDiff = (a.rect.y + a.rect.height / 2) - (b.rect.y + b.rect.height / 2);
        const minH = Math.min(a.rect.height, b.rect.height);
        if (Math.abs(yDiff) > minH * 0.40) {
          return a.rect.y - b.rect.y;
        } else {
          return a.rect.x - b.rect.x;
        }
      });

  const finalParts = [];
  for (let i = 0; i < sortedSegments.length; i++) {
    const cur = sortedSegments[i];
    if (finalParts.length === 0) {
      finalParts.push(cur.text.trim());
    } else {
      const prevItem = sortedSegments[i - 1];
      if (areStrictlyComplementary(prevItem, cur, isVertical)) {
        finalParts.push(cur.text.trim());
      } else {
        const cleanCur = cur.text.replace(/[\s\p{P}]+/gu, '');
        const alreadyCovered = finalParts.some((p) => {
          const cleanP = p.replace(/[\s\p{P}]+/gu, '');
          return cleanP.includes(cleanCur) || computeNormalizedSequenceSimilarity(p, cur.text) >= 0.60;
        });
        if (!alreadyCovered) {
          finalParts.push(cur.text.trim());
        }
      }
    }
  }

  return isVertical ? finalParts.join('') : finalParts.join(' ');
}

/**
 * 镜像生产 MangaOcrProcessor.kt 的多通道共识裁决器
 */
function arbitrateMultiChannelCandidates(candidates, isWideHorizontal) {
  if (!candidates || candidates.length === 0) return '';
  if (candidates.length === 1) return candidates[0].text.trim();

  const baseScores = candidates.map((c) =>
    evaluateCandidateQuality(c.text, c.weight || 1.0, c.confidence)
  );

  const compositeScores = candidates.map((cand, i) => {
    let score = baseScores[i];
    let maxConsensus = 0;
    let consensusPartnerIdx = -1;

    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const sim = computeNormalizedSequenceSimilarity(cand.text, candidates[j].text);
      if (sim > maxConsensus) {
        maxConsensus = sim;
        consensusPartnerIdx = j;
      }
    }

    const hasConsensus = maxConsensus >= 0.45;

    if (hasConsensus) {
      score *= (1.0 + 0.35 * maxConsensus);

      if (consensusPartnerIdx >= 0) {
        const partner = candidates[consensusPartnerIdx];
        const cleanThis = cand.text.replace(/[\s\p{P}\d]+/gu, '');
        const cleanPartner = partner.text.replace(/[\s\p{P}\d]+/gu, '');
        const prefixLen = Math.min(8, cleanPartner.length);
        if (cleanThis.length > cleanPartner.length && prefixLen > 0 && cleanThis.startsWith(cleanPartner.substring(0, prefixLen))) {
          score *= 1.25;
        }
      }
    } else {
      if (isWideHorizontal && cand.source === 'manga_ocr') {
        const hasViableBase = candidates.some((c, k) => k !== i && c.text.replace(/\s+/g, '').length >= 6);
        if (hasViableBase) {
          score *= 0.30;
        }
      }
    }

    return score;
  });

  let bestIdx = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (compositeScores[i] > compositeScores[bestIdx]) {
      bestIdx = i;
    }
  }

  return candidates[bestIdx].text.trim();
}

// 2. Logic from mangaDetector.ts: sortNormalizedReadingOrder
function sortNormalizedReadingOrder(bubbles, preferredMode = 'auto') {
  if (bubbles.length <= 1) {
    return bubbles.map((b, i) => ({ ...b, readingOrderIndex: i + 1 }));
  }

  let isVerticalMode = true;
  if (preferredMode === 'horizontal') {
    isVerticalMode = false;
  } else if (preferredMode === 'vertical') {
    isVerticalMode = true;
  } else {
    const verticalCount = bubbles.filter((b) => b.direction === 'vertical').length;
    isVerticalMode = verticalCount >= bubbles.length / 2;
  }

  if (isVerticalMode) {
    return [...bubbles]
      .sort((a, b) => {
        const aCenterX = a.box.x + a.box.width / 2;
        const bCenterX = b.box.x + b.box.width / 2;
        const xDiff = bCenterX - aCenterX;
        if (Math.abs(xDiff) < 8.0) {
          return a.box.y - b.box.y;
        }
        return xDiff;
      })
      .map((bubble, index) => ({
        ...bubble,
        readingOrderIndex: index + 1,
      }));
  }

  return [...bubbles]
    .sort((a, b) => {
      const aCenterY = a.box.y + a.box.height / 2;
      const bCenterY = b.box.y + b.box.height / 2;
      const yDiff = aCenterY - bCenterY;
      if (Math.abs(yDiff) < 6.0) {
        return a.box.x - b.box.x;
      }
      return yDiff;
    })
    .map((bubble, index) => ({
      ...bubble,
      readingOrderIndex: index + 1,
    }));
}

// 3. Logic for Detection Request Coordinator (mirroring ReaderModal.tsx & build-pdf-html.js state machine)
class DetectionCoordinator {
  constructor() {
    this.nextReqId = 1;
    this.activeRequestId = 0;
    this.inFlight = false;
    this.currentPage = 1;
    this.appliedResults = [];
    this.droppedCount = 0;

    // WebView side state machine
    this.webViewLock = false;
    this.webViewActiveReqId = 0;
    this.currentOverlayBubbles = null;
  }

  // WebView initiates snapshot
  webViewRequestDetection(reqId) {
    if (this.webViewLock) {
      this.droppedCount++;
      return false; // SNAPSHOT_SKIPPED
    }
    this.webViewLock = true;
    this.webViewActiveReqId = reqId;
    return true;
  }

  // WebView receives terminal ACK
  webViewReceiveAck(action, data) {
    // Only matching activeDetectionReqId can unlock
    if (data.requestId && this.webViewActiveReqId && data.requestId !== this.webViewActiveReqId) {
      return false; // Stale ACK ignored
    }
    if (action === 'setDetectedBubbles' || action === 'detectionCompleted') {
      this.webViewLock = false;
      this.currentOverlayBubbles = data.bubbles || [];
      return true;
    } else if (action === 'detectionFailed') {
      this.webViewLock = false;
      return true;
    }
    return false;
  }

  triggerDetection(page) {
    this.currentPage = page;
    const reqId = ++this.nextReqId;
    return reqId;
  }

  onRequestReceived(reqId, page) {
    if (this.inFlight && reqId <= this.activeRequestId) {
      this.droppedCount++;
      return false; // Dropped duplicate in-flight
    }
    this.activeRequestId = reqId;
    this.inFlight = true;
    return true;
  }

  onResultResolved(reqId, page, bubbles, isError = false) {
    let ackAction = '';
    let ackData = {};

    if (this.activeRequestId !== reqId || page !== this.currentPage) {
      this.droppedCount++;
      ackAction = 'detectionFailed';
      ackData = { reason: 'stale', requestId: reqId };
    } else if (isError) {
      ackAction = 'detectionFailed';
      ackData = { reason: 'error', requestId: reqId };
    } else if (bubbles && bubbles.length > 0) {
      ackAction = 'setDetectedBubbles';
      ackData = { bubbles, active: true, requestId: reqId };
      this.appliedResults.push({ reqId, page, bubbles });
    } else {
      ackAction = 'detectionCompleted';
      ackData = { bubbles: [], active: true, requestId: reqId };
      this.appliedResults.push({ reqId, page, bubbles: [] });
    }

    if (this.activeRequestId === reqId) {
      this.inFlight = false;
    }

    this.webViewReceiveAck(ackAction, ackData);
    return ackAction !== 'detectionFailed';
  }

  onNativeComplete(reqId, page, bubbles, isError = false) {
    return this.onResultResolved(reqId, page, bubbles, isError);
  }
}

// --- TEST SUITE ---
console.log('Running Manga Bubble Recognition Unit Tests...\n');

// Test 1: Legal "あああ" and onomatopoeia NOT truncated
{
  console.log('[Test 1] Legal onomatopoeia / repetitions:');
  assert.strictEqual(compressExcessiveRepeatedCharacters('あああ'), 'あああ', 'あああ should not be truncated');
  assert.strictEqual(compressExcessiveRepeatedCharacters('うわああああ'), 'うわああああ', '4 repetitions should not be truncated');
  assert.strictEqual(compressExcessiveRepeatedCharacters('えええっ'), 'えええっ', 'えええっ should not be truncated');
  assert.strictEqual(compressExcessiveRepeatedCharacters('ドキドキ'), 'ドキドキ', '2-char reduplication ドキドキ must be preserved');
  assert.strictEqual(compressExcessiveRepeatedCharacters('キラキラ'), 'キラキラ', '2-char reduplication キラキラ must be preserved');
  assert.strictEqual(hasExcessiveRepeats('あああ'), false);
  assert.strictEqual(hasExcessiveRepeats('えええっ'), false);
  console.log('  ✓ Legal onomatopoeia (あああ, うわああああ, えええっ, ドキドキ, キラキラ) preserved intact');
}

// Test 2: Degenerative runaway repetition loops ARE suppressed
{
  console.log('[Test 2] Long runaway loop suppression:');
  assert.strictEqual(compressExcessiveRepeatedCharacters('ああああああああああああ'), 'あああ', '12 consecutive あ must be compressed to 3');
  assert.strictEqual(compressExcessiveRepeatedCharacters('―――――――――――――――――――――――――――――'), '――');
  assert.strictEqual(compressExcessiveRepeatedCharacters('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'), '~~');
  assert.strictEqual(compressExcessiveRepeatedCharacters('ジョン................................'), 'ジョン……');
  assert.strictEqual(hasExcessiveRepeats('あああああああああああああああ'), true);
  assert.strictEqual(hasExcessiveRepeats('――――――――――――――――――――'), true);
  console.log('  ✓ Runaway repetitions (12+ chars, hyphens, dots) successfully suppressed');
}

// Test 3: Adjacent distinct text lines are NOT merged
{
  console.log('[Test 3] Adjacent distinct text lines:');
  const line1 = { text: 'こんにちは', rect: { x: 100, y: 100, width: 30, height: 120 } };
  const line2 = { text: 'さようなら', rect: { x: 105, y: 110, width: 32, height: 125 } };
  assert.strictEqual(areStrictlyComplementary(line1, line2, true), false, 'Distinct overlapping lines must NOT be complementary');
  console.log('  ✓ Distinct adjacent text lines are safely kept separate');
}

// Test 4: Same-sentence multi-channel scans ARE merged
{
  console.log('[Test 4] Same-sentence multi-channel scans:');
  const sim = computeNormalizedSequenceSimilarity('迷えるアナタに', '迷える? アナタ(に');
  assert.ok(sim >= 0.85, 'Similarity of multi-channel scan of same sentence must be high');
  assert.strictEqual(removeDuplicatePhrases('うちはそういうのうちはそういうの'), 'うちはそういうの');
  console.log('  ✓ Multi-channel duplicate scans and duplicate phrases are cleanly merged');
}

// Test 5: RTL Japanese Manga Reading Order
{
  console.log('[Test 5] RTL Japanese Manga Reading Order:');
  const bubbles = [
    { id: 'left_title', box: { x: 5.0, y: 3.0, width: 30.0, height: 8.0 }, direction: 'horizontal' },
    { id: 'top_right', box: { x: 75.0, y: 10.0, width: 6.0, height: 15.0 }, direction: 'vertical' },
    { id: 'mid_right', box: { x: 74.0, y: 35.0, width: 5.0, height: 12.0 }, direction: 'vertical' },
    { id: 'center_panel', box: { x: 45.0, y: 40.0, width: 8.0, height: 10.0 }, direction: 'vertical' }
  ];

  const sorted = sortNormalizedReadingOrder(bubbles, 'vertical');
  assert.strictEqual(sorted[0].id, 'top_right', '#1 bubble must be top-right');
  assert.strictEqual(sorted[1].id, 'mid_right', '#2 bubble must be mid-right');
  assert.strictEqual(sorted[2].id, 'center_panel', '#3 bubble must be center');
  assert.strictEqual(sorted[3].id, 'left_title', '#4 bubble must be far left');
  console.log('  ✓ RTL Japanese manga reading order verified: Top-Right (#1) -> Mid-Right (#2) -> Center (#3) -> Left (#4)');
}

// Test 6: Regression - Conflicting noisy candidates (は1い今ははーい出1まい vs 今出ますー)
{
  console.log('[Test 6] Regression: Conflicting noisy candidates arbitration:');
  const noisy = {
    text: 'は1い今ははーい出1まい',
    rect: { x: 740, y: 170, width: 50, height: 180 },
    confidenceWeight: 2.0,
    rawConfidence: 0.65
  };
  const clean = {
    text: '今出ますー',
    rect: { x: 742, y: 175, width: 45, height: 170 },
    confidenceWeight: 2.5,
    rawConfidence: 0.94
  };

  assert.strictEqual(areCandidatesConflicting(noisy, clean, true), true, 'Overlapping candidate lines must be recognized as conflicting');

  const cleanScore = evaluateCandidateQuality(clean.text, clean.confidenceWeight, clean.rawConfidence);
  const noisyScore = evaluateCandidateQuality(noisy.text, noisy.confidenceWeight, noisy.rawConfidence);
  console.log(`    Quality Score: clean "${clean.text}" = ${cleanScore.toFixed(3)} vs noisy "${noisy.text}" = ${noisyScore.toFixed(3)}`);
  assert.ok(cleanScore > noisyScore, 'Clean Japanese candidate quality score must exceed noisy candidate with digits');

  const consolidated = consolidateGroupCandidates([noisy, clean], true);
  assert.strictEqual(consolidated, '今出ますー', 'Clean candidate must beat noisy stutter candidate without concatenation');
  console.log('  ✓ Noisy candidate "は1い今ははーい出1まい" is defeated by clean "今出ますー", NO concatenation');
}

// Test 7: Regression - Suffix fragment pollution ("あれ..." and "れ")
{
  console.log('[Test 7] Regression: Suffix fragment pollution prevention:');
  const full = {
    text: 'あれ...',
    rect: { x: 570, y: 740, width: 28, height: 60 },
    charSize: 20
  };
  const fragment = {
    text: 'れ',
    rect: { x: 572, y: 775, width: 25, height: 25 },
    charSize: 20
  };

  assert.strictEqual(areCandidatesConflicting(full, fragment, true), true, 'Fragment inside parent rect must conflict');

  const fullScore = evaluateCandidateQuality(full.text);
  const fragScore = evaluateCandidateQuality(fragment.text);
  console.log(`    Quality Score: full "${full.text}" = ${fullScore.toFixed(3)} vs fragment "${fragment.text}" = ${fragScore.toFixed(3)}`);
  assert.ok(fullScore > fragScore, 'Full sentence "あれ..." score must strictly exceed isolated single-character fragment "れ"');

  const consolidated = consolidateGroupCandidates([full, fragment], true);
  assert.strictEqual(consolidated, 'あれ...', 'Fragment "れ" must be absorbed into "あれ...", NEVER become "あれ...れ"');

  const cleaned = cleanTrailingDuplicateFragments('あれ...れ');
  assert.strictEqual(cleaned, 'あれ...', 'cleanTrailingDuplicateFragments must clean "あれ...れ" to "あれ..."');
  console.log('  ✓ "あれ..." correctly absorbs fragment "れ", score verified, preventing "あれ...れ"');
}

// Test 8: Regression - Prefix fragment pollution ("今 幸せですか?." and "今")
{
  console.log('[Test 8] Regression: Prefix fragment pollution prevention:');
  const full = {
    text: '今 幸せですか?.',
    rect: { x: 240, y: 110, width: 68, height: 350 },
    charSize: 30
  };
  const fragment = {
    text: '今',
    rect: { x: 242, y: 115, width: 60, height: 45 },
    charSize: 30
  };

  assert.strictEqual(areCandidatesConflicting(full, fragment, true), true, 'Prefix fragment must conflict');

  const fullScore = evaluateCandidateQuality(full.text);
  const fragScore = evaluateCandidateQuality(fragment.text);
  console.log(`    Quality Score: full "${full.text}" = ${fullScore.toFixed(3)} vs fragment "${fragment.text}" = ${fragScore.toFixed(3)}`);
  assert.ok(fullScore > fragScore, 'Full sentence "今 幸せですか?." score must strictly exceed isolated single-character fragment "今"');

  const consolidated = consolidateGroupCandidates([full, fragment], true);
  assert.strictEqual(consolidated, '今 幸せですか?.', 'Fragment "今" must be absorbed, NEVER become "今 幸せですか?.今"');
  console.log('  ✓ "今 幸せですか?." absorbs fragment "今", score verified, preventing "今 幸せですか?.今"');
}

// Test 9: Legitimate complementary sequential lines ARE merged
{
  console.log('[Test 9] Legitimate complementary sequential lines:');
  const topPart = {
    text: 'こんにちは',
    rect: { x: 100, y: 100, width: 30, height: 80 },
    charSize: 20
  };
  const bottomPart = {
    text: 'さようなら',
    rect: { x: 102, y: 195, width: 29, height: 80 },
    charSize: 20
  };

  assert.strictEqual(areCandidatesConflicting(topPart, bottomPart, true), false, 'Non-overlapping sequential lines must not conflict');
  assert.strictEqual(areStrictlyComplementary(topPart, bottomPart, true), true, 'Non-overlapping lines with natural gap must be complementary');

  const consolidated = consolidateGroupCandidates([topPart, bottomPart], true);
  assert.strictEqual(consolidated, 'こんにちはさようなら', 'Strictly complementary lines must be merged sequentially');
  console.log('  ✓ Legitimate sequential lines ("こんにちは" + "さようなら") are correctly merged as complementary');
}

// Test 10: Regression - Wide horizontal title candidate consensus arbitration (base / pass2 / manga_ocr)
{
  console.log('[Test 10] Regression: Wide horizontal title arbitration (base / pass2 / manga):');
  const candidates = [
    { text: '迷えるアナタに 快楽の勧めに、きゅうさい', source: 'base', confidence: 0.75, weight: 1.0 },
    { text: '迷えるアナタに 快楽の勧め', source: 'pass2', confidence: 0.80, weight: 1.0 },
    { text: '逃げるアナタを!?恐ろぴー・・・聖子の飼われて', source: 'manga_ocr', confidence: 0.92, weight: 1.0 }
  ];

  const selectedText = arbitrateMultiChannelCandidates(candidates, true);
  console.log(`    Selected text for wide horizontal banner: "${selectedText}"`);
  assert.strictEqual(
    selectedText,
    '迷えるアナタに 快楽の勧めに、きゅうさい',
    'Arbiter must select consensus-supported, fully-covered base candidate, rejecting ungrounded Manga-OCR hallucination'
  );
  console.log('  ✓ Multi-channel consensus selects "base", completely rejecting zero-consensus Manga-OCR hallucination');
}

// Test 11: Regression - Multi-line horizontal title second-line recall & consolidation
{
  console.log('[Test 11] Regression: Multi-line horizontal title second-line recall:');
  const line1 = {
    text: '迷えるアナタに',
    rect: { x: 40, y: 35, width: 260, height: 40 },
    charSize: 28
  };
  const line2 = {
    text: '快楽の勧め…',
    rect: { x: 42, y: 70, width: 220, height: 35 },
    charSize: 26
  };

  assert.strictEqual(areCandidatesConflicting(line1, line2, false), false, 'Distinct lines in multi-line title must NOT conflict');

  const consolidated = consolidateGroupCandidates([line1, line2], false);
  console.log(`    Consolidated multi-line title: "${consolidated}"`);
  assert.strictEqual(
    consolidated,
    '迷えるアナタに 快楽の勧め…',
    'Second line "快楽の勧め…" must be recalled and consolidated, NEVER lost!'
  );
  console.log('  ✓ Multi-line horizontal title correctly recalls both lines: "迷えるアナタに 快楽の勧め…"');
}

// Test 12: Regression - One click = One request, in-flight duplicate dropped
{
  console.log('[Test 12] Regression: One click = One request, in-flight duplicate dropped:');
  const coord = new DetectionCoordinator();
  const req1 = coord.triggerDetection(6);
  const accepted1 = coord.onRequestReceived(req1, 6);
  assert.strictEqual(accepted1, true, 'First request must be accepted');

  // Duplicate event delivered while req1 is in flight
  const acceptedDup = coord.onRequestReceived(req1, 6);
  assert.strictEqual(acceptedDup, false, 'Duplicate in-flight request must be dropped');
  assert.strictEqual(coord.droppedCount, 1, 'Duplicate count must be 1');
  console.log('  ✓ In-flight duplicate detection request safely suppressed');
}

// Test 13: Regression - Stale request results cannot overwrite current page
{
  console.log('[Test 13] Regression: Stale request results cannot overwrite current page:');
  const coord = new DetectionCoordinator();
  const req1 = coord.triggerDetection(5); // Page 5 started
  coord.onRequestReceived(req1, 5);

  // User flips to page 6
  const req2 = coord.triggerDetection(6);
  coord.onRequestReceived(req2, 6);

  // Old req1 on page 5 resolves late
  const req1Applied = coord.onResultResolved(req1, 5, ['bubble_page_5']);
  assert.strictEqual(req1Applied, false, 'Stale result from page 5 must be rejected');

  // Req2 on page 6 resolves
  const req2Applied = coord.onResultResolved(req2, 6, ['bubble_page_6']);
  assert.strictEqual(req2Applied, true, 'Current page 6 result must be accepted');
  assert.strictEqual(coord.appliedResults.length, 1);
  assert.strictEqual(coord.appliedResults[0].page, 6);
  console.log('  ✓ Stale request from previous page/request cannot overwrite active page');
}

// Test 14: Regression - Zero results (0 bubbles) releases WebView lock and clears overlay, allows next detection
{
  console.log('[Test 14] Regression: Zero results releases WebView lock and allows next detection:');
  const coord = new DetectionCoordinator();
  const req1 = coord.triggerDetection(6);
  assert.strictEqual(coord.webViewRequestDetection(req1), true, 'First snapshot must lock');
  assert.strictEqual(coord.webViewLock, true, 'WebView lock must be active');

  // Legal zero bubbles returned
  coord.onRequestReceived(req1, 6);
  const success = coord.onNativeComplete(req1, 6, []);
  assert.strictEqual(success, true, 'Zero result must be treated as successful completion');
  assert.strictEqual(coord.webViewLock, false, 'WebView lock MUST be released on zero bubbles');
  assert.deepStrictEqual(coord.currentOverlayBubbles, [], 'Overlay must be explicitly cleared to empty array');

  // Subsequent detection must NOT be blocked by SNAPSHOT_SKIPPED
  const req2 = coord.triggerDetection(6);
  assert.strictEqual(coord.webViewRequestDetection(req2), true, 'Next detection must NOT be blocked after zero-result completion');
  console.log('  ✓ Zero results releases lock, explicitly clears overlay, and permits next detection');
}

// Test 15: Regression - Error releases WebView lock and allows next detection
{
  console.log('[Test 15] Regression: Error releases WebView lock and allows next detection:');
  const coord = new DetectionCoordinator();
  const req1 = coord.triggerDetection(6);
  coord.webViewRequestDetection(req1);
  assert.strictEqual(coord.webViewLock, true);

  // Error occurs during native detection
  coord.onRequestReceived(req1, 6);
  const ok = coord.onNativeComplete(req1, 6, null, true);
  assert.strictEqual(ok, false, 'Error should be reported as failed');
  assert.strictEqual(coord.webViewLock, false, 'WebView lock MUST be released on error');

  // Subsequent detection must succeed
  const req2 = coord.triggerDetection(6);
  assert.strictEqual(coord.webViewRequestDetection(req2), true, 'Next detection must succeed after previous error');
  console.log('  ✓ Error releases lock and permits next detection');
}

// Test 16: Regression - Stale ACK cannot unlock new request
{
  console.log('[Test 16] Regression: Stale ACK cannot unlock new request:');
  const coord = new DetectionCoordinator();
  const req1 = coord.triggerDetection(5);
  coord.webViewRequestDetection(req1);

  // User flips to page 6 and starts req2
  const req2 = coord.triggerDetection(6);
  coord.webViewLock = false; // Page change resets snapshot lock
  coord.webViewRequestDetection(req2);
  assert.strictEqual(coord.webViewActiveReqId, req2);
  assert.strictEqual(coord.webViewLock, true);

  // Late ACK from req1 arrives
  const unlocked = coord.webViewReceiveAck('setDetectedBubbles', { bubbles: ['stale'], active: true, requestId: req1 });
  assert.strictEqual(unlocked, false, 'Stale ACK from req1 must NOT unlock or update');
  assert.strictEqual(coord.webViewLock, true, 'WebView lock must remain held by active req2');

  // Active ACK from req2 arrives
  const req2Unlocked = coord.webViewReceiveAck('setDetectedBubbles', { bubbles: ['req2_bubbles'], active: true, requestId: req2 });
  assert.strictEqual(req2Unlocked, true, 'Active ACK must unlock');
  assert.strictEqual(coord.webViewLock, false);
  assert.deepStrictEqual(coord.currentOverlayBubbles, ['req2_bubbles']);
  console.log('  ✓ Stale ACK correctly ignored without unlocking or corrupting active request');
}

// Test 17: Regression - Tall vertical body text is not a large-font candidate
{
  console.log('[Test 17] Regression: Tall vertical columns keep normal merge distance:');
  const classifyLargeFont = (a, b) => {
    const verticalPair = a.vertical && b.vertical;
    const charSizeBase = Math.max(a.charSize, b.charSize);
    const shortAxisExtent = verticalPair
      ? Math.max(a.width, b.width)
      : Math.max(a.height, b.height);
    return charSizeBase > 30 || shortAxisExtent > 35;
  };

  const left = { vertical: true, charSize: 19, width: 28, height: 150 };
  const right = { vertical: true, charSize: 20, width: 30, height: 145 };
  assert.strictEqual(classifyLargeFont(left, right), false,
    'Tall vertical body-text columns must not receive the 120px large-font merge gap');
  assert.strictEqual(classifyLargeFont(
    { vertical: true, charSize: 38, width: 48, height: 160 },
    { vertical: true, charSize: 36, width: 46, height: 150 },
  ), true, 'Actual large vertical lettering must keep large-font handling');
  console.log('  ✓ Vertical height no longer misclassifies normal dialogue as large lettering');
}

// ============================================================================
// Kotlin 几何规则镜像
// 说明：仓库没有 Kotlin JVM 单测设施，本轮只允许修改 MangaOcrProcessor.kt 与
// tests/bubble-rules.test.js，因此以下函数逐条镜像 Kotlin 的判定条件，用于锁定
// 几何语义和失败场景。它不是对 Kotlin 的真实调用；最终仍须由 page19 真机回归
// 验证。边界：JS 不覆盖 Rect 取整、OCR 文本、Bitmap 像素和 ComicTextDetector 输出。
// ============================================================================

// 对应 Kotlin: verticalColumnGap()
function verticalColumnGap(aWidth, aCharSize, bWidth, bCharSize) {
  const maxColWidth = Math.max(Math.max(1, aWidth), Math.max(1, bWidth));
  const isLargeFont = Math.max(aCharSize, bCharSize) > 30 || maxColWidth > 35;
  return isLargeFont
    ? Math.max(42, Math.min(120, maxColWidth * 1.35))
    : Math.min(42, maxColWidth * 1.25);
}

// 对应 Kotlin: splitDistantVerticalClusters() 的按左边界归组 + 列边缘间距分支
function splitVerticalColumnsByEdgeGap(items) {
  const sorted = [...items].sort((a, b) => (a.left - b.left) || (a.top - b.top));
  const groups = [[sorted[0]]];
  let currentRight = sorted[0].left + sorted[0].width;
  let currentMaxWidth = Math.max(1, sorted[0].width);
  let currentMaxChar = Math.max(1, sorted[0].charSize);

  for (let index = 1; index < sorted.length; index += 1) {
    const item = sorted[index];
    const edgeGap = item.left - currentRight;
    const allowedGap = verticalColumnGap(
      currentMaxWidth, currentMaxChar,
      Math.max(1, item.width), Math.max(1, item.charSize),
    );
    if (edgeGap > allowedGap) {
      groups.push([]);
      currentRight = item.left + item.width;
      currentMaxWidth = Math.max(1, item.width);
      currentMaxChar = Math.max(1, item.charSize);
    } else {
      currentRight = Math.max(currentRight, item.left + item.width);
      currentMaxWidth = Math.max(currentMaxWidth, item.width);
      currentMaxChar = Math.max(currentMaxChar, item.charSize);
    }
    groups.at(-1).push(item);
  }
  return groups;
}

// 对应 Kotlin: bridgeSubRegions()
function bridgeSubRegions(detection, bubbles) {
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const covered = bubbles
    .filter((bubble) => bubble.vertical && overlap(bubble, detection) / (bubble.w * bubble.h) >= 0.5)
    .sort((a, b) => a.x - b.x);
  if (covered.length < 2) return [];

  const groups = [];
  for (const rect of covered) {
    const group = groups.at(-1);
    if (group) {
      const groupRight = Math.max(...group.map((item) => item.x + item.w));
      const minWidth = Math.min(rect.w, ...group.map((item) => item.w));
      const edgeGap = rect.x - groupRight;
      if (edgeGap <= Math.max(16, minWidth * 0.5)) {
        group.push(rect);
        continue;
      }
    }
    groups.push([rect]);
  }
  if (groups.length < 2) return [];

  const regions = groups.map((group) => {
    const x = Math.max(detection.x, Math.min(...group.map((item) => item.x)));
    const y = Math.max(detection.y, Math.min(...group.map((item) => item.y)));
    const right = Math.min(detection.x + detection.w, Math.max(...group.map((item) => item.x + item.w)));
    const bottom = Math.min(detection.y + detection.h, Math.max(...group.map((item) => item.y + item.h)));
    return { x, y, w: right - x, h: bottom - y };
  }).filter((region) => region.w > 0 && region.h > 0);

  return regions.length >= 2 ? regions : [];
}

// 对应 Kotlin: removeCoveredNarrowVerticalFragments() / isCoveredNarrowVerticalFragment()
function isCoveredNarrowVerticalFragment(narrow, narrowText, complete, completeText) {
  if (narrow.w <= 0 || narrow.h <= 0 || complete.w <= 0 || complete.h <= 0) return false;
  if (narrow.w >= complete.w - 6) return false;
  if (narrow.w > complete.w * 0.70) return false;

  const interW = Math.max(0, Math.min(narrow.x + narrow.w, complete.x + complete.w) - Math.max(narrow.x, complete.x));
  const interH = Math.max(0, Math.min(narrow.y + narrow.h, complete.y + complete.h) - Math.max(narrow.y, complete.y));
  const inter = interW * interH;
  if (inter <= 0) return false;
  const heightCoverage = interH / narrow.h;
  const areaCoverage = inter / (narrow.w * narrow.h);
  if (heightCoverage < 0.72 || areaCoverage < 0.55) return false;

  const narrowClean = narrowText.replace(/[\s\p{P}]+/gu, '');
  const completeClean = completeText.replace(/[\s\p{P}]+/gu, '');
  if (!narrowClean || !completeClean) return false;
  if (narrowClean.length > completeClean.length + 1) return false;

  if (completeClean.includes(narrowClean) || narrowClean.includes(completeClean)) return true;
  return computeNormalizedSequenceSimilarity(narrowText, completeText) >= 0.85;
}

function isVerticalBubbleForFragment(box) {
  return box.direction === 'vertical'
    || (box.direction !== 'horizontal' && box.h > box.w * 1.15);
}

function removeCoveredNarrowVerticalFragments(bubbles) {
  if (bubbles.length <= 1) return bubbles;
  const drop = bubbles.map(() => false);
  for (let i = 0; i < bubbles.length; i += 1) {
    const narrow = bubbles[i];
    if (!isVerticalBubbleForFragment(narrow)) continue;
    for (let j = 0; j < bubbles.length; j += 1) {
      if (i === j) continue;
      const complete = bubbles[j];
      if (!isVerticalBubbleForFragment(complete)) continue;
      if (isCoveredNarrowVerticalFragment(narrow, narrow.text || '', complete, complete.text || '')) {
        drop[i] = true;
        break;
      }
    }
  }
  return bubbles.filter((_, index) => !drop[index]);
}

// Test 18: Page19-like distant vertical columns split by edge gap, not center gap
{
  console.log('[Test 18] Regression: Distant vertical columns split by edge gap:');
  const groups = splitVerticalColumnsByEdgeGap([
    // 中央列：同一列上下两个 OCR 行
    { left: 410, top: 32, width: 101, charSize: 20 },
    { left: 411, top: 240, width: 99, charSize: 20 },
    // 右侧独立列
    { left: 648, top: 24, width: 58, charSize: 20 },
  ]);
  assert.deepStrictEqual(groups.map(group => group.length), [2, 1],
    'The right dialogue must split from the center column at the 137px edge gap');
  console.log('  ✓ Edge gap splits page19 center/right columns while stacked rows stay together');
}

// Test 19: Normal wide multi-column bubble is NOT split
{
  console.log('[Test 19] Regression: Wide multi-column bubble keeps one group:');
  const normalWide = splitVerticalColumnsByEdgeGap([
    { left: 100, top: 40, width: 60, charSize: 20 },
    { left: 240, top: 42, width: 60, charSize: 20 },
    { left: 380, top: 38, width: 58, charSize: 20 },
  ]);
  assert.strictEqual(normalWide.length, 1,
    '60px-wide columns with 80px edge gaps must remain one normal multi-column bubble');

  const boundary = splitVerticalColumnsByEdgeGap([
    { left: 100, top: 40, width: 100, charSize: 20 },
    { left: 320, top: 42, width: 100, charSize: 20 },
  ]);
  assert.strictEqual(boundary.length, 1,
    'Large-font columns at the allowed 120px edge gap must not be split');
  console.log('  ✓ Wide/large multi-column bubbles are not falsely split');
}

// Test 20: Wide bridge detection is split into per-bubble regions; single bubble unchanged
{
  console.log('[Test 20] Regression: Wide bridge detection cannot re-merge separated bubbles:');
  const bubbles = [
    { x: 410, y: 32, w: 101, h: 199, vertical: true },
    { x: 677, y: 24, w: 33, h: 212, vertical: true },
  ];
  const wideDetection = { x: 409, y: 32, w: 306, h: 199 };
  const regions = bridgeSubRegions(wideDetection, bubbles);

  assert.strictEqual(regions.length, 2,
    'A 306px detection covering two separated vertical bubbles must produce two sub-regions');
  assert.ok(regions.every((region) => region.w <= 101),
    'No sub-region may keep a cross-both tightBox width');
  assert.ok(regions[0].x + regions[0].w <= 511 && regions[1].x >= 677,
    'Each sub-region must stay within its own dialogue column');

  // 失败现场：无保护时 enhanced tightBox 为 412..679，跨过右侧气泡并与其重复
  const unguardedTightBox = { x: 412, y: 32, w: 267, h: 194 };
  assert.ok(regions.every((region) => region.w !== unguardedTightBox.w),
    'The cross-both enhanced tightBox must never be used as one bubble box');

  const singleBubbleDetection = { x: 409, y: 30, w: 110, h: 205 };
  assert.deepStrictEqual(bridgeSubRegions(singleBubbleDetection, bubbles), [],
    'A normal single-bubble detection must keep the original enhancement path');
  console.log('  ✓ Bridge detection split per bubble; single-bubble enhancement untouched');
}

// Test 21: Page19 right #3 complete box + narrow duplicate fragment -> keep complete only
{
  console.log('[Test 21] Regression: Covered narrow vertical fragment is removed:');
  const complete = {
    x: 648, y: 24, w: 58, h: 212, direction: 'vertical',
    text: '吉原…見ないでくれ…!',
  };
  const containedFragment = {
    x: 650, y: 36, w: 22, h: 190, direction: 'vertical',
    text: '見ないでくれ…!',
  };
  const kept = removeCoveredNarrowVerticalFragments([complete, containedFragment]);
  assert.strictEqual(kept.length, 1, 'Narrow contained fragment must be removed');
  assert.strictEqual(kept[0].w, 58, 'The complete wider #3 box must be retained');
  assert.strictEqual(kept[0].text, complete.text);

  const typoFragment = {
    x: 650, y: 36, w: 22, h: 190, direction: 'vertical',
    text: '吉原見ないでれ',
  };
  const keptTypo = removeCoveredNarrowVerticalFragments([complete, typoFragment]);
  assert.strictEqual(keptTypo.length, 1,
    'A high-similarity OCR fragment must also be removed, not kept as a second box');
  console.log('  ✓ Complete #3 kept; contained/OCR narrow fragments removed');
}

// Test 22: Different-text vertical boxes must both survive, even with high geometric coverage
{
  console.log('[Test 22] Regression: Different nearby vertical texts are not deduplicated:');
  const complete = {
    x: 648, y: 24, w: 58, h: 212, direction: 'vertical',
    text: '吉原…見ないでくれ…!',
  };
  const different = {
    x: 670, y: 30, w: 30, h: 200, direction: 'vertical',
    text: 'お前の母親に童貞奪われるところなんて…!',
  };
  const kept = removeCoveredNarrowVerticalFragments([complete, different]);
  assert.strictEqual(kept.length, 2,
    'Different text must not be deleted merely because its box is narrow and covered');
  assert.ok(kept.some((b) => b.text === complete.text));
  assert.ok(kept.some((b) => b.text === different.text));
  console.log('  ✓ Different text remains separate even with high area overlap');
}

// Test 23: Page19 center/right separation is preserved
{
  console.log('[Test 23] Regression: Separate center/right dialogues both survive:');
  const center = {
    x: 410, y: 32, w: 101, h: 199, direction: 'vertical',
    text: 'お前の母親に童貞奪われるところなんて…!',
  };
  const right = {
    x: 648, y: 24, w: 58, h: 212, direction: 'vertical',
    text: '吉原…見ないでくれ…!',
  };
  const kept = removeCoveredNarrowVerticalFragments([center, right]);
  assert.strictEqual(kept.length, 2,
    'Center and right are separate dialogues and must both survive final deduplication');
  assert.ok(kept.some((b) => b.w === 101));
  assert.ok(kept.some((b) => b.w === 58));
  console.log('  ✓ Center/right separation preserved by the final fragment filter');
}

console.log('\nAll 23 Unit Tests Passed Successfully!\n');
