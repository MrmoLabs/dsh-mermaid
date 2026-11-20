import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

async function waitFor(harness, condition) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for the preview state');
    await harness.wait(10);
  }
}

async function openEditor(harness) {
  await waitFor(harness, () => harness.document.querySelector('.dsh-mmd[data-state="ok"]'));
  const card = harness.document.querySelector('.dsh-mmd');
  card.querySelectorAll('.dsh-mmd-view-control')[2].click();
  return card;
}

function setDraft(harness, card, source) {
  const editor = card.querySelector('textarea');
  editor.value = source;
  editor.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  return editor;
}

test('composition cancels an earlier debounce and renders only the committed text', async () => {
  const harness = await createClientHarness();
  try {
    const card = await openEditor(harness);
    const renderCount = harness.state.renderCalls.length;
    const editor = setDraft(harness, card, 'flowchart LR\nA-->PENDING');
    await harness.wait(150);
    editor.dispatchEvent(new harness.window.Event('compositionstart', { bubbles: true }));
    setDraft(harness, card, 'flowchart LR\nA-->候选');
    await harness.wait(550);
    assert.equal(harness.state.renderCalls.length, renderCount);
    setDraft(harness, card, 'flowchart LR\nA-->确认');
    editor.dispatchEvent(new harness.window.Event('compositionend', { bubbles: true }));
    await waitFor(harness, () => harness.state.renderCalls.length > renderCount);
    assert.deepEqual(harness.state.renderCalls.slice(renderCount), ['flowchart LR\nA-->确认']);
  } finally { await harness.cleanup(); }
});

test('a preview already queued behind another card waits for compositionend', async () => {
  const harness = await createClientHarness();
  try {
    const card = await openEditor(harness);
    harness.addCodeBlock('flowchart LR\nSLOW-->BLOCKER');
    await waitFor(harness, () => harness.state.releaseSlowRender);
    const editor = setDraft(harness, card, 'flowchart LR\nA-->QUEUED');
    await harness.wait(650);
    const renderCount = harness.state.renderCalls.length;
    editor.dispatchEvent(new harness.window.Event('compositionstart', { bubbles: true }));
    setDraft(harness, card, 'flowchart LR\nA-->候选');
    harness.state.releaseSlowRender();
    await waitFor(harness, () => harness.document.querySelectorAll('.dsh-mmd[data-state="ok"]').length > 0);
    await harness.wait(100);
    assert.equal(harness.state.renderCalls.length, renderCount);
    editor.dispatchEvent(new harness.window.Event('compositionend', { bubbles: true }));
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(harness.state.renderCalls.at(-1), editor.value);
    assert.equal(harness.state.maxActiveRenders, 1);
  } finally {
    harness.state.releaseSlowRender?.();
    await harness.cleanup();
  }
});

test('a render completing during composition cannot replace the last good preview', async () => {
  const harness = await createClientHarness();
  try {
    const card = await openEditor(harness);
    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    const editor = setDraft(harness, card, 'flowchart LR\nSLOW-->DRAFT');
    await waitFor(harness, () => harness.state.releaseSlowRender);
    editor.dispatchEvent(new harness.window.Event('compositionstart', { bubbles: true }));
    harness.state.releaseSlowRender();
    await harness.wait(100);
    assert.ok(card.querySelector('.dsh-mmd-pane svg') === oldSvg);
    setDraft(harness, card, 'flowchart LR\nFAST-->COMMITTED');
    editor.dispatchEvent(new harness.window.Event('compositionend', { bubbles: true }));
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(card.querySelector('.dsh-mmd-pane svg').getAttribute('data-render'), 'fast');
  } finally {
    harness.state.releaseSlowRender?.();
    await harness.cleanup();
  }
});

test('a changed draft immediately marks the old preview stale while the queue is busy', async () => {
  const harness = await createClientHarness();
  try {
    const card = await openEditor(harness);
    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    harness.addCodeBlock('flowchart LR\nSLOW-->BLOCKER');
    await waitFor(harness, () => harness.state.releaseSlowRender);
    const source = 'flowchart LR\nCHANGED-->NEW';
    setDraft(harness, card, source);
    assert.equal(card.dataset.state, 'rendering');
    assert.equal(card.querySelector('.dsh-mmd-notice').hidden, false);
    assert.ok(card.querySelector('.dsh-mmd-pane svg') === oldSvg);
    await harness.wait(650);
    assert.match(card.querySelector('.dsh-mmd-notice').textContent, /上次成功/);
    assert.equal(harness.state.renderCalls.includes(source), false);
    assert.equal(card.querySelector('.dsh-mmd-diagram-action').disabled, true);
    harness.state.releaseSlowRender();
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.ok(card.querySelector('.dsh-mmd-pane svg') !== oldSvg);
    assert.equal(card.querySelector('.dsh-mmd-notice').hidden, true);
  } finally {
    harness.state.releaseSlowRender?.();
    await harness.cleanup();
  }
});

test('a failed binding restores the last good SVG before Reset and download', async () => {
  let failBinding = false;
  const harness = await createClientHarness({ bindFunctions() {
    if (failBinding) throw new Error('binding failed');
  } });
  try {
    const card = await openEditor(harness);
    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    failBinding = true;
    setDraft(harness, card, 'flowchart LR\nVERY_DIFFERENT-->SOURCE');
    await waitFor(harness, () => card.dataset.state === 'error');
    assert.ok(card.querySelector('.dsh-mmd-pane svg') === oldSvg, 'binding failure replaced the last good SVG');
    assert.match(card.querySelector('.dsh-mmd-notice').textContent, /渲染器出错/);
    assert.equal(card.querySelector('.dsh-mmd-retry').hidden, false);
    assert.equal(card.querySelector('.dsh-mmd-diagram-action').disabled, true);
    failBinding = false;
    card.querySelector('.dsh-mmd-reset').click();
    const download = card.querySelector('.dsh-mmd-diagram-action');
    download.click();
    assert.equal(download.disabled, false);
    assert.equal(harness.state.objectUrls.length, 1);
    const exported = await harness.state.objectUrls[0].text();
    assert.ok(exported.includes(`data-source-length="${harness.code.textContent.trim().length}"`));
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(card.querySelector('.dsh-mmd-notice').hidden, true);
  } finally { await harness.cleanup(); }
});

test('an initial binding failure removes the failed SVG and is retryable in diagram view', async () => {
  let failBinding = true;
  const harness = await createClientHarness({ bindFunctions() {
    if (failBinding) throw new Error('binding failed');
  } });
  try {
    await waitFor(harness, () => harness.document.querySelector('.dsh-mmd[data-state="error"]'));
    const card = harness.document.querySelector('.dsh-mmd');
    assert.ok(!card.querySelector('.dsh-mmd-pane svg'), 'failed initial SVG was retained');
    assert.equal(card.dataset.view, 'diagram');
    assert.equal(card.querySelector('.dsh-mmd-diagram-action').disabled, true);
    assert.match(card.querySelector('.dsh-mmd-pane').textContent, /渲染器出错.*binding failed/);
    const retry = card.querySelector('.dsh-mmd-retry');
    assert.equal(retry.hidden, false);
    failBinding = false;
    retry.click();
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.deepEqual(harness.state.renderCalls, Array(2).fill(harness.code.textContent));
    assert.equal(retry.hidden, true);
  } finally { await harness.cleanup(); }
});

test('restoring a cached preview also restores its live announcement after a superseded render', async () => {
  const harness = await createClientHarness();
  try {
    const card = await openEditor(harness);
    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    setDraft(harness, card, 'flowchart LR\nSLOW-->DRAFT');
    await waitFor(harness, () => harness.state.releaseSlowRender);
    assert.equal(card.querySelector('[role="status"]').textContent, '正在渲染图表…');
    setDraft(harness, card, harness.code.textContent);
    await harness.wait(650);
    harness.state.releaseSlowRender();
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.ok(card.querySelector('.dsh-mmd-pane svg') === oldSvg);
    assert.equal(card.querySelector('[role="status"]').textContent, 'Mermaid 图已渲染。');
    assert.equal(card.querySelector('.dsh-mmd-notice').hidden, true);
  } finally {
    harness.state.releaseSlowRender?.();
    await harness.cleanup();
  }
});
