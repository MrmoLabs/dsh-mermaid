import { Window } from 'happy-dom';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createClientHarness({ initialSource = 'flowchart LR\nA-->B', locale = 'zh-CN' } = {}) {
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

  document.documentElement.lang = locale;
  const state = {
    downloadedName: '',
    initializedOptions: [],
    initializedThemes: [],
    maxActiveRenders: 0,
    objectUrls: [],
    releaseSlowRender: null,
    renderCalls: [],
    revokedUrls: [],
  };
  window.URL.createObjectURL = (blob) => {
    state.objectUrls.push(blob);
    return `blob:test-${state.objectUrls.length}`;
  };
  window.URL.revokeObjectURL = (url) => state.revokedUrls.push(url);
  window.HTMLAnchorElement.prototype.click = function click() {
    state.downloadedName = this.download;
  };

  const moduleUrl = new URL('../src/client.js', import.meta.url);
  moduleUrl.searchParams.set('dom-test', `${Date.now()}-${Math.random()}`);
  const client = await import(moduleUrl.href);
  let activeRenders = 0;
  const restoreMermaidRuntime = client.setMermaidRuntimeForTesting({
    initialize(options) {
      state.initializedThemes.push(options.theme);
      state.initializedOptions.push(options);
    },
    async render(_id, source) {
      state.renderCalls.push(source);
      activeRenders += 1;
      state.maxActiveRenders = Math.max(state.maxActiveRenders, activeRenders);
      try {
        if (source.endsWith('-->')) throw new Error('synthetic Mermaid failure');
        if (source.includes('SLOW')) {
          return await new Promise((resolve) => {
            state.releaseSlowRender = () => resolve({ svg: '<svg data-render="slow"></svg>' });
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

  function addCodeBlock(source = '', className = 'language-mermaid') {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = className;
    code.textContent = source;
    pre.appendChild(code);
    document.body.appendChild(pre);
    return { code, pre };
  }

  const initialBlock = initialSource === null ? null : addCodeBlock(initialSource);
  let dispose;
  client.apply({
    effect(callback) {
      dispose = callback();
    },
  });

  let cleaned = false;
  function disposePlugin() {
    dispose?.();
    dispose = null;
  }

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    disposePlugin();
    restoreMermaidRuntime?.();
    await window.happyDOM.abort();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }

  return {
    addCodeBlock,
    cleanup,
    code: initialBlock?.code,
    document,
    disposePlugin,
    pre: initialBlock?.pre,
    state,
    wait,
    window,
  };
}

export { createClientHarness, wait };
