import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

async function waitFor(harness, condition) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for client state');
    await harness.wait(10);
  }
}

function diagramActions(card) {
  return card.querySelectorAll('.dsh-mmd-diagram-action');
}

test('view controls work before the first runtime import', async () => {
  const harness = await createClientHarness({ injectRuntime: false });
  try {
    const { document, window } = harness;
    const errors = [];
    window.addEventListener('error', (event) => {
      errors.push(event.error);
      event.preventDefault();
    });
    await waitFor(harness, () => document.querySelector('.dsh-mmd'));
    const card = document.querySelector('.dsh-mmd');
    assert.equal(card.querySelector('svg'), null);
    const [codeButton, diagramButton] = card.querySelectorAll('.dsh-mmd-view-control');
    codeButton.click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(codeButton.getAttribute('aria-pressed'), 'true');
    diagramButton.click();
    assert.equal(card.dataset.view, 'diagram');
    assert.deepEqual(errors, []);
  } finally { await harness.cleanup(); }
});

test('clearing a rendered source removes its stale card and fullscreen, then permits streaming again', async (t) => {
  for (const empty of ['', '  \n  ']) {
    await t.test(JSON.stringify(empty), async () => {
      const harness = await createClientHarness();
      try {
        const { code, document, pre, state, window } = harness;
        await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="ok"]'));
        const card = document.querySelector('.dsh-mmd');
        diagramActions(card)[1].click();
        const viewer = document.querySelector('.dsh-mmd-viewer');
        assert.equal(viewer.hidden, false);
        const renderCount = state.renderCalls.length;
        code.textContent = empty;
        await waitFor(harness, () => !document.querySelector('.dsh-mmd'));
        assert.equal(viewer.hidden, true);
        assert.equal(viewer.querySelector('svg'), null);
        assert.equal(document.body.style.overflow, '');
        assert.equal(pre.inert, false);
        assert.notEqual(window.getComputedStyle(pre).display, 'none');
        assert.equal(state.renderCalls.length, renderCount);

        code.textContent = 'flowchart LR\nRESTORED-->DONE';
        await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="ok"]'));
        assert.equal(document.querySelectorAll('.dsh-mmd').length, 1);
        assert.notEqual(document.querySelector('.dsh-mmd'), card);
        assert.equal(document.querySelector('.dsh-mmd-code').textContent, code.textContent);
      } finally { await harness.cleanup(); }
    });
  }
});

test('clearing source invalidates an in-flight render without waiting for the render queue', async () => {
  const harness = await createClientHarness({ initialSource: 'flowchart LR\nSLOW-->Z' });
  try {
    const { code, document, state } = harness;
    await waitFor(harness, () => state.releaseSlowRender);
    code.textContent = '';
    await waitFor(harness, () => !document.querySelector('.dsh-mmd'));
    state.releaseSlowRender();
    await harness.wait(50);
    assert.equal(document.querySelector('.dsh-mmd'), null);
    assert.equal(document.querySelector('svg'), null);
    code.textContent = 'flowchart LR\nFAST-->Z';
    await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="ok"]'));
    assert.equal(document.querySelector('svg').getAttribute('data-render'), 'fast');
  } finally {
    harness.state.releaseSlowRender?.();
    await harness.cleanup();
  }
});

test('parse errors and source limits close fullscreen but keep the last diagram editable', async (t) => {
  for (const source of ['flowchart LR\nA-->', `flowchart LR\n${'A'.repeat(50_001)}`, `flowchart LR\n${'A-->B\n'.repeat(2_001)}`]) {
    await t.test(source.length > 100 ? `source limit ${source.length}` : 'parse error', async () => {
      const harness = await createClientHarness();
      try {
        const { code, document, pre } = harness;
        await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="ok"]'));
        const card = document.querySelector('.dsh-mmd');
        const actions = diagramActions(card);
        const oldSvg = card.querySelector('.dsh-mmd-pane svg');
        actions[1].click();
        const viewer = document.querySelector('.dsh-mmd-viewer');
        assert.equal(viewer.hidden, false);
        code.textContent = source;
        await waitFor(harness, () => card.dataset.state === 'error');
        assert.equal(viewer.hidden, true);
        assert.equal(viewer.querySelector('svg'), null);
        assert.equal(document.body.style.overflow, '');
        assert.equal(pre.inert, false);
        assert.equal(card.dataset.view, 'diagram');
        assert.equal(card.querySelector('.dsh-mmd-pane svg'), oldSvg);
        assert.equal(card.querySelector('.dsh-mmd-notice')?.hidden, false);
        assert.match(card.querySelector('.dsh-mmd-notice')?.textContent || '', /预览未更新/);
        assert.equal(actions[0].disabled, true);
        assert.equal(actions[1].disabled, true);
        assert.equal(card.querySelector('.dsh-mmd-textarea')?.value, source);
        code.textContent = 'flowchart LR\nRECOVERED-->DONE';
        await waitFor(harness, () => card.dataset.state === 'ok');
        actions[1].click();
        assert.equal(viewer.hidden, false);
        assert.ok(viewer.querySelector('svg'));
      } finally { await harness.cleanup(); }
    });
  }
});

test('a superseded render error cannot close the fullscreen viewer for a newer source', async () => {
  const harness = await createClientHarness();
  try {
    const { code, document, state } = harness;
    await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="ok"]'));
    const card = document.querySelector('.dsh-mmd');
    diagramActions(card)[1].click();
    const viewer = document.querySelector('.dsh-mmd-viewer');
    code.textContent = 'flowchart LR\nSLOW-->Z';
    await waitFor(harness, () => state.rejectSlowRender);
    code.textContent = 'flowchart LR\nFAST-->Z';
    await harness.wait(10);
    state.rejectSlowRender();
    await harness.wait(50);
    assert.equal(viewer.hidden, false);
    assert.notEqual(card.dataset.state, 'error');
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(viewer.querySelector('svg').getAttribute('data-render'), 'fast');
  } finally {
    harness.state.releaseSlowRender?.();
    await harness.cleanup();
  }
});
