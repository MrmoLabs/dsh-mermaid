import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';
import { preserveViewPosition } from '../src/scroll.js';

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

test('reconciles the host tail action only after a collapse lands at the floor', async (t) => {
  const harness = await createClientHarness({ initialSource: null });
  const { document, wait } = harness;
  try {
    for (const scenario of [
      { name: 'Chinese host, content fits without scrolling', label: '回到底部', floor: 0, top: 0, after: 200, calls: 1 },
      { name: 'English host, clamped to a nonzero floor', label: 'Back to bottom', floor: 120, top: 120, after: 200, calls: 1 },
      { name: 'reader still has content below', label: '回到底部', floor: 120, top: 40, after: 200, calls: 0 },
      { name: 'expanding a diagram retains reader ownership', label: '回到底部', floor: 0, top: 0, after: 800, calls: 0 },
      { name: 'unknown host action is untouched', label: 'Different action', floor: 0, top: 0, after: 200, calls: 0 },
      { name: 'unmounted card cancels pending reconciliation', label: '回到底部', floor: 0, top: 0, after: 200, calls: 0, detach: true },
      { name: 'superseded view change cancels pending reconciliation', label: '回到底部', floor: 0, top: 0, after: 200, calls: 0, supersede: true },
    ]) {
      await t.test(scenario.name, async () => {
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperties(scroller, {
          clientHeight: { value: 400 },
          scrollHeight: { value: 400 + scenario.floor },
        });
        scroller.scrollTop = scenario.top;
        const slot = document.createElement('div');
        slot.dataset.slot = 'conversation.view';
        const wrapper = document.createElement('div');
        const bar = document.createElement('div');
        wrapper.append(bar);
        const button = document.createElement('button');
        button.setAttribute('aria-label', scenario.label);
        let calls = 0;
        button.onclick = () => { calls += 1; };
        slot.append(wrapper, button);
        scroller.append(slot);
        document.body.append(scroller);
        let height = 600;
        wrapper.getBoundingClientRect = () => ({ ...rectWithTop(100), height });
        bar.getBoundingClientRect = () => rectWithTop(100);
        const entry = { wrapper, bar, viewAdjustment: 0 };
        preserveViewPosition(entry, () => { height = scenario.after; });
        if (scenario.detach) wrapper.remove();
        if (scenario.supersede) entry.viewAdjustment += 1;
        await wait(20);
        assert.equal(calls, scenario.calls);
        assert.equal(scroller.scrollTop, scenario.top, 'reconciliation must not move the reader');
        scroller.remove();
      });
    }
    const unrelated = document.createElement('button');
    unrelated.setAttribute('aria-label', 'Back to bottom');
    let calls = 0;
    unrelated.onclick = () => { calls += 1; };
    document.body.append(unrelated);
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    let height = 600;
    wrapper.getBoundingClientRect = () => ({ ...rectWithTop(100), height });
    preserveViewPosition({ wrapper, bar: wrapper, viewAdjustment: 0 }, () => { height = 200; });
    await wait(20);
    assert.equal(calls, 0, 'actions outside the current Chat slot must never be invoked');
  } finally {
    await harness.cleanup();
  }
});
