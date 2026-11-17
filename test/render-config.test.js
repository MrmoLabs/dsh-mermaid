import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, effectiveStyle, mergeVariables, normalizeRenderConfig, styleKey } from '../src/render-config.js';

test('normalizes defaults, all supported styles and independent looks without mutation', () => {
  for (const value of [undefined, {}]) assert.deepEqual(normalizeRenderConfig(value).style, DEFAULT_STYLE);
  for (const theme of ['auto', 'default', 'dark', 'neutral', 'forest', 'base']) {
    for (const look of ['classic', 'handDrawn']) {
      const input = { theme, look, themeVariables: { common: { custom: ['red', 2, true, { a: 1 }] } } };
      const before = JSON.stringify(input);
      const result = normalizeRenderConfig(input);
      assert.equal(result.status, 'ready');
      assert.equal(JSON.stringify(input), before);
      assert.ok(Object.isFrozen(result.style.themeVariables.common.custom));
      for (const dark of [false, true]) {
        const style = effectiveStyle(result.style, dark);
        assert.equal(style.look, look);
        assert.equal(style.theme, theme === 'auto' ? (dark ? 'dark' : 'default') : theme);
        assert.equal(Object.hasOwn(style, 'themeVariables'), theme === 'base');
      }
    }
  }
});

test('rejects entire invalid configurations with bounded, value-free paths', () => {
  const cases = [null, [], 1, { theme: null }, { theme: 'unknown' }, { look: 'neo' }, { light: {} },
    { themeVariables: null }, { themeVariables: { lite: {} } }, { themeVariables: { common: [] } }];
  for (const bad of [null, undefined, NaN, Infinity, () => {}, new Date(), /x/, 2n]) cases.push({ themeVariables: { common: { value: bad } } });
  const cycle = {}; cycle.self = cycle;
  cases.push({ themeVariables: { common: cycle } });
  for (const key of ['__proto__', 'constructor', 'prototype']) cases.push(JSON.parse(`{"themeVariables":{"common":{"${key}":{"secret":"private"}}}}`));
  cases.push({ themeVariables: { common: { ['private secret!']: null } } });
  const accessor = {}; Object.defineProperty(accessor, 'theme', { enumerable: true, get() { throw new Error('must not run'); } });
  cases.push(accessor);
  class CustomArray extends Array {}
  cases.push({ themeVariables: { common: { value: new CustomArray(1) } } });
  for (const value of cases) {
    const result = normalizeRenderConfig(value);
    assert.equal(result.status, 'fallback');
    assert.deepEqual(result.style, DEFAULT_STYLE);
    assert.ok(result.diagnostics.length > 0 && result.diagnostics.length <= 20);
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /private|secret|__proto__|constructor|prototype/);
  }
  const result = normalizeRenderConfig(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`x${i}`, null])));
  assert.deepEqual(result.diagnostics.at(-1), { code: 'TRUNCATED', path: '' });
});

test('enforces depth, aggregate items, string and UTF-8 limits and accepts 70 variables', () => {
  const common = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`color${i}`, '#aabbcc']));
  assert.equal(normalizeRenderConfig({ themeVariables: { common } }).status, 'ready');
  const validate = (value) => normalizeRenderConfig({ themeVariables: { common: value } });
  let deep = { x: true };
  for (let i = 0; i < 8; i++) deep = { x: deep };
  assert.equal(validate(deep).diagnostics[0].code, 'MAX_DEPTH');
  assert.equal(validate({ x: 'a'.repeat(8193) }).diagnostics[0].code, 'MAX_STRING');
  assert.equal(validate(Object.fromEntries(Array.from({ length: 2049 }, (_, i) => [`x${i}`, true]))).diagnostics[0].code, 'MAX_ITEMS');
  assert.equal(normalizeRenderConfig({ themeVariables: { common: Object.fromEntries(Array.from({ length: 1024 }, (_, i) => [`x${i}`, true])), dark: Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`x${i}`, true])) } }).status, 'fallback');
  assert.equal(validate(Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`x${i}`, '色'.repeat(8192)]))).diagnostics[0].code, 'MAX_BYTES');
});

test('deep merges variables, replaces arrays, keeps explicit darkMode and stable semantic keys', () => {
  const common = { xyChart: { titleColor: 'red', plotColorPalette: ['a', 'b'] }, fontSize: '15px' };
  const branch = { xyChart: { plotColorPalette: ['c'] } };
  assert.deepEqual(mergeVariables(common, branch), { xyChart: { titleColor: 'red', plotColorPalette: ['c'] }, fontSize: '15px' });
  assert.deepEqual(common.xyChart.plotColorPalette, ['a', 'b']);
  const style = normalizeRenderConfig({ theme: 'base', themeVariables: { common, dark: branch } }).style;
  assert.equal(effectiveStyle(style, true).themeVariables.darkMode, true);
  assert.equal(effectiveStyle(style, false).themeVariables.darkMode, false);
  assert.equal(effectiveStyle(normalizeRenderConfig({ theme: 'base', themeVariables: { common: { darkMode: false } } }).style, true).themeVariables.darkMode, false);
  assert.equal(styleKey({ b: [1, 2], a: { y: 1, x: 2 } }), styleKey({ a: { x: 2, y: 1 }, b: [1, 2] }));
  assert.notEqual(styleKey([1, 2]), styleKey([2, 1]));
  assert.equal(styleKey(effectiveStyle(normalizeRenderConfig({ theme: 'forest', themeVariables: { common } }).style, true)), styleKey(effectiveStyle(normalizeRenderConfig({ theme: 'forest' }).style, false)));
});
