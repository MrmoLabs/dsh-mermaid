import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createClientHarness } from '../test-support/client-harness.js';

async function waitFor(harness, condition) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for client state');
    await harness.wait(10);
  }
}

test('groups repeated diagnostics for the same target without copying source', async () => {
  const failure = 'private Mermaid input';
  const harness = await createClientHarness({
    initialSource: 'flowchart LR\nA[private source]-->B',
    renderRuntime() { throw new Error(failure); },
  });
  try {
    let copied;
    Object.defineProperty(harness.window.navigator, 'clipboard', { value: { writeText(text) { copied = text; } } });
    const card = () => harness.document.querySelector('.dsh-mmd');
    await waitFor(harness, () => card()?.dataset.state === 'error');
    card().querySelector('.dsh-mmd-retry').click();
    await waitFor(harness, () => card()?.dataset.state === 'error');
    card().querySelector('.dsh-mmd-diagnostics').click();
    assert.equal(JSON.parse(copied).retryAttempts, 1);
    assert.deepEqual(JSON.parse(copied).failures, [{ stage: 'render', outcome: 'runtimeRenderFailed', occurrences: 2 }]);
    assert.doesNotMatch(copied, /private/);
  } finally {
    await harness.cleanup();
  }
});

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
    const [diagramButton, codeButton] = card.querySelectorAll('.dsh-mmd-view-control');
    codeButton.click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(codeButton.getAttribute('aria-pressed'), 'true');
    diagramButton.click();
    assert.equal(card.dataset.view, 'diagram');
    assert.deepEqual(errors, []);
  } finally { await harness.cleanup(); }
});

test('retries a failed runtime import without changing source or view', async () => {
  const loads = [];
  const moduleSource = `export default { initialize() {} };
    export async function renderMermaid(id, source) {
      return { svg: '<svg><text>' + source + '</text></svg>' };
    }`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!specifier.startsWith('/dsh-mermaid/runtime/development/')) return nextResolve(specifier, context);
      loads.push(specifier);
      if (loads.length === 1) throw new Error('synthetic runtime load failure');
      return { url: 'data:text/javascript,' + encodeURIComponent(moduleSource), shortCircuit: true };
    },
  });
  let harness;
  try {
    harness = await createClientHarness({ initialSource: 'flowchart LR\nA', injectRuntime: false });
    const { code, document } = harness;
    await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="error"]'));
    const card = document.querySelector('.dsh-mmd');
    const retry = card.querySelector('.dsh-mmd-retry');
    const [diagramButton, codeButton] = card.querySelectorAll('.dsh-mmd-view-control');
    assert.equal(card.dataset.view, 'diagram');
    assert.match(card.querySelector('.dsh-mmd-pane').textContent, /渲染器加载失败/);
    assert.equal(retry.hidden, false);
    assert.equal(retry.textContent, '重试渲染');
    assert.equal(diagramActions(card)[0].disabled, true);

    codeButton.click();
    assert.match(card.querySelector('.dsh-mmd-error').textContent, /渲染器加载失败/);
    retry.focus();
    retry.click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(card.dataset.state, 'rendering');
    assert.equal(document.activeElement, codeButton);
    assert.equal(retry.hidden, true);
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.deepEqual(loads, ['/dsh-mermaid/runtime/development/0/mermaid-runtime.js', '/dsh-mermaid/runtime/development/1/mermaid-runtime.js']);
    assert.equal(card.querySelector('.dsh-mmd-code').textContent, code.textContent);
    assert.equal(card.querySelector('svg text').textContent, code.textContent);
    diagramButton.click();
    assert.equal(diagramActions(card)[0].disabled, false);
    assert.equal(retry.hidden, true);
  } finally {
    await harness?.cleanup();
    hooks.deregister();
  }
});

test('reports an empty rendered diagram and keeps its source editable', async () => {
  const harness = await createClientHarness({ initialSource: 'flowchart LR' });
  try {
    const { document, pre, window } = harness;
    await waitFor(harness, () => pre.previousElementSibling?.dataset.state === 'empty');
    const card = pre.previousElementSibling;
    const pane = card.querySelector('.dsh-mmd-pane');
    assert.equal(pane.textContent, '图表为空。');
    assert.equal(pane.querySelector('svg'), null);
    assert.equal(card.querySelector('.dsh-mmd-retry').hidden, true);
    assert.ok([...diagramActions(card)].every((button) => button.disabled));

    document.documentElement.lang = 'en';
    await waitFor(harness, () => pane.textContent === 'The diagram is empty.');
    card.querySelectorAll('.dsh-mmd-view-control')[2].click();
    const editor = card.querySelector('textarea');
    assert.equal(editor.value, 'flowchart LR');
    editor.value = 'flowchart LR\nA-->B';
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    await waitFor(harness, () => card.dataset.state === 'ok');
    const oldSvg = pane.querySelector('svg');
    assert.ok(oldSvg);

    editor.value = 'flowchart LR';
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    await waitFor(harness, () => card.dataset.state === 'empty');
    assert.equal(pane.querySelector('svg'), oldSvg);
    assert.equal(pane.dataset.state, 'stale');
    assert.equal(card.querySelector('.dsh-mmd-notice').textContent, 'The diagram is empty. The last successful preview is still shown.');
    assert.ok([...diagramActions(card)].every((button) => button.disabled));
  } finally { await harness.cleanup(); }
});

test('a legacy incomplete fence stays in Diagram and can be inspected or completed', async () => {
  const harness = await createClientHarness({ initialSource: '\nflowchart LR\nA-->', incompleteSource: true });
  try {
    const { code, document } = harness;
    await waitFor(harness, () => document.querySelector('.dsh-mmd[data-state="pending"]'));
    const card = document.querySelector('.dsh-mmd');
    assert.equal(card.dataset.view, 'diagram');
    assert.match(card.querySelector('.dsh-mmd-pane').textContent, /尚未写完/);
    assert.equal(card.querySelector('.dsh-mmd-error-details').hidden, true);
    code.textContent += 'B';
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(card.dataset.view, 'diagram');

    code.textContent = '\nflowchart LR\nA-->';
    await waitFor(harness, () => card.dataset.state === 'pending');
    card.querySelector('[data-view="edit"]').click();
    await waitFor(harness, () => card.dataset.state === 'error');
    assert.match(card.querySelector('.dsh-mmd-notice').textContent, /第 3 行/);
    const details = card.querySelector('.dsh-mmd-error-details');
    assert.equal(details.hidden, false);
    assert.equal(details.open, false);
    assert.equal(details.querySelector('pre').textContent, 'synthetic Mermaid failure');
  } finally { await harness.cleanup(); }
});

test('updates source in Code view and defers layout until Diagram is opened', async () => {
  const harness = await createClientHarness();
  try {
    const { code, pre, state } = harness;
    await waitFor(harness, () => pre.previousElementSibling?.dataset.state === 'ok');
    const card = pre.previousElementSibling;
    const [showDiagram, showCode] = card.querySelectorAll('.dsh-mmd-view-control');
    showCode.click();
    const updated = 'flowchart LR\nA-->C';
    code.textContent = updated;
    await waitFor(harness, () => card.dataset.state === 'pending');
    await harness.wait(650);
    assert.equal(card.querySelector('.dsh-mmd-code').textContent, updated);
    assert.equal(diagramActions(card)[0].disabled, true);
    assert.equal(state.renderCalls.length, 1);
    showDiagram.click();
    await waitFor(harness, () => card.dataset.state === 'ok');
    assert.equal(state.renderCalls.at(-1), updated);
    assert.equal(state.renderCalls.length, 2);
  } finally { await harness.cleanup(); }
});

test('offers the same-source retry after runtime initialization, drawing, or output fails', async (t) => {
  for (const stage of ['initialize', 'draw', 'svg']) {
    await t.test(stage, async () => {
      let fail = true;
      const harness = await createClientHarness({
        initializeRuntime() {
          if (stage === 'initialize' && fail) throw new Error('initialize failed');
        },
        renderRuntime() {
          if (stage === 'draw' && fail) throw new Error('drawing failed');
          if (stage === 'svg' && fail) return { svg: '' };
          return { svg: '<svg><rect width="20" height="20"></rect></svg>' };
        },
      });
      try {
        const { pre, code, state } = harness;
        await waitFor(harness, () => pre.previousElementSibling?.dataset.state === 'error');
        const card = pre.previousElementSibling;
        const retry = card.querySelector('.dsh-mmd-retry');
        assert.equal(card.dataset.view, 'diagram');
        assert.match(card.querySelector('.dsh-mmd-pane').textContent, /渲染器(?:出错|未返回 SVG)/);
        assert.equal(retry.hidden, false);
        assert.ok([...diagramActions(card)].every((button) => button.disabled));
        fail = false;
        retry.click();
        await waitFor(harness, () => card.dataset.state === 'ok');
        assert.deepEqual(state.renderCalls, Array(stage === 'initialize' ? 1 : 2).fill(code.textContent));
        assert.equal(retry.hidden, true);
        assert.ok(card.querySelector('svg rect'));
      } finally { await harness.cleanup(); }
    });
  }
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
