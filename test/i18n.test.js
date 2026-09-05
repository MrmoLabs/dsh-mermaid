import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocale, resolveLocale, translate } from '../src/i18n.js';

test('normalizes supported Chinese locales and falls back to English', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('fr-FR'), 'en');
});

test('prefers the document language and interpolates translated messages', () => {
  assert.equal(resolveLocale('zh-Hans', ['en-US']), 'zh-CN');
  assert.equal(resolveLocale('', ['en-US']), 'en');
  assert.equal(translate('en', 'diagramTitle', { type: 'flowchart' }), 'Mermaid flowchart diagram');
  assert.equal(translate('zh-CN', 'tooManyLines', { actual: 2001, limit: 2000 }), '图表未渲染：源码共 2001 行，超过 2000 行限制。');
});
