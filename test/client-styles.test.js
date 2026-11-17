import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';
import { normalizeRenderConfig } from '../src/render-config.js';

async function until(h, condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) { assert.ok(Date.now() < deadline, 'client style state timed out'); await h.wait(10); }
}
const cardFor = (h) => h.document.querySelector('.dsh-mmd');

test('slow light success or failure before dark debounce cannot commit or poison its cache', async (t) => {
  for (const fail of [false, true]) await t.test(fail ? 'late failure' : 'late success', async () => {
    const h = await createClientHarness({ initialSource: 'flowchart LR\nSLOW-->Z' });
    try {
      await until(h, () => h.state.releaseSlowRender);
      h.document.body.setAttribute('data-ds-dark-theme', '');
      await h.wait(15);
      if (fail) h.state.rejectSlowRender(); else h.state.releaseSlowRender();
      await h.wait(70);
      assert.equal(cardFor(h).querySelector('svg'), null);
      assert.notEqual(cardFor(h).dataset.state, 'error');
      await until(h, () => h.state.renderCalls.length === 2);
      assert.deepEqual(h.state.initializedThemes, ['default', 'dark']);
      h.state.releaseSlowRender();
      await until(h, () => cardFor(h).dataset.state === 'ok');
      assert.equal(h.state.maxActiveRenders, 1);
    } finally { h.state.releaseSlowRender?.(); await h.cleanup(); }
  });
});

test('fixed global themes ignore host changes and all cards share one lazy snapshot', async () => {
  const h = await createClientHarness({ initialSource: null, config: { theme: 'forest', look: 'handDrawn', themeVariables: { common: { primaryColor: '#abc' } } } });
  try {
    await h.wait(100);
    assert.equal(h.state.configRequests, 0);
    h.addCodeBlock('flowchart LR\nA-->B'); h.addCodeBlock('sequenceDiagram\nA->>B: Hello');
    await until(h, () => h.document.querySelectorAll('.dsh-mmd[data-state="ok"]').length === 2);
    assert.equal(h.state.configRequests, 1);
    assert.ok(h.state.initializedOptions.every((value) => value.look === 'handDrawn' && value.theme === 'forest' && !Object.hasOwn(value, 'themeVariables')));
    h.document.body.setAttribute('data-ds-dark-theme', '');
    await h.wait(650);
    assert.equal(h.state.renderCalls.length, 2);
  } finally { await h.cleanup(); }
});

test('base mode deep merges branch variables and redraws drafts while preserving fullscreen viewport', async () => {
  const h = await createClientHarness({ config: { theme: 'base', themeVariables: { common: { xyChart: { titleColor: '#123', xAxisLabelColor: '#456' } }, dark: { xyChart: { titleColor: '#abc' } } } } });
  try {
    await until(h, () => cardFor(h)?.dataset.state === 'ok');
    const card = cardFor(h);
    card.querySelectorAll('.dsh-mmd-view-control')[2].click();
    const editor = card.querySelector('textarea');
    editor.value = 'flowchart LR\nDRAFT-->DONE';
    editor.dispatchEvent(new h.window.Event('input'));
    await until(h, () => card.dataset.state === 'ok');
    card.querySelectorAll('.dsh-mmd-diagram-action')[1].click();
    const viewer = h.document.querySelector('.dsh-mmd-viewer');
    viewer.querySelector('[aria-label="放大"]').click();
    const before = viewer.querySelector('.dsh-mmd-viewer-stage').style.transform;
    h.document.body.setAttribute('data-ds-dark-theme', '');
    await h.wait(15);
    assert.equal(viewer.querySelector('.dsh-mmd-viewer-status').hidden, false);
    assert.equal(card.querySelector('.dsh-mmd-diagram-action').disabled, true);
    await until(h, () => card.dataset.state === 'ok');
    assert.equal(viewer.querySelector('.dsh-mmd-viewer-status').hidden, true);
    assert.equal(viewer.querySelector('.dsh-mmd-viewer-stage').style.transform, before);
    assert.equal(h.state.renderCalls.at(-1), editor.value);
    assert.equal(card.dataset.view, 'edit');
    assert.equal(card.querySelector('.dsh-mmd-reset').disabled, false);
    assert.deepEqual(h.state.initializedOptions.at(-1).themeVariables, { xyChart: { titleColor: '#abc', xAxisLabelColor: '#456' }, darkMode: true });
  } finally { await h.cleanup(); }
});

test('configuration warnings persist through successful rendering and locale changes', async () => {
  const h = await createClientHarness({ config: { look: 'invalid' } });
  try {
    h.addCodeBlock('pie\n"A": 1');
    await until(h, () => h.document.querySelectorAll('.dsh-mmd[data-state="ok"]').length === 2);
    const warnings = [...h.document.querySelectorAll('.dsh-mmd-config-warning')];
    assert.ok(warnings.every((element) => !element.hidden && /配置无效.*look/.test(element.textContent)));
    assert.equal(warnings.filter((element) => element.hasAttribute('aria-live')).length, 1);
    h.document.documentElement.lang = 'en';
    await h.wait(15);
    assert.ok(warnings.every((element) => /Configuration is invalid/.test(element.textContent)));
  } finally { await h.cleanup(); }
});

test('remount gets a new config request and a late old response cannot replace it', async () => {
  let resolve;
  let calls = 0;
  const h = await createClientHarness({ fetchConfig: async () => {
    if (++calls === 1) return new Promise((done) => { resolve = done; });
    return new Response(JSON.stringify(normalizeRenderConfig({ theme: 'forest' })), { headers: { 'content-type': 'application/json' } });
  } });
  try {
    await until(h, () => resolve);
    h.disposePlugin(); h.mountPlugin();
    resolve(new Response(JSON.stringify(normalizeRenderConfig({ theme: 'dark' })), { headers: { 'content-type': 'application/json' } }));
    await until(h, () => cardFor(h)?.dataset.state === 'ok');
    assert.equal(calls, 2);
    assert.deepEqual(h.state.initializedThemes, ['forest']);
  } finally { await h.cleanup(); }
});

test('rapid theme round trips invalidate pending work and only current failures close fullscreen', async () => {
  let failBinding = false;
  const h = await createClientHarness({ bindFunctions() { if (failBinding) throw new Error('current style failed'); } });
  try {
    await until(h, () => cardFor(h)?.dataset.state === 'ok');
    const card = cardFor(h);
    card.querySelectorAll('.dsh-mmd-diagram-action')[1].click();
    const viewer = h.document.querySelector('.dsh-mmd-viewer');
    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    h.document.body.setAttribute('data-ds-dark-theme', '');
    await h.wait(15);
    h.document.body.removeAttribute('data-ds-dark-theme');
    await h.wait(15);
    assert.equal(card.dataset.state, 'ok');
    assert.equal(viewer.hidden, false);
    assert.equal(h.state.renderCalls.length, 1);
    assert.equal(card.querySelector('.dsh-mmd-pane svg'), oldSvg);
    failBinding = true;
    h.document.body.setAttribute('data-ds-dark-theme', '');
    await until(h, () => card.dataset.state === 'error');
    assert.equal(viewer.hidden, true);
    assert.equal(card.querySelector('.dsh-mmd-pane svg'), oldSvg);
    assert.equal(card.querySelector('.dsh-mmd-diagram-action').disabled, true);
  } finally { await h.cleanup(); }
});

test('unavailable configuration keeps default rendering, fullscreen and export usable with a warning', async () => {
  const h = await createClientHarness({ fetchConfig: async () => { throw new Error('private network detail'); } });
  try {
    await until(h, () => cardFor(h)?.dataset.state === 'ok');
    const card = cardFor(h);
    const warning = card.querySelector('.dsh-mmd-config-warning');
    assert.match(warning.textContent, /配置读取失败/);
    assert.doesNotMatch(warning.textContent, /private/);
    assert.deepEqual(h.state.initializedThemes, ['default']);
    const actions = card.querySelectorAll('.dsh-mmd-diagram-action');
    actions[1].click();
    assert.equal(h.document.querySelector('.dsh-mmd-viewer').hidden, false);
    actions[0].click();
    assert.equal(h.state.objectUrls.length, 1);
    assert.equal(warning.hidden, false);
    assert.equal(h.state.configRequests, 1);
  } finally { await h.cleanup(); }
});
