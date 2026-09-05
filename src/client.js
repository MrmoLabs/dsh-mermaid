import { diagramType, hasMermaidLanguage, isMermaidSource } from './detection.js';
import { resolveLocale, translate } from './i18n.js';
import { CSS } from './styles.js';
import { ensureSvgAccessibility, localizeGeneratedSvgTitle, serializeSvg } from './svg.js';
import { createFullscreenViewer } from './viewer.js';

const TAG_ID = 'dsh-mermaid/css';
const STABLE_MS = 300;
const RENDER_DEBOUNCE_MS = 500;
const MAX_SOURCE_CHARS = 50_000;
const MAX_SOURCE_LINES = 2_000;
const RUNTIME_REVISION = typeof __DSH_MERMAID_RUNTIME_REV__ === 'undefined'
  ? 'development'
  : __DSH_MERMAID_RUNTIME_REV__;
const RUNTIME_URL = `/dsh-mermaid/mermaid-runtime.js?rev=${RUNTIME_REVISION}`;

let uid = 0;
let currentLocale = 'en';
let styleTag = null;
let mermaidRuntime = null;
let runtimePromise = null;
let renderQueueActive = false;
const entries = new WeakMap();
const wrappers = new Set();
const renderQueue = [];

function setMermaidRuntimeForTesting(runtime) {
  const previous = mermaidRuntime;
  const previousPromise = runtimePromise;
  mermaidRuntime = runtime;
  runtimePromise = Promise.resolve(runtime);
  return () => {
    mermaidRuntime = previous;
    runtimePromise = previousPromise;
  };
}

function loadMermaidRuntime() {
  if (mermaidRuntime) return Promise.resolve(mermaidRuntime);
  if (!runtimePromise) {
    runtimePromise = import(RUNTIME_URL)
      .then((module) => {
        mermaidRuntime = module.default;
        return mermaidRuntime;
      })
      .catch((error) => {
        runtimePromise = null;
        throw error;
      });
  }
  return runtimePromise;
}

function isDark() {
  return document.body?.hasAttribute('data-ds-dark-theme') ?? false;
}

function t(key, parameters) {
  return translate(currentLocale, key, parameters);
}

const fullscreenViewer = createFullscreenViewer({ t });

function detectLocale() {
  const languages = [...(navigator.languages || [])];
  if (navigator.language && !languages.includes(navigator.language)) languages.push(navigator.language);
  return resolveLocale(document.documentElement?.lang, languages);
}

function localizeEntry(entry) {
  entry.label.textContent = t('diagramLabel');
  entry.bar.setAttribute('aria-label', t('viewOptions'));
  entry.btnDiagram.textContent = t('diagramView');
  entry.btnCode.textContent = t('codeView');
  entry.btnFullscreen.textContent = t('fullscreen');
  entry.btnDownloadSvg.textContent = t('downloadSvg');
  if (entry.statusKey) entry.statusEl.textContent = t(entry.statusKey, entry.statusParameters);
  localizeGeneratedSvgTitle(
    entry.pane.querySelector('svg'),
    t('diagramTitle', { type: entry.badge.textContent || 'mermaid' }),
  );
  if (entry.messageKey && entry.pane.dataset.state !== 'ok') {
    const message = t(entry.messageKey, entry.messageParameters);
    entry.pane.textContent = message;
    if (entry.wrapper.dataset.state === 'error') entry.errorEl.textContent = message;
  }
}

function refreshLocale() {
  currentLocale = detectLocale();
  for (const wrapper of wrappers) {
    const entry = entries.get(wrapper._dshCode);
    if (entry) localizeEntry(entry);
  }
  fullscreenViewer.localize();
}

function initializeMermaid(runtime) {
  runtime.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: isDark() ? 'dark' : 'default',
    maxTextSize: MAX_SOURCE_CHARS,
    maxEdges: 2_000,
  });
}

function injectCss() {
  if (styleTag || !document.head) return;
  styleTag = document.createElement('style');
  styleTag.id = TAG_ID;
  styleTag.textContent = CSS;
  document.head.appendChild(styleTag);
}

function removeCss() {
  styleTag?.remove();
  styleTag = null;
}

function isMermaidCodeBlock(code) {
  const pre = code?.closest?.('pre');
  if (!pre) return false;
  return hasMermaidLanguage(code.classList) || isMermaidSource((code.textContent || '').trim());
}

function setView(entry, view) {
  entry.wrapper.dataset.view = view;
  entry.btnDiagram.setAttribute('aria-pressed', String(view === 'diagram'));
  entry.btnCode.setAttribute('aria-pressed', String(view === 'code'));
}

function setViewControlsAvailable(entry, available) {
  entry.btnDiagram.hidden = !available;
  entry.btnCode.hidden = !available;
}

function setEntryStatus(entry, key, parameters = {}) {
  entry.statusKey = key;
  entry.statusParameters = parameters;
  entry.statusEl.textContent = t(key, parameters);
}

function downloadSvg(entry) {
  const svg = entry.pane.querySelector('svg');
  if (!svg) return;
  const blob = new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const type = diagramType(entry.lastRendered) || 'diagram';
  anchor.href = url;
  anchor.download = `mermaid-${type}.svg`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setEntryStatus(entry, 'downloaded');
}

function createEntry(code) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dsh-mmd';
  wrapper.dataset.view = 'diagram';

  const bar = document.createElement('div');
  bar.className = 'dsh-mmd-bar';
  bar.setAttribute('role', 'group');
  const badge = document.createElement('span');
  badge.className = 'dsh-mmd-badge';
  badge.textContent = 'mermaid';
  const label = document.createElement('span');
  label.className = 'dsh-mmd-label';
  const btnDiagram = document.createElement('button');
  btnDiagram.type = 'button';
  btnDiagram.className = 'dsh-mmd-btn dsh-mmd-view-control';
  btnDiagram.setAttribute('aria-pressed', 'true');
  const btnCode = document.createElement('button');
  btnCode.type = 'button';
  btnCode.className = 'dsh-mmd-btn dsh-mmd-view-control';
  btnCode.setAttribute('aria-pressed', 'false');
  const btnFullscreen = document.createElement('button');
  btnFullscreen.type = 'button';
  btnFullscreen.className = 'dsh-mmd-btn dsh-mmd-diagram-action';
  const btnDownloadSvg = document.createElement('button');
  btnDownloadSvg.type = 'button';
  btnDownloadSvg.className = 'dsh-mmd-btn dsh-mmd-diagram-action';
  const body = document.createElement('div');
  body.className = 'dsh-mmd-body';
  const pane = document.createElement('div');
  pane.className = 'dsh-mmd-pane';
  pane.dataset.state = 'loading';
  const codePane = document.createElement('pre');
  codePane.className = 'dsh-mmd-code';
  codePane.textContent = code.textContent || '';
  const errorEl = document.createElement('div');
  errorEl.className = 'dsh-mmd-error';
  const statusEl = document.createElement('div');
  statusEl.className = 'dsh-mmd-sr-only';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');

  body.append(pane, codePane, errorEl, statusEl);
  bar.append(badge, label, btnDiagram, btnCode, btnFullscreen, btnDownloadSvg);
  wrapper.append(bar, body);

  const entry = {
    code, wrapper, bar, pane, codePane, errorEl, statusEl, badge, label, btnDiagram, btnCode,
    btnFullscreen, btnDownloadSvg,
    lastRendered: '', stableTimer: null, renderTimer: null, renderGeneration: 0,
    messageKey: 'rendering', messageParameters: {},
    statusKey: null, statusParameters: {},
  };
  entries.set(code, entry);
  localizeEntry(entry);

  btnDiagram.addEventListener('click', () => setView(entry, 'diagram'));
  btnCode.addEventListener('click', () => setView(entry, 'code'));
  btnFullscreen.addEventListener('click', () => fullscreenViewer.open(entry));
  btnDownloadSvg.addEventListener('click', () => downloadSvg(entry));

  entry.stableTimer = setTimeout(() => {
    entry.stableTimer = null;
    const pre = code.closest('pre');
    if (!code.isConnected || !pre?.parentNode) {
      entries.delete(code);
      return;
    }
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper._dshCode = code;
    wrappers.add(wrapper);
    scheduleRender(entry);
  }, STABLE_MS);
}

async function renderDiagram(entry) {
  const source = (entry.code.textContent || '').trim();
  if (!source) return;
  if (source === entry.lastRendered && entry.pane.dataset.state === 'ok') return;

  const generation = ++entry.renderGeneration;
  entry.badge.textContent = diagramType(source) || 'mermaid';
  entry.codePane.textContent = entry.code.textContent || '';
  entry.wrapper.dataset.state = 'rendering';
  setViewControlsAvailable(entry, true);
  entry.pane.dataset.state = 'loading';
  entry.messageKey = 'rendering';
  entry.messageParameters = {};
  entry.pane.textContent = t('rendering');
  setEntryStatus(entry, 'rendering');

  let limitMessage = null;
  if (source.length > MAX_SOURCE_CHARS) {
    limitMessage = { key: 'tooLong', parameters: { actual: source.length, limit: MAX_SOURCE_CHARS } };
  } else {
    const lineCount = source.split('\n', MAX_SOURCE_LINES + 1).length;
    if (lineCount > MAX_SOURCE_LINES) {
      limitMessage = { key: 'tooManyLines', parameters: { actual: lineCount, limit: MAX_SOURCE_LINES } };
    }
  }
  if (limitMessage) {
    const message = t(limitMessage.key, limitMessage.parameters);
    entry.wrapper.dataset.state = 'error';
    setViewControlsAvailable(entry, false);
    entry.pane.dataset.state = 'error';
    entry.messageKey = limitMessage.key;
    entry.messageParameters = limitMessage.parameters;
    entry.pane.textContent = message;
    entry.errorEl.textContent = message;
    setEntryStatus(entry, limitMessage.key, limitMessage.parameters);
    setView(entry, 'code');
    return;
  }

  try {
    const runtime = await loadMermaidRuntime();
    if (generation !== entry.renderGeneration || !entry.wrapper.isConnected) return;
    if ((entry.code.textContent || '').trim() !== source) return;
    initializeMermaid(runtime);
    const id = `dsh-mmd-${++uid}`;
    const { svg, bindFunctions } = await runtime.render(id, source);
    if (generation !== entry.renderGeneration || !entry.wrapper.isConnected) return;
    if ((entry.code.textContent || '').trim() !== source) return;
    entry.pane.innerHTML = svg;
    const svgElement = entry.pane.querySelector('svg');
    ensureSvgAccessibility(svgElement, t('diagramTitle', { type: entry.badge.textContent || 'mermaid' }));
    if (svgElement && bindFunctions) bindFunctions(svgElement);
    entry.lastRendered = source;
    entry.messageKey = null;
    entry.messageParameters = null;
    entry.wrapper.dataset.state = 'ok';
    setViewControlsAvailable(entry, true);
    entry.pane.dataset.state = 'ok';
    setEntryStatus(entry, 'rendered');
    if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.update(entry, false);
  } catch (error) {
    if (generation !== entry.renderGeneration || !entry.wrapper.isConnected) return;
    const parameters = { detail: error?.message || String(error) };
    const message = t('renderFailed', parameters);
    entry.wrapper.dataset.state = 'error';
    setViewControlsAvailable(entry, false);
    entry.pane.dataset.state = 'error';
    entry.messageKey = 'renderFailed';
    entry.messageParameters = parameters;
    entry.pane.textContent = message;
    entry.errorEl.textContent = message;
    setEntryStatus(entry, 'renderFailedStatus');
    setView(entry, 'code');
  }
}

function scheduleRender(entry) {
  if (entry.renderTimer) clearTimeout(entry.renderTimer);
  entry.renderTimer = setTimeout(() => {
    entry.renderTimer = null;
    enqueueRender(entry);
  }, RENDER_DEBOUNCE_MS);
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function enqueueRender(entry) {
  if (entry.renderQueued) return;
  entry.renderQueued = true;
  renderQueue.push(entry);
  void drainRenderQueue();
}

async function drainRenderQueue() {
  if (renderQueueActive) return;
  renderQueueActive = true;
  try {
    while (renderQueue.length) {
      const entry = renderQueue.shift();
      entry.renderQueued = false;
      if (entry.wrapper.isConnected && entry.code.isConnected) {
        await renderDiagram(entry);
        await yieldToBrowser();
      }
    }
  } finally {
    renderQueueActive = false;
    if (renderQueue.length) void drainRenderQueue();
  }
}

function maybeEnhance(code) {
  if (!code || entries.has(code) || !isMermaidCodeBlock(code)) return;
  if (!(code.textContent || '').trim()) return;
  createEntry(code);
}

function disposeEntry(entry) {
  if (entry.stableTimer) clearTimeout(entry.stableTimer);
  if (entry.renderTimer) clearTimeout(entry.renderTimer);
  entry.renderGeneration += 1;
  if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.close();
  entry.wrapper.remove();
  wrappers.delete(entry.wrapper);
  entries.delete(entry.code);
}

function collectGarbage() {
  for (const wrapper of wrappers) {
    const code = wrapper._dshCode;
    if (!wrapper.isConnected || !code?.isConnected) {
      const entry = code ? entries.get(code) : null;
      if (entry) {
        disposeEntry(entry);
        if (code.isConnected) maybeEnhance(code);
      }
      else wrappers.delete(wrapper);
    }
  }
}

function handleMutations(mutations) {
  const codesToEnhance = new Set();
  const entriesToRender = new Set();

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.('code')) codesToEnhance.add(node);
        node.querySelectorAll?.('code').forEach((code) => codesToEnhance.add(code));
      }
    }

    const target = mutation.type === 'characterData' ? mutation.target.parentElement : mutation.target;
    const hostCode = target?.matches?.('code') ? target : target?.closest?.('code');
    const entry = hostCode ? entries.get(hostCode) : null;
    if (entry) entriesToRender.add(entry);
    else if (hostCode) codesToEnhance.add(hostCode);
  }

  codesToEnhance.forEach(maybeEnhance);
  entriesToRender.forEach(scheduleRender);
  collectGarbage();
}

function reRenderAll() {
  for (const wrapper of wrappers) {
    const entry = entries.get(wrapper._dshCode);
    if (entry) {
      entry.lastRendered = '';
      scheduleRender(entry);
    }
  }
}

function apply(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;
    currentLocale = detectLocale();
    injectCss();

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === 'data-ds-dark-theme')) reRenderAll();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    const localeObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === 'lang')) refreshLocale();
    });
    localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    const handleDocumentKeydown = (event) => {
      if (event.key === 'Escape') {
        fullscreenViewer.close();
      }
    };
    const handleWindowResize = () => {
      if (fullscreenViewer.isOpen()) fullscreenViewer.fit();
    };
    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('resize', handleWindowResize);

    document.querySelectorAll('pre code').forEach(maybeEnhance);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      localeObserver.disconnect();
      document.removeEventListener('keydown', handleDocumentKeydown);
      window.removeEventListener('resize', handleWindowResize);
      for (const wrapper of [...wrappers]) {
        const entry = entries.get(wrapper._dshCode);
        if (entry) disposeEntry(entry);
        else wrapper.remove();
      }
      fullscreenViewer.destroy();
      removeCss();
    };
  });
}

const inject = [];
export { inject, apply, setMermaidRuntimeForTesting };
