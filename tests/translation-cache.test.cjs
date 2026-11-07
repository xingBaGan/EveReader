const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Load the production TypeScript without a native React Native runtime.
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { TranslationOrchestrator } = require('../src/translation/orchestrator.ts');
const { TranslationProviderRegistry } = require('../src/translation/providerRegistry.ts');

test('redetecting a page reuses translations with the new OCR region IDs', async () => {
  const registry = new TranslationProviderRegistry();
  let calls = 0;
  registry.register({
    id: 'test-device',
    supports: () => true,
    translate: async (request) => {
      calls++;
      return request.bubbles.map((bubble) => ({
        id: bubble.id, sourceText: bubble.sourceText, translatedText: '你好',
        providerId: 'test-device', modelId: request.modelId,
      }));
    },
  });
  const runtime = new TranslationOrchestrator(registry);
  const request = (requestId, ids) => ({
    requestId, bookId: 'book', page: 9, route: 'device',
    sourceLanguage: 'ja', targetLanguage: 'zh',
    bubbles: ids.map((id, index) => ({
      id, sourceText: 'こんにちは', readingOrderIndex: index + 1,
      textType: 'bubble', direction: 'vertical',
    })),
  });
  await runtime.run(request('first-detection', ['old-region']));
  const reopened = await runtime.run(request('second-detection', ['new-region-a', 'new-region-b']));
  assert.equal(calls, 1, 'second detection must use the cache');
  assert.deepEqual(reopened.items.map((item) => item.id), ['new-region-a', 'new-region-b']);
  assert.ok(reopened.items.every((item) => item.translatedText === '你好' && item.cached));
});
