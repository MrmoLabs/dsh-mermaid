import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('handles the Mermaid card lifecycle, themes, and stale renders', async () => {
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
    Blob: window.Blob,
    URL: window.URL,
  };

  for (const [name, value] of Object.entries(browserGlobals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  let dispose;
  let restoreMermaidRuntime;
  try {
    document.documentElement.lang = 'zh-CN';
    const objectUrls = [];
    const revokedUrls = [];
    let downloadedName = '';
    window.URL.createObjectURL = (blob) => {
      objectUrls.push(blob);
      return `blob:test-${objectUrls.length}`;
    };
    window.URL.revokeObjectURL = (url) => revokedUrls.push(url);
    window.HTMLAnchorElement.prototype.click = function click() {
      downloadedName = this.download;
    };
    const { apply, setMermaidRuntimeForTesting } = await import(`../src/client.js?dom-test=${Date.now()}`);
    const renderCalls = [];
    const initializedThemes = [];
    const initializedOptions = [];
    let releaseSlowRender;
    let activeRenders = 0;
    let maxActiveRenders = 0;
    restoreMermaidRuntime = setMermaidRuntimeForTesting({
      initialize(options) {
        initializedThemes.push(options.theme);
        initializedOptions.push(options);
      },
      async render(_id, source) {
        renderCalls.push(source);
        activeRenders += 1;
        maxActiveRenders = Math.max(maxActiveRenders, activeRenders);
        try {
          if (source.endsWith('-->')) throw new Error('synthetic Mermaid failure');
          if (source.includes('SLOW')) {
            return await new Promise((resolve) => {
              releaseSlowRender = () => resolve({ svg: '<svg data-render="slow"></svg>' });
            });
          }
          const renderName = source.includes('FAST') ? 'fast' : 'normal';
          return {
            svg: `<svg id="diagram" data-render="${renderName}" data-source-length="${source.length}"><defs><marker id="arrow"><path></path></marker></defs><path class="node" marker-end="url(#arrow)"></path></svg>`,
          };
        } finally {
          activeRenders -= 1;
        }
      },
    });
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
    assert.equal(card.querySelectorAll('.dsh-mmd-pane svg').length, 1);
    const originalSvg = card.querySelector('.dsh-mmd-pane svg');
    assert.equal(card.querySelector('.dsh-mmd-label')?.textContent, 'Mermaid 图');
    assert.equal(card.querySelector('[role="status"]')?.textContent, 'Mermaid 图已渲染。');
    assert.equal(originalSvg?.getAttribute('role'), 'img');
    assert.equal(originalSvg?.querySelector('title')?.textContent, 'Mermaid flowchart 图');
    assert.equal(originalSvg?.getAttribute('aria-labelledby'), originalSvg?.querySelector('title')?.id);
    assert.deepEqual(renderCalls, ['flowchart LR\nA-->B']);

    const embeddedStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    embeddedStyle.textContent = '#diagram .node{fill:red}.edge{marker-end:url(#arrow)}';
    originalSvg.prepend(embeddedStyle);

    const buttons = card.querySelectorAll('.dsh-mmd-btn');
    buttons[2].click();
    const viewer = document.querySelector('.dsh-mmd-viewer');
    assert.ok(viewer);
    assert.equal(viewer.hidden, false);
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(window.getComputedStyle(viewer).backgroundColor, '#fff');
    assert.equal(viewer.querySelectorAll('.dsh-mmd-viewer-stage svg').length, 1);
    const originalMarkerId = card.querySelector('.dsh-mmd-pane marker')?.id;
    const viewerSvg = viewer.querySelector('.dsh-mmd-viewer-stage svg');
    const viewerMarker = viewerSvg?.querySelector('marker');
    assert.ok(originalMarkerId);
    assert.notEqual(viewerSvg?.id, card.querySelector('.dsh-mmd-pane svg')?.id);
    assert.ok(viewerMarker?.id);
    assert.notEqual(viewerMarker.id, originalMarkerId);
    assert.equal(
      viewer.querySelector('.dsh-mmd-viewer-stage path[marker-end]')?.getAttribute('marker-end'),
      `url(#${viewerMarker.id})`,
    );
    assert.match(viewerSvg?.querySelector('style')?.textContent || '', new RegExp(`#${viewerSvg.id} \\.node`));
    assert.match(viewerSvg?.querySelector('style')?.textContent || '', new RegExp(`url\\(#${viewerMarker.id}\\)`));
    assert.doesNotMatch(viewerSvg?.querySelector('style')?.textContent || '', /#diagram\b/);
    viewer.querySelector('[aria-label="放大"]')?.click();
    assert.notEqual(viewer.querySelector('[aria-label="恢复到 100%"]')?.textContent, '100%');
    const viewport = viewer.querySelector('.dsh-mmd-viewer-viewport');
    viewport.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1_000, height: 800, right: 1_000, bottom: 800, x: 0, y: 0,
      toJSON() { return this; },
    });
    const transformBeforeCursorZoom = viewer.querySelector('.dsh-mmd-viewer-stage')?.style.transform;
    viewport.dispatchEvent(new window.WheelEvent('wheel', {
      deltaY: -100, clientX: 800, clientY: 400, bubbles: true, cancelable: true,
    }));
    const transformAfterCursorZoom = viewer.querySelector('.dsh-mmd-viewer-stage')?.style.transform || '';
    assert.notEqual(transformAfterCursorZoom, transformBeforeCursorZoom);
    assert.doesNotMatch(transformAfterCursorZoom, /translate\(0px,0px\)/);
    assert.notEqual(viewer.querySelector('[aria-label="恢复到 100%"]')?.textContent, '100%');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(viewer.hidden, true);
    assert.equal(document.body.style.overflow, '');

    buttons[3].click();
    assert.equal(card.querySelector('.dsh-mmd-menu'), null);
    assert.equal(downloadedName, 'mermaid-flowchart.svg');
    assert.equal(card.querySelector('[role="status"]')?.textContent, 'SVG 已下载。');
    assert.equal(objectUrls.length, 1);
    assert.equal(objectUrls[0].type, 'image/svg+xml;charset=utf-8');
    await wait(10);
    assert.deepEqual(revokedUrls, ['blob:test-1']);

    buttons[1].click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
    assert.equal(card.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->B');

    code.textContent = 'flowchart LR\nA-->C';
    code.textContent = 'flowchart LR\nA-->D';
    code.textContent = 'flowchart LR\nA-->E';
    await wait(700);
    assert.equal(card.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->E');
    assert.deepEqual(renderCalls, ['flowchart LR\nA-->B', 'flowchart LR\nA-->E']);

    document.body.setAttribute('data-ds-dark-theme', '');
    await wait(700);
    assert.equal(window.getComputedStyle(viewer).backgroundColor, '#121212');
    assert.deepEqual(renderCalls, [
      'flowchart LR\nA-->B',
      'flowchart LR\nA-->E',
      'flowchart LR\nA-->E',
    ]);
    assert.equal(initializedThemes.at(-1), 'dark');
    assert.equal(initializedOptions.at(-1).suppressErrorRendering, true);
    assert.equal(initializedOptions.at(-1).maxTextSize, 50_000);
    assert.equal(initializedOptions.at(-1).maxEdges, 2_000);

    document.documentElement.lang = 'en-US';
    await wait(10);
    assert.equal(card.querySelector('.dsh-mmd-label')?.textContent, 'Mermaid diagram');
    assert.equal(buttons[0].textContent, 'Diagram');
    document.documentElement.lang = 'zh-CN';
    await wait(10);

    code.textContent = 'flowchart LR\nSLOW-->Z';
    await wait(600);
    assert.equal(typeof releaseSlowRender, 'function');
    code.textContent = 'flowchart LR\nFAST-->Z';
    await wait(600);
    assert.equal(renderCalls.includes('flowchart LR\nFAST-->Z'), false);
    releaseSlowRender();
    await wait(100);
    assert.equal(card.querySelector('.dsh-mmd-pane svg')?.getAttribute('data-render'), 'fast');
    assert.equal(maxActiveRenders, 1);

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
    assert.equal(invalidCard?.querySelector('[role="status"]')?.textContent, '图表渲染失败，已显示源代码。');

    const oversizedPre = document.createElement('pre');
    const oversizedCode = document.createElement('code');
    oversizedCode.className = 'language-mermaid';
    oversizedCode.textContent = `flowchart LR\n${'A-->B\n'.repeat(2_001)}`;
    oversizedPre.appendChild(oversizedCode);
    document.body.appendChild(oversizedPre);
    const renderCountBeforeOversized = renderCalls.length;
    await wait(1_100);

    const oversizedCard = oversizedPre.previousElementSibling;
    assert.equal(oversizedCard?.className, 'dsh-mmd');
    assert.equal(oversizedCard?.dataset.state, 'error');
    assert.equal(oversizedCard?.dataset.view, 'code');
    assert.match(oversizedCard?.querySelector('.dsh-mmd-error')?.textContent || '', /2000 行/);
    assert.equal(renderCalls.length, renderCountBeforeOversized);

    const streamingPre = document.createElement('pre');
    const streamingCode = document.createElement('code');
    streamingCode.className = 'language-mermaid';
    streamingPre.appendChild(streamingCode);
    document.body.appendChild(streamingPre);
    await wait(400);
    assert.notEqual(streamingPre.previousElementSibling?.className, 'dsh-mmd');
    streamingCode.textContent = 'flowchart LR\nSTREAM-->DONE';
    await wait(1_100);

    const streamingCard = streamingPre.previousElementSibling;
    assert.equal(streamingCard?.className, 'dsh-mmd');
    assert.equal(streamingCard?.dataset.state, 'ok');

    streamingCard.remove();
    await wait(1_100);
    const replacementCard = streamingPre.previousElementSibling;
    assert.equal(replacementCard?.className, 'dsh-mmd');
    assert.notEqual(replacementCard, streamingCard);
    assert.equal(replacementCard?.dataset.state, 'ok');

    dispose?.();
    assert.equal(document.querySelector('.dsh-mmd'), null);
    assert.equal(document.querySelector('.dsh-mmd-viewer'), null);
    assert.equal(document.getElementById('dsh-mermaid/css'), null);
  } finally {
    dispose?.();
    restoreMermaidRuntime?.();
    await window.happyDOM.abort();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
});
