import mermaid from 'mermaid';
import { diagramType, hasMermaidLanguage, isMermaidSource } from './detection.js';

const TAG_ID = 'dsh-mermaid/css';
const STABLE_MS = 300;
const RENDER_DEBOUNCE_MS = 500;

const CSS = `
.dsh-mmd{margin:8px 0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));overflow:hidden}
.dsh-mmd-bar{display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,transparent)}
.dsh-mmd-badge{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:0 6px}
.dsh-mmd-label{font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888);margin-right:auto}
.dsh-mmd-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-secondary,#666);border-radius:5px;font:12px/20px inherit;padding:0 10px;cursor:pointer}
.dsh-mmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-mmd-btn[aria-pressed='true']{border-color:var(--dsw-alias-button-primary-fill,#4c6ef5);color:var(--dsw-alias-button-primary-fill,#4c6ef5);background:var(--dsw-alias-interactive-bg-active,rgba(76,110,245,.12))}
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
/* 原始代码块始终隐藏：代码视图由卡片内部的 .dsh-mmd-code 呈现 */
.dsh-mmd + pre{display:none}
@media (prefers-reduced-motion:reduce){.dsh-mmd *{animation:none!important;transition:none!important}}
`;

let uid = 0;
let styleTag = null;
let mermaidRuntime = mermaid;
const entries = new WeakMap();
const wrappers = new Set();

function setMermaidRuntimeForTesting(runtime) {
  const previous = mermaidRuntime;
  mermaidRuntime = runtime;
  return () => {
    mermaidRuntime = previous;
  };
}

function isDark() {
  return document.body?.hasAttribute('data-ds-dark-theme') ?? false;
}

function initializeMermaid() {
  mermaidRuntime.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark() ? 'dark' : 'default',
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
  bar.append(badge, label, btnDiagram, btnCode);
  wrapper.append(bar, body);

  const entry = {
    code, wrapper, pane, codePane, errorEl, badge, btnDiagram, btnCode,
    lastRendered: '', stableTimer: null, renderTimer: null, renderGeneration: 0,
  };
  entries.set(code, entry);

  btnDiagram.addEventListener('click', () => setView(entry, 'diagram'));
  btnCode.addEventListener('click', () => setView(entry, 'code'));

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

  try {
    initializeMermaid();
    const id = `dsh-mmd-${++uid}`;
    const { svg, bindFunctions } = await mermaidRuntime.render(id, source);
    if (generation !== entry.renderGeneration || !entry.wrapper.isConnected) return;
    if ((entry.code.textContent || '').trim() !== source) return;
    entry.pane.innerHTML = svg;
    const svgElement = entry.pane.querySelector('svg');
    if (svgElement && bindFunctions) bindFunctions(svgElement);
    entry.lastRendered = source;
    entry.wrapper.dataset.state = 'ok';
    entry.pane.dataset.state = 'ok';
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
    void renderDiagram(entry);
  }, RENDER_DEBOUNCE_MS);
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

    document.querySelectorAll('pre code').forEach(maybeEnhance);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      for (const wrapper of [...wrappers]) {
        const entry = entries.get(wrapper._dshCode);
        if (entry) disposeEntry(entry);
        else wrapper.remove();
      }
      removeCss();
    };
  });
}

const inject = [];
export { inject, apply, setMermaidRuntimeForTesting };
