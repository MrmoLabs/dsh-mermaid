import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

test('discovers streamed blocks, remounts removed cards, and cleans up', async () => {
  const harness = await createClientHarness({ initialSource: '' });
  const { code, disposePlugin, document, pre, wait } = harness;
  try {
    await wait(400);
    assert.notEqual(pre.previousElementSibling?.className, 'dsh-mmd');

    code.textContent = 'flowchart LR\nSTREAM-->DONE';
    await wait(1_100);
    const card = pre.previousElementSibling;
    assert.equal(card?.className, 'dsh-mmd');
    assert.equal(card?.dataset.state, 'ok');

    card.remove();
    await wait(1_100);
    const replacementCard = pre.previousElementSibling;
    assert.equal(replacementCard?.className, 'dsh-mmd');
    assert.notEqual(replacementCard, card);
    assert.equal(replacementCard?.dataset.state, 'ok');

    disposePlugin();
    assert.equal(document.querySelector('.dsh-mmd'), null);
    assert.equal(document.querySelector('.dsh-mmd-viewer'), null);
    assert.equal(document.getElementById('dsh-mermaid/css'), null);
  } finally {
    await harness.cleanup();
  }
});
