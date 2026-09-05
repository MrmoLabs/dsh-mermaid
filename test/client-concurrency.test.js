import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

test('debounces streaming updates and serializes stale renders', async () => {
  const harness = await createClientHarness();
  const { code, document, state, wait } = harness;
  try {
    await wait(1_100);
    const card = document.querySelector('.dsh-mmd');
    code.textContent = 'flowchart LR\nA-->C';
    code.textContent = 'flowchart LR\nA-->D';
    code.textContent = 'flowchart LR\nA-->E';
    await wait(700);
    assert.deepEqual(state.renderCalls, ['flowchart LR\nA-->B', 'flowchart LR\nA-->E']);

    document.body.setAttribute('data-ds-dark-theme', '');
    await wait(700);
    assert.equal(state.initializedThemes.at(-1), 'dark');
    assert.equal(state.initializedOptions.at(-1).suppressErrorRendering, true);
    assert.equal(state.initializedOptions.at(-1).maxTextSize, 50_000);
    assert.equal(state.initializedOptions.at(-1).maxEdges, 2_000);

    code.textContent = 'flowchart LR\nSLOW-->Z';
    await wait(600);
    assert.equal(typeof state.releaseSlowRender, 'function');
    code.textContent = 'flowchart LR\nFAST-->Z';
    await wait(600);
    assert.equal(state.renderCalls.includes('flowchart LR\nFAST-->Z'), false);
    state.releaseSlowRender();
    await wait(100);
    assert.equal(card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-render'), 'fast');
    assert.equal(state.maxActiveRenders, 1);
  } finally {
    await harness.cleanup();
  }
});
