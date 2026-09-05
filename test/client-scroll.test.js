import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

function rectWithTop(top) {
  return {
    bottom: top + 28,
    height: 28,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON() { return this; },
  };
}

test('keeps the toolbar fixed when switching inside a scroll container', async () => {
  const harness = await createClientHarness();
  const { document, pre, wait } = harness;
  try {
    await wait(1_100);
    const card = document.querySelector('.dsh-mmd');
    const toolbar = card.querySelector('.dsh-mmd-bar');
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    scroller.scrollTop = 300;
    document.body.appendChild(scroller);
    scroller.append(card, pre);
    toolbar.getBoundingClientRect = () => rectWithTop(card.dataset.view === 'diagram' ? 100 : 340);

    card.querySelectorAll('.dsh-mmd-view-control')[0].click();
    await wait(20);

    assert.equal(card.dataset.view, 'code');
    assert.equal(scroller.scrollTop, 540);
  } finally {
    await harness.cleanup();
  }
});

test('keeps the toolbar fixed when the document is the scroll container', async () => {
  const harness = await createClientHarness();
  const { document, wait, window } = harness;
  try {
    await wait(1_100);
    const card = document.querySelector('.dsh-mmd');
    const toolbar = card.querySelector('.dsh-mmd-bar');
    const scrollCalls = [];
    window.scrollBy = (...args) => scrollCalls.push(args);
    toolbar.getBoundingClientRect = () => rectWithTop(card.dataset.view === 'diagram' ? 120 : -180);

    card.querySelectorAll('.dsh-mmd-view-control')[0].click();
    await wait(20);

    assert.equal(card.dataset.view, 'code');
    assert.deepEqual(scrollCalls, [[0, -300]]);
  } finally {
    await harness.cleanup();
  }
});
