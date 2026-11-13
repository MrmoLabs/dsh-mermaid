import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

async function waitFor(harness, condition) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for the editor state');
    await harness.wait(10);
  }
}

async function openEditor(harness) {
  await waitFor(harness, () => harness.document.querySelector('.dsh-mmd[data-state="ok"]'));
  const card = harness.document.querySelector('.dsh-mmd');
  const editButton = card.querySelectorAll('.dsh-mmd-view-control')[2];
  editButton.click();
  return { card, editButton };
}

function setDraft(harness, card, text) {
  const editor = card.querySelector('.dsh-mmd-textarea');
  editor.value = text;
  editor.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  return editor;
}

function stubClipboard(harness) {
  let copied = null;
  Object.defineProperty(harness.window.navigator, 'clipboard', {
    configurable: true,
    value: {
      async writeText(text) {
        copied = text;
      },
    },
  });
  return () => copied;
}

test('edits in place, keeps the last diagram on errors, and keeps the editor usable', async () => {
  const harness = await createClientHarness();
  const { document } = harness;
  try {
    const { card } = await openEditor(harness);
    const editor = card.querySelector('.dsh-mmd-textarea');
    assert.equal(editor.value, 'flowchart LR\nA-->B');
    assert.equal(card.querySelector('.dsh-mmd-reset').disabled, true);

    const good = 'flowchart LR\nA-->C';
    setDraft(harness, card, good);
    await waitFor(harness, () => card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-source-length') === String(good.length));
    assert.equal(card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-source-length'), String(good.length));
    assert.equal(card.querySelector('.dsh-mmd-reset').disabled, false);
    assert.equal(card.dataset.view, 'edit');

    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    const bad = 'flowchart LR\nA-->';
    setDraft(harness, card, bad);
    await waitFor(harness, () => card.dataset.state === 'error');
    assert.equal(card.dataset.view, 'edit');
    assert.equal(card.querySelector('.dsh-mmd-pane svg'), oldSvg);
    assert.equal(editor.value, bad);
    assert.equal(card.querySelector('.dsh-mmd-notice')?.hidden, false);
    assert.match(card.querySelector('.dsh-mmd-notice')?.textContent || '', /预览未更新/);
    assert.equal(card.querySelectorAll('.dsh-mmd-diagram-action')[0].disabled, true);
    assert.equal(card.querySelectorAll('.dsh-mmd-diagram-action')[1].disabled, true);

    const recovered = 'flowchart LR\nA-->D';
    setDraft(harness, card, recovered);
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-source-length'), String(recovered.length));
    assert.equal(card.querySelector('.dsh-mmd-notice')?.hidden, true);
  } finally {
    await harness.cleanup();
  }
});

test('an empty draft keeps the card', async () => {
  const harness = await createClientHarness();
  const { document } = harness;
  try {
    const { card } = await openEditor(harness);
    const oldSvg = card.querySelector('.dsh-mmd-pane svg');
    setDraft(harness, card, '');
    await waitFor(harness, () => card.dataset.state === 'empty');
    assert.equal(document.querySelector('.dsh-mmd'), card);
    assert.equal(card.querySelector('.dsh-mmd-pane svg'), oldSvg);
    assert.equal(card.querySelector('.dsh-mmd-textarea').value, '');
    assert.match(card.querySelector('.dsh-mmd-notice')?.textContent || '', /源码为空/);
    assert.equal(card.querySelectorAll('.dsh-mmd-diagram-action')[0].disabled, true);
  } finally {
    await harness.cleanup();
  }
});

test('draft survives view switches and message updates; Reset restores the message source', async () => {
  const harness = await createClientHarness();
  const { code, document } = harness;
  try {
    const { card } = await openEditor(harness);
    const draft = 'flowchart LR\nDRAFT-->X';
    setDraft(harness, card, draft);
    await harness.wait(700);

    card.querySelectorAll('.dsh-mmd-view-control')[0].click();
    assert.equal(card.dataset.view, 'code');
    card.querySelectorAll('.dsh-mmd-view-control')[1].click();
    assert.equal(card.dataset.view, 'diagram');
    card.querySelectorAll('.dsh-mmd-view-control')[2].click();
    assert.equal(card.querySelector('.dsh-mmd-textarea').value, draft);

    code.textContent = 'flowchart LR\nMESSAGE-->Y';
    await harness.wait(700);
    assert.equal(card.querySelector('.dsh-mmd-textarea').value, draft);
    assert.equal(card.querySelector('.dsh-mmd-code').textContent, draft);

    card.querySelector('.dsh-mmd-reset').click();
    assert.equal(card.querySelector('.dsh-mmd-textarea').value, code.textContent);
    await waitFor(harness, () => card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-source-length') === String(code.textContent.length));
    assert.equal(card.querySelector('.dsh-mmd-reset').disabled, true);
  } finally {
    await harness.cleanup();
  }
});

test('Copy and .mmd keep the raw draft, and SVG download is disabled while stale', async () => {
  const harness = await createClientHarness();
  const { document, state } = harness;
  try {
    const { card } = await openEditor(harness);
    const readClipboard = stubClipboard(harness);
    const raw = '  %% keep this comment\nflowchart LR\nA-->B   ';
    setDraft(harness, card, raw);
    await harness.wait(700);

    const sourceActions = card.querySelectorAll('.dsh-mmd-source-action');
    sourceActions[0].click();
    await harness.wait(10);
    assert.equal(readClipboard(), raw);
    assert.equal(card.querySelector('[role="status"]')?.textContent, '源码已复制。');

    sourceActions[1].click();
    assert.equal(state.downloadedName, 'mermaid-flowchart.mmd');
    const downloaded = await state.objectUrls.at(-1).text();
    assert.equal(downloaded, raw);

    const svgButton = card.querySelectorAll('.dsh-mmd-diagram-action')[0];
    assert.equal(svgButton.disabled, false);
    setDraft(harness, card, `${raw}\nA-->`);
    assert.equal(svgButton.disabled, true);
    await waitFor(harness, () => card.dataset.state === 'error');
    assert.equal(svgButton.disabled, true);
  } finally {
    await harness.cleanup();
  }
});

test('an initially invalid block is editable and recovers', async () => {
  const harness = await createClientHarness({ initialSource: 'flowchart LR\nA-->' });
  const { document } = harness;
  try {
    await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="error"]'));
    const card = document.querySelector('.dsh-mmd');
    assert.equal(card.dataset.view, 'edit');
    const editor = card.querySelector('.dsh-mmd-textarea');
    assert.equal(editor.value, 'flowchart LR\nA-->');
    assert.equal(card.querySelector('.dsh-mmd-error').textContent.length > 0, true);

    setDraft(harness, card, 'flowchart LR\nA-->OK');
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-source-length'), String('flowchart LR\nA-->OK'.length));
    assert.equal(card.dataset.view, 'edit');
  } finally {
    await harness.cleanup();
  }
});

test('IME composition defers rendering until compositionend', async () => {
  const harness = await createClientHarness();
  const { document, state } = harness;
  try {
    const { card } = await openEditor(harness);
    const editor = card.querySelector('.dsh-mmd-textarea');
    const before = state.renderCalls.length;
    editor.value = 'flowchart LR\n中文-->B';
    editor.dispatchEvent(new harness.window.Event('compositionstart', { bubbles: true }));
    editor.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
    await harness.wait(700);
    assert.equal(state.renderCalls.length, before);
    editor.dispatchEvent(new harness.window.Event('compositionend', { bubbles: true }));
    await waitFor(harness, () => state.renderCalls.length > before);
    assert.equal(state.renderCalls.at(-1), 'flowchart LR\n中文-->B');
  } finally {
    await harness.cleanup();
  }
});
