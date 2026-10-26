import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createTooltipPositioner } from '../src/tooltip.js';

function fixture() {
  const window = new Window();
  const { document } = window;
  const tip = document.createElement('div');
  tip.className = 'mermaidTooltip';
  tip.style.cssText = 'position:absolute;opacity:0;padding:2px;border:1px solid';
  document.body.append(tip);
  return { window, document, tip, close: () => window.happyDOM.close() };
}

test('shares positioning across instances and module reloads until the last release', async () => {
  const { window, document, tip, close } = fixture();
  const copiedModule = await import('../src/tooltip.js?independent-module');
  const first = createTooltipPositioner(document);
  const second = copiedModule.createTooltipPositioner(document);
  try {
    first.trackCurrent();
    first.trackCurrent();
    second.trackCurrent();
    assert.equal(document.querySelectorAll('.mermaidTooltip').length, 1);
    assert.equal(document.querySelectorAll('style[data-dsh-mmd-tooltip]').length, 1);
    first.dispose();
    first.dispose();
    assert.ok(tip.classList.contains('dsh-mmd-tooltip-fixed'));
    assert.equal(document.querySelectorAll('style[data-dsh-mmd-tooltip]').length, 1);
    second.dispose();
    assert.ok(tip.isConnected);
    assert.equal(tip.classList.contains('dsh-mmd-tooltip-fixed'), false);
    assert.equal(tip.style.left, '0px');
    assert.equal(tip.style.top, '0px');
    assert.equal(document.querySelectorAll('style[data-dsh-mmd-tooltip]').length, 0);
    assert.equal(Object.getOwnPropertySymbols(document).filter((key) => String(key).includes('tooltip-positioning')).length, 0);
    const third = createTooltipPositioner(document);
    third.trackCurrent();
    assert.ok(tip.classList.contains('dsh-mmd-tooltip-fixed'));
    third.dispose();
  } finally {
    first.dispose();
    second.dispose();
    await close();
  }
});

test('preserves shared contents, bindings and positioned coordinates, including pending fade-in', async () => {
  const { document, tip, close, window } = fixture();
  const positions = createTooltipPositioner(document);
  let events = 0;
  tip.textContent = 'Another renderer';
  tip.style.left = '500px';
  tip.style.top = '350px';
  tip.addEventListener('probe', () => { events += 1; });
  try {
    positions.trackCurrent();
    positions.dispose();
    assert.equal(tip.textContent, 'Another renderer');
    assert.equal(tip.style.left, '500px');
    assert.equal(tip.style.top, '350px');
    tip.dispatchEvent(new window.Event('probe'));
    assert.equal(events, 1);
  } finally { positions.dispose(); await close(); }
});

test('composes custom translate and preserves original priorities and transform', async () => {
  const { document, tip, close } = fixture();
  const positions = createTooltipPositioner(document);
  tip.style.setProperty('translate', 'calc(50% - 4px) 6px 2px', 'important');
  tip.style.transform = 'scale(0.9)';
  tip.style.setProperty('--dsh-mmd-tooltip-offset-x', '19px', 'important');
  const original = tip.style.getPropertyValue('translate');
  try {
    positions.trackCurrent();
    assert.ok(tip.style.getPropertyValue('translate').includes('calc(50% - 4px)'));
    assert.ok(tip.style.getPropertyValue('translate').includes('var(--dsh-mmd-tooltip-offset-y)'));
    assert.equal(tip.style.transform, 'scale(0.9)');
    positions.dispose();
    assert.equal(tip.style.getPropertyValue('translate'), original);
    assert.equal(tip.style.getPropertyPriority('translate'), 'important');
    assert.equal(tip.style.getPropertyValue('--dsh-mmd-tooltip-offset-x'), '19px');
    assert.equal(tip.style.getPropertyPriority('--dsh-mmd-tooltip-offset-x'), 'important');
    assert.equal(tip.style.transform, 'scale(0.9)');
  } finally { positions.dispose(); await close(); }
});

test('does not overwrite properties taken over by another writer during positioning or release', async () => {
  const { document, tip, window, close } = fixture();
  const positions = createTooltipPositioner(document);
  try {
    positions.trackCurrent();
    tip.style.setProperty('--dsh-mmd-tooltip-offset-x', '42px');
    tip.style.setProperty('translate', '8px 9px');
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(tip.style.getPropertyValue('--dsh-mmd-tooltip-offset-x'), '42px');
    positions.dispose();
    assert.equal(tip.style.getPropertyValue('--dsh-mmd-tooltip-offset-x'), '42px');
    assert.equal(tip.style.getPropertyValue('translate'), '8px 9px');
  } finally { positions.dispose(); await close(); }
});

test('tracks replacement nodes and ignores late binding after disposal', async () => {
  const { document, tip, close } = fixture();
  const positions = createTooltipPositioner(document);
  try {
    positions.trackCurrent();
    tip.remove();
    const replacement = document.createElement('div');
    replacement.className = 'mermaidTooltip';
    replacement.style.opacity = '0';
    document.body.append(replacement);
    positions.trackCurrent();
    assert.equal(tip.classList.contains('dsh-mmd-tooltip-fixed'), false);
    assert.ok(replacement.classList.contains('dsh-mmd-tooltip-fixed'));
    positions.dispose();
    positions.trackCurrent();
    assert.equal(replacement.classList.contains('dsh-mmd-tooltip-fixed'), false);
    assert.equal(document.querySelectorAll('.mermaidTooltip').length, 1);
  } finally { positions.dispose(); await close(); }
});

test('updates document offsets through nested scroll events and removes every registered listener', async () => {
  const { document, tip, window, close } = fixture();
  const active = new Map();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, callback, options) => {
      const key = `${target === window ? 'window' : 'document'}:${type}`;
      active.set(key, callback);
      add(type, callback, options);
    };
    target.removeEventListener = (type, callback, options) => {
      const key = `${target === window ? 'window' : 'document'}:${type}`;
      if (active.get(key) === callback) active.delete(key);
      remove(type, callback, options);
    };
  }
  const positions = createTooltipPositioner(document);
  try {
    positions.trackCurrent();
    assert.equal(active.size, 3);
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 30 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 180 });
    const nested = document.createElement('div');
    document.body.append(nested);
    nested.dispatchEvent(new window.Event('scroll'));
    assert.equal(tip.style.getPropertyValue('--dsh-mmd-tooltip-offset-x'), '-30px');
    assert.equal(tip.style.getPropertyValue('--dsh-mmd-tooltip-offset-y'), '-180px');
    positions.dispose();
    assert.equal(active.size, 0);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(tip.style.getPropertyValue('--dsh-mmd-tooltip-offset-y'), '');
  } finally { positions.dispose(); await close(); }
});
