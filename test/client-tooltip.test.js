import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

function addTooltip(document) {
  let tip = document.querySelector('.mermaidTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'mermaidTooltip';
    tip.style.cssText = 'position:absolute;opacity:0;padding:2px;border:1px solid';
    document.body.append(tip);
  }
  return tip;
}

test('positions native tooltip after binding and retains its node safely after plugin disposal', async () => {
  let bindings = 0;
  const harness = await createClientHarness({ bindFunctions(svg) {
    assert.equal(svg.localName, 'svg', 'this fix must preserve the existing bind target');
    bindings += 1;
    addTooltip(svg.ownerDocument);
  } });
  try {
    await harness.wait(1100);
    const tip = harness.document.querySelector('.mermaidTooltip');
    assert.ok(tip.classList.contains('dsh-mmd-tooltip-fixed'));
    assert.equal(harness.window.getComputedStyle(tip).position, 'fixed');
    harness.code.textContent = 'flowchart LR\nA-->CHANGED';
    await harness.wait(700);
    assert.equal(bindings, 2);
    assert.equal(harness.document.querySelectorAll('.mermaidTooltip').length, 1);
    harness.disposePlugin();
    assert.ok(tip.isConnected);
    assert.equal(tip.classList.contains('dsh-mmd-tooltip-fixed'), false);
    assert.equal(tip.style.top, '0px');
    assert.equal(tip.style.left, '0px');
  } finally { await harness.cleanup(); }
});

test('also positions a tooltip left by a failing native binding', async () => {
  const harness = await createClientHarness({ bindFunctions(svg) {
    addTooltip(svg.ownerDocument);
    throw new Error('binding failed');
  } });
  try {
    await harness.wait(1100);
    assert.equal(harness.document.querySelector('.dsh-mmd').dataset.state, 'error');
    assert.ok(harness.document.querySelector('.mermaidTooltip').classList.contains('dsh-mmd-tooltip-fixed'));
  } finally { await harness.cleanup(); }
});

test('a render completing after disposal cannot bind or recreate tooltip resources', async () => {
  let bindings = 0;
  const harness = await createClientHarness({ initialSource: 'flowchart LR\nA-->SLOW', bindFunctions(svg) {
    bindings += 1;
    addTooltip(svg.ownerDocument);
  } });
  try {
    await harness.wait(1100);
    assert.equal(typeof harness.state.releaseSlowRender, 'function');
    harness.disposePlugin();
    harness.state.releaseSlowRender();
    await harness.wait(30);
    assert.equal(bindings, 0);
    assert.equal(harness.document.querySelector('.mermaidTooltip'), null);
    assert.equal(harness.document.querySelector('.dsh-mmd'), null);
  } finally { await harness.cleanup(); }
});
