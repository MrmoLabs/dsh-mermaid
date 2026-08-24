import { diagramType, hasMermaidLanguage, isMermaidSource } from './detection.js';

const TAG_ID = 'dsh-mermaid/css';
const STABLE_MS = 300;
const RENDER_DEBOUNCE_MS = 500;
const MAX_SOURCE_CHARS = 50_000;
const MAX_SOURCE_LINES = 2_000;
const RUNTIME_REVISION = typeof __DSH_MERMAID_RUNTIME_REV__ === 'undefined'
  ? 'development'
  : __DSH_MERMAID_RUNTIME_REV__;
const RUNTIME_URL = `/dsh-mermaid/mermaid-runtime.js?rev=${RUNTIME_REVISION}`;

const CSS = `
.dsh-mmd{margin:8px 0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));overflow:hidden}
.dsh-mmd-bar{display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,transparent)}
.dsh-mmd-badge{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:0 6px}
.dsh-mmd-label{font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888);margin-right:auto}
.dsh-mmd-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-secondary,#666);border-radius:5px;font:12px/20px inherit;padding:0 10px;cursor:pointer}
.dsh-mmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-mmd-btn[aria-pressed='true']{border-color:var(--dsw-alias-button-primary-fill,#4c6ef5);color:var(--dsw-alias-button-primary-fill,#4c6ef5);background:var(--dsw-alias-interactive-bg-active,rgba(76,110,245,.12))}
.dsh-mmd-actions{position:relative;display:flex;align-items:center}
.dsh-mmd-menu{position:absolute;z-index:20;right:0;top:calc(100% + 5px);min-width:132px;padding:4px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.dsh-mmd-menu[hidden]{display:none}
.dsh-mmd-menu-item{appearance:none;display:block;width:100%;border:0;border-radius:5px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-primary,#222);font:12px/20px inherit;text-align:left;cursor:pointer}
.dsh-mmd-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-mmd-body{padding:10px 12px;overflow-x:auto}
.dsh-mmd-pane{display:block}
.dsh-mmd-pane svg{max-width:100%;height:auto;display:block;margin:0 auto}
.dsh-mmd-pane[data-state='loading'],.dsh-mmd-pane[data-state='error']{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:12px 4px;white-space:pre-wrap}
.dsh-mmd-pane[data-state='error']{color:var(--dsw-alias-state-error-primary,#d33)}
.dsh-mmd-code{display:none;margin:0;padding:12px 14px;overflow-x:auto;font:var(--dsl-code-block-content-font,var(--dsw-font-markdown-code-block,13px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));color:var(--dsw-alias-label-primary,#e6e6e6);white-space:pre;tab-size:4}
.dsh-mmd-error{display:none;font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-state-error-primary,#d33);padding:8px 14px 0;white-space:pre-wrap}
.dsh-mmd[data-view='code'] .dsh-mmd-body{padding:0}
.dsh-mmd[data-view='code'] .dsh-mmd-pane{display:none}
.dsh-mmd[data-view='code'] .dsh-mmd-code{display:block}
.dsh-mmd[data-view='code'][data-state='error'] .dsh-mmd-error{display:block}
.dsh-mmd[data-view='code'] .dsh-mmd-diagram-action,.dsh-mmd:not([data-state='ok']) .dsh-mmd-diagram-action{display:none}
.dsh-mmd-viewer{position:fixed;z-index:2147483000;inset:0;display:flex;flex-direction:column;background:#fff;color:var(--dsw-alias-label-primary,#222)}
body[data-ds-dark-theme] .dsh-mmd-viewer{background:#121212;color:var(--dsw-alias-label-primary,#f5f5f5)}
.dsh-mmd-viewer[hidden]{display:none}
.dsh-mmd-viewer-bar{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-1,rgba(30,30,30,.98))}
.dsh-mmd-viewer-title{margin-right:auto;font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-mmd-viewer-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dsh-mmd-viewer-viewport[data-dragging='true']{cursor:grabbing}
.dsh-mmd-viewer-stage{position:absolute;left:50%;top:50%;transform-origin:center;will-change:transform}
.dsh-mmd-viewer-stage svg{display:block;max-width:none;height:auto;background:transparent}
/* 原始代码块始终隐藏：代码视图由卡片内部的 .dsh-mmd-code 呈现 */
.dsh-mmd + pre{display:none}
@media (prefers-reduced-motion:reduce){.dsh-mmd *{animation:none!important;transition:none!important}}
`;

let uid = 0;
let styleTag = null;
let mermaidRuntime = null;
let runtimePromise = null;
let viewer = null;
let viewerCloneUid = 0;
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

function initializeMermaid(runtime) {
  runtime.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
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
  if (view === 'code') closeEntryMenu(entry);
}

function closeEntryMenu(entry) {
  if (!entry?.menu) return;
  entry.menu.hidden = true;
  entry.btnMore.setAttribute('aria-expanded', 'false');
}

function closeAllMenus(except) {
  for (const wrapper of wrappers) {
    const entry = entries.get(wrapper._dshCode);
    if (entry && entry !== except) closeEntryMenu(entry);
  }
}

function serializeSvg(svg) {
  const clone = svg.cloneNode(true);
  if (!clone.hasAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
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
  closeEntryMenu(entry);
}

function svgDimensions(svg) {
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  return {
    width: Number.parseFloat(svg.getAttribute('width')) || 800,
    height: Number.parseFloat(svg.getAttribute('height')) || 600,
  };
}

function updateViewerTransform() {
  if (!viewer) return;
  viewer.stage.style.transform = `translate(-50%,-50%) translate(${viewer.panX}px,${viewer.panY}px) scale(${viewer.scale})`;
  viewer.zoomLabel.textContent = `${Math.round(viewer.scale * 100)}%`;
}

function setViewerScale(scale, anchor) {
  if (!viewer) return;
  const previousScale = viewer.scale;
  const nextScale = Math.min(5, Math.max(0.1, scale));
  if (anchor && previousScale > 0 && nextScale !== previousScale) {
    const ratio = nextScale / previousScale;
    viewer.panX = anchor.x - ((anchor.x - viewer.panX) * ratio);
    viewer.panY = anchor.y - ((anchor.y - viewer.panY) * ratio);
  }
  viewer.scale = nextScale;
  updateViewerTransform();
}

function rewriteSvgIds(svg) {
  const elements = [svg, ...svg.querySelectorAll('*')];
  const idMap = new Map();
  const prefix = `dsh-mmd-view-${++viewerCloneUid}-`;

  for (const element of elements) {
    if (!element.id) continue;
    const replacement = `${prefix}${idMap.size + 1}`;
    idMap.set(element.id, replacement);
    element.id = replacement;
  }

  if (!idMap.size) return;
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id') continue;
      let value = attribute.value.replace(
        /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
        (match, quote, id) => idMap.has(id) ? `url(${quote}#${idMap.get(id)}${quote})` : match,
      );
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) {
        const replacement = idMap.get(value.slice(1));
        if (replacement) value = `#${replacement}`;
      }
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        value = value.split(/\s+/).map((id) => idMap.get(id) || id).join(' ');
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }

  for (const style of svg.querySelectorAll('style')) {
    let css = style.textContent || '';
    for (const [original, replacement] of idMap) {
      css = css.split(`#${original}`).join(`#${replacement}`);
    }
    style.textContent = css;
  }
}

function fitViewer() {
  if (!viewer) return;
  const svg = viewer.stage.querySelector('svg');
  if (!svg) return;
  const dimensions = svgDimensions(svg);
  const width = viewer.viewport.clientWidth || 1200;
  const height = viewer.viewport.clientHeight || 800;
  viewer.scale = Math.min(4, Math.max(0.1, Math.min((width - 48) / dimensions.width, (height - 48) / dimensions.height)));
  viewer.panX = 0;
  viewer.panY = 0;
  updateViewerTransform();
}

function updateViewerSvg(entry, shouldFit) {
  if (!viewer) return;
  const sourceSvg = entry.pane.querySelector('svg');
  if (!sourceSvg) return;
  const clone = sourceSvg.cloneNode(true);
  rewriteSvgIds(clone);
  const dimensions = svgDimensions(clone);
  clone.setAttribute('width', String(dimensions.width));
  clone.setAttribute('height', String(dimensions.height));
  viewer.stage.replaceChildren(clone);
  viewer.title.textContent = `${entry.badge.textContent || 'mermaid'} · Mermaid`;
  if (shouldFit) fitViewer();
}

function closeViewer() {
  if (!viewer || viewer.overlay.hidden) return;
  viewer.overlay.hidden = true;
  viewer.entry = null;
  viewer.stage.replaceChildren();
  document.body.style.overflow = viewer.previousBodyOverflow;
}

function createViewer() {
  if (viewer) return viewer;
  const overlay = document.createElement('div');
  overlay.className = 'dsh-mmd-viewer';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mermaid 图全屏查看');
  overlay.tabIndex = -1;
  const toolbar = document.createElement('div');
  toolbar.className = 'dsh-mmd-viewer-bar';
  const title = document.createElement('span');
  title.className = 'dsh-mmd-viewer-title';
  const button = (text, label) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'dsh-mmd-btn';
    element.textContent = text;
    element.setAttribute('aria-label', label);
    return element;
  };
  const zoomOut = button('−', '缩小');
  const zoomLabel = button('100%', '恢复到 100%');
  const zoomIn = button('+', '放大');
  const fit = button('适应窗口', '适应窗口');
  const close = button('关闭', '关闭全屏查看');
  const viewport = document.createElement('div');
  viewport.className = 'dsh-mmd-viewer-viewport';
  const stage = document.createElement('div');
  stage.className = 'dsh-mmd-viewer-stage';
  viewport.appendChild(stage);
  toolbar.append(title, zoomOut, zoomLabel, zoomIn, fit, close);
  overlay.append(toolbar, viewport);
  document.body.appendChild(overlay);
  viewer = {
    overlay, title, viewport, stage, zoomLabel, entry: null,
    scale: 1, panX: 0, panY: 0, dragging: false, pointerId: null,
    lastX: 0, lastY: 0, previousBodyOverflow: '',
  };
  zoomOut.addEventListener('click', () => setViewerScale(viewer.scale / 1.2));
  zoomLabel.addEventListener('click', () => {
    viewer.scale = 1;
    viewer.panX = 0;
    viewer.panY = 0;
    updateViewerTransform();
  });
  zoomIn.addEventListener('click', () => setViewerScale(viewer.scale * 1.2));
  fit.addEventListener('click', fitViewer);
  close.addEventListener('click', closeViewer);
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left - (bounds.width / 2),
      y: event.clientY - bounds.top - (bounds.height / 2),
    };
    setViewerScale(viewer.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), anchor);
  }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    viewer.dragging = true;
    viewer.pointerId = event.pointerId;
    viewer.lastX = event.clientX;
    viewer.lastY = event.clientY;
    viewport.dataset.dragging = 'true';
    viewport.setPointerCapture?.(event.pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!viewer.dragging || event.pointerId !== viewer.pointerId) return;
    viewer.panX += event.clientX - viewer.lastX;
    viewer.panY += event.clientY - viewer.lastY;
    viewer.lastX = event.clientX;
    viewer.lastY = event.clientY;
    updateViewerTransform();
  });
  const stopDragging = (event) => {
    if (!viewer.dragging || event.pointerId !== viewer.pointerId) return;
    viewer.dragging = false;
    viewer.pointerId = null;
    delete viewport.dataset.dragging;
  };
  viewport.addEventListener('pointerup', stopDragging);
  viewport.addEventListener('pointercancel', stopDragging);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeViewer();
  });
  return viewer;
}

function openViewer(entry) {
  if (!entry.pane.querySelector('svg')) return;
  const current = createViewer();
  current.entry = entry;
  current.previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  current.overlay.hidden = false;
  updateViewerSvg(entry, true);
  current.overlay.focus?.();
}

function createEntry(code) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dsh-mmd';
  wrapper.dataset.view = 'diagram';

  const bar = document.createElement('div');
  bar.className = 'dsh-mmd-bar';
  const badge = document.createElement('span');
  badge.className = 'dsh-mmd-badge';
  badge.textContent = 'mermaid';
  const label = document.createElement('span');
  label.className = 'dsh-mmd-label';
  label.textContent = 'mermaid 图';
  const btnDiagram = document.createElement('button');
  btnDiagram.type = 'button';
  btnDiagram.className = 'dsh-mmd-btn';
  btnDiagram.textContent = '图';
  btnDiagram.setAttribute('aria-pressed', 'true');
  const btnCode = document.createElement('button');
  btnCode.type = 'button';
  btnCode.className = 'dsh-mmd-btn';
  btnCode.textContent = '代码';
  btnCode.setAttribute('aria-pressed', 'false');
  const btnFullscreen = document.createElement('button');
  btnFullscreen.type = 'button';
  btnFullscreen.className = 'dsh-mmd-btn dsh-mmd-diagram-action';
  btnFullscreen.textContent = '全屏';
  const actions = document.createElement('div');
  actions.className = 'dsh-mmd-actions dsh-mmd-diagram-action';
  const btnMore = document.createElement('button');
  btnMore.type = 'button';
  btnMore.className = 'dsh-mmd-btn';
  btnMore.textContent = '更多';
  btnMore.setAttribute('aria-haspopup', 'menu');
  btnMore.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'dsh-mmd-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const btnDownloadSvg = document.createElement('button');
  btnDownloadSvg.type = 'button';
  btnDownloadSvg.className = 'dsh-mmd-menu-item';
  btnDownloadSvg.textContent = '下载 SVG';
  btnDownloadSvg.setAttribute('role', 'menuitem');
  menu.appendChild(btnDownloadSvg);
  actions.append(btnMore, menu);
  const body = document.createElement('div');
  body.className = 'dsh-mmd-body';
  const pane = document.createElement('div');
  pane.className = 'dsh-mmd-pane';
  pane.dataset.state = 'loading';
  pane.textContent = '渲染中…';
  const codePane = document.createElement('pre');
  codePane.className = 'dsh-mmd-code';
  codePane.textContent = code.textContent || '';
  const errorEl = document.createElement('div');
  errorEl.className = 'dsh-mmd-error';

  body.append(pane, codePane, errorEl);
  bar.append(badge, label, btnDiagram, btnCode, btnFullscreen, actions);
  wrapper.append(bar, body);

  const entry = {
    code, wrapper, pane, codePane, errorEl, badge, btnDiagram, btnCode,
    btnFullscreen, btnMore, btnDownloadSvg, menu,
    lastRendered: '', stableTimer: null, renderTimer: null, renderGeneration: 0,
  };
  entries.set(code, entry);

  btnDiagram.addEventListener('click', () => setView(entry, 'diagram'));
  btnCode.addEventListener('click', () => setView(entry, 'code'));
  btnFullscreen.addEventListener('click', () => openViewer(entry));
  btnMore.addEventListener('click', (event) => {
    event.stopPropagation();
    const opening = entry.menu.hidden;
    closeAllMenus(entry);
    entry.menu.hidden = !opening;
    entry.btnMore.setAttribute('aria-expanded', String(opening));
  });
  menu.addEventListener('click', (event) => event.stopPropagation());
  btnDownloadSvg.addEventListener('click', () => downloadSvg(entry));

  entry.stableTimer = setTimeout(() => {
    entry.stableTimer = null;
    const pre = code.closest('pre');
    if (!code.isConnected || !pre?.parentNode) return;
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
  entry.pane.dataset.state = 'loading';
  entry.pane.textContent = '渲染中…';

  let limitDetail = '';
  if (source.length > MAX_SOURCE_CHARS) {
    limitDetail = `源码长度 ${source.length} 字符，限制为 ${MAX_SOURCE_CHARS} 字符`;
  } else {
    const lineCount = source.split('\n', MAX_SOURCE_LINES + 1).length;
    if (lineCount > MAX_SOURCE_LINES) {
      limitDetail = `源码共 ${lineCount} 行，限制为 ${MAX_SOURCE_LINES} 行`;
    }
  }
  if (limitDetail) {
    const message = `diagram 未渲染: ${limitDetail}`;
    entry.wrapper.dataset.state = 'error';
    entry.pane.dataset.state = 'error';
    entry.pane.textContent = message;
    entry.errorEl.textContent = message;
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
    if (svgElement && bindFunctions) bindFunctions(svgElement);
    entry.lastRendered = source;
    entry.wrapper.dataset.state = 'ok';
    entry.pane.dataset.state = 'ok';
    if (viewer?.entry === entry) updateViewerSvg(entry, false);
  } catch (error) {
    if (generation !== entry.renderGeneration || !entry.wrapper.isConnected) return;
    const message = `diagram 渲染失败: ${error?.message || String(error)}`;
    entry.wrapper.dataset.state = 'error';
    entry.pane.dataset.state = 'error';
    entry.pane.textContent = message;
    entry.errorEl.textContent = message;
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
  if (viewer?.entry === entry) closeViewer();
  entry.wrapper.remove();
  wrappers.delete(entry.wrapper);
}

function collectGarbage() {
  for (const wrapper of wrappers) {
    const code = wrapper._dshCode;
    if (!wrapper.isConnected || !code?.isConnected) {
      const entry = code ? entries.get(code) : null;
      if (entry) disposeEntry(entry);
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
    injectCss();

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === 'data-ds-dark-theme')) reRenderAll();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    const handleDocumentClick = () => closeAllMenus();
    const handleDocumentKeydown = (event) => {
      if (event.key === 'Escape') {
        closeAllMenus();
        closeViewer();
      }
    };
    const handleWindowResize = () => {
      if (viewer && !viewer.overlay.hidden) fitViewer();
    };
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('resize', handleWindowResize);

    document.querySelectorAll('pre code').forEach(maybeEnhance);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeydown);
      window.removeEventListener('resize', handleWindowResize);
      for (const wrapper of [...wrappers]) {
        const entry = entries.get(wrapper._dshCode);
        if (entry) disposeEntry(entry);
        else wrapper.remove();
      }
      closeViewer();
      viewer?.overlay.remove();
      viewer = null;
      removeCss();
    };
  });
}

const inject = [];
export { inject, apply, setMermaidRuntimeForTesting };
