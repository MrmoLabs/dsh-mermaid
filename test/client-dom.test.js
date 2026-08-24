import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('enhances, updates, switches, and disposes a Mermaid code block', async () => {
  const window = new Window({ url: 'http://localhost/' });
  const previousGlobals = new Map();
  const browserGlobals = {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    CSSStyleSheet: window.CSSStyleSheet,
    MutationObserver: window.MutationObserver,
    navigator: window.navigator,
  };

  for (const [name, value] of Object.entries(browserGlobals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  let dispose;
  try {
    const { apply } = await import(`../src/client.js?dom-test=${Date.now()}`);
    const ctx = {
      effect(callback) {
        dispose = callback();
      },
    };

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    code.textContent = 'flowchart LR\nA-->B';
    pre.appendChild(code);
    document.body.appendChild(pre);

    apply(ctx);
    await wait(1_100);

    const card = document.querySelector('.dsh-mmd');
    assert.ok(card, 'a Mermaid card should be inserted');
    assert.equal(card.nextElementSibling, pre);
    assert.equal(card.dataset.view, 'diagram', card.querySelector('.dsh-mmd-pane')?.textContent);
    assert.equal(card.querySelector('.dsh-mmd-pane')?.dataset.state, 'ok');

    const buttons = card.querySelectorAll('.dsh-mmd-btn');
    buttons[1].click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
    assert.equal(card.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->B');

    code.textContent = 'flowchart LR\nA-->C';
    await wait(700);
    assert.equal(card.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->C');

    const invalidPre = document.createElement('pre');
    const invalidCode = document.createElement('code');
    invalidCode.className = 'language-mermaid';
    invalidCode.textContent = 'flowchart LR\nA-->';
    invalidPre.appendChild(invalidCode);
    document.body.appendChild(invalidPre);
    await wait(1_100);

    const invalidCard = invalidPre.previousElementSibling;
    assert.equal(invalidCard?.className, 'dsh-mmd');
    assert.equal(invalidCard?.dataset.state, 'error');
    assert.equal(invalidCard?.dataset.view, 'code');
    assert.match(invalidCard?.querySelector('.dsh-mmd-error')?.textContent || '', /渲染失败/);
    assert.equal(invalidCard?.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->');

    dispose?.();
    assert.equal(document.querySelector('.dsh-mmd'), null);
    assert.equal(document.getElementById('dsh-mermaid/css'), null);
  } finally {
    dispose?.();
    await window.happyDOM.abort();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
});
