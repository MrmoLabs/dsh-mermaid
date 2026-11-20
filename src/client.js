import {
  diagramType,
  hasExplicitLanguage,
  hasMermaidLanguage,
  isMermaidSource,
} from './detection.js';
import { resolveLocale, translate } from './i18n.js';
import { CSS } from './styles.js';
import { ensureSvgAccessibility, hasSvgContent, localizeGeneratedSvgTitle, serializeSvg } from './svg.js';
import { createFullscreenViewer } from './viewer.js';
import { DEFAULT_STYLE, effectiveStyle, styleKey } from './render-config.js';
import { createStyleLoader } from './style-loader.js';
import { registerNativeSettings } from './settings-registration.js';

const TAG_ID = 'dsh-mermaid/css';
const STABLE_MS = 300;
const RENDER_DEBOUNCE_MS = 500;
const MAX_SOURCE_CHARS = 50_000;
const MAX_SOURCE_LINES = 2_000;
const RETRYABLE_RENDER_ERRORS = new Set(['runtimeLoadFailed', 'runtimeRenderFailed', 'missingSvg']);
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
let tooltipPositioner = null;
let tooltipPositionerFactory = null;
let preserveViewPosition = null;
let mount = null;
let mountSequence = 0;
const entries = new WeakMap();
const wrappers = new Set();
const renderQueue = [];

function setMermaidRuntimeForTesting(runtime, positionerFactory, viewPositioner) {
  const previous = mermaidRuntime;
  const previousPromise = runtimePromise;
  const previousPositionerFactory = tooltipPositionerFactory;
  const previousViewPositioner = preserveViewPosition;
  mermaidRuntime = runtime;
  runtimePromise = Promise.resolve(runtime);
  tooltipPositionerFactory = positionerFactory;
  preserveViewPosition = viewPositioner;
  return () => {
    mermaidRuntime = previous;
    runtimePromise = previousPromise;
    tooltipPositionerFactory = previousPositionerFactory;
    preserveViewPosition = previousViewPositioner;
  };
}

function loadMermaidRuntime() {
  if (mermaidRuntime) return Promise.resolve(mermaidRuntime);
  if (!runtimePromise) {
    runtimePromise = import(RUNTIME_URL)
      .then((module) => {
        mermaidRuntime = {
          initialize: module.default.initialize,
          render: module.renderMermaid,
          isSourceError: module.isMermaidSourceError,
        };
        tooltipPositionerFactory = module.createTooltipPositioner;
        preserveViewPosition = module.preserveViewPosition;
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

function currentRawSource(entry) {
  if (entry.draftDirty) return entry.draft;
  return entry.code.textContent || '';
}

function syncDraftFromMessage(entry) {
  if (entry.draftDirty) return false;
  const raw = entry.code.textContent || '';
  entry.draft = raw;
  entry.codePane.textContent = raw;
  if (entry.editor.value !== raw) entry.editor.value = raw;
  return true;
}

function isPreviewFresh(entry) {
  if (!entry.lastRendered || entry.lastRenderState !== 'ok' || entry.composing || !entry.pane.querySelector('svg')) return false;
  return currentRawSource(entry).trim() === entry.lastRendered && entry.lastRenderedStyleKey === currentStyleKey();
}

function canRestorePreview(entry) {
  return Boolean(entry.lastRendered && entry.pane.querySelector('svg') && !entry.composing
    && currentRawSource(entry).trim() === entry.lastRendered && entry.lastRenderedStyleKey === currentStyleKey()
    && entry.failedTarget !== `${entry.lastRendered}\0${entry.lastRenderedStyleKey}`);
}

function currentStyle() {
  return effectiveStyle(mount?.snapshot?.style || DEFAULT_STYLE, isDark());
}
function currentStyleKey() { return styleKey(currentStyle()); }

function updateConfigWarning(entry) {
  const snapshot = mount?.snapshot;
  entry.configWarning.hidden = !snapshot?.warning;
  if (!snapshot?.warning) return;
  const paths = [...new Set(snapshot.diagnostics.map((item) => item.path).filter(Boolean))];
  // A separate live region prevents render success from clearing the warning.
  if (!mount.warningAnnounced && entry.wrapper.isConnected) {
    mount.warningAnnounced = true;
    entry.configWarning.setAttribute('role', 'status');
    entry.configWarning.setAttribute('aria-live', 'polite');
  }
  const message = t(snapshot.warning) + (paths.length ? ` (${paths.join(', ')})` : '');
  if (entry.configWarning.textContent !== message) entry.configWarning.textContent = message;
}

function loadStyle(owner) {
  owner.promise ||= owner.loader.load().then((snapshot) => {
    if (mount !== owner) return snapshot;
    owner.snapshot = snapshot;
    for (const wrapper of wrappers) {
      const entry = entries.get(wrapper._dshCode);
      if (entry) updateConfigWarning(entry);
    }
    return snapshot;
  });
  return owner.promise;
}

function setActionAvailability(entry) {
  const fresh = isPreviewFresh(entry);
  entry.btnFullscreen.disabled = !fresh;
  entry.btnDownloadSvg.disabled = !fresh;
  entry.btnReset.disabled = !entry.draftDirty;
  entry.btnRetry.hidden = !RETRYABLE_RENDER_ERRORS.has(entry.messageKey);
}

function updateNotice(entry) {
  if (!entry.noticeEl) return;
  if (!entry.noticeKey) {
    entry.noticeEl.hidden = true;
    entry.noticeEl.textContent = '';
    return;
  }
  const parameters = { ...entry.noticeParameters };
  if (entry.noticeDetailKey) {
    parameters.detail = t(entry.noticeDetailKey, entry.noticeDetailParameters);
  }
  entry.noticeEl.hidden = false;
  entry.noticeEl.dataset.tone = entry.noticeTone || 'info';
  entry.noticeEl.textContent = t(entry.noticeKey, parameters);
}

function setNotice(entry, key, parameters = {}, tone = 'info') {
  entry.noticeKey = key;
  entry.noticeParameters = parameters;
  entry.noticeDetailKey = null;
  entry.noticeDetailParameters = null;
  entry.noticeTone = tone;
  updateNotice(entry);
  updateConfigWarning(entry);
}

function setPreviewStale(entry, key, parameters) {
  entry.noticeKey = 'previewStale';
  entry.noticeParameters = {};
  entry.noticeDetailKey = key;
  entry.noticeDetailParameters = parameters;
  entry.noticeTone = 'error';
  updateNotice(entry);
}

function localizeEntry(entry) {
  entry.bar.setAttribute('aria-label', t('viewOptions'));
  entry.btnDiagram.textContent = t('diagramView');
  entry.btnCode.textContent = t('codeView');
  entry.btnEdit.textContent = t('editView');
  entry.btnFullscreen.textContent = t('fullscreen');
  entry.btnDownloadSvg.textContent = t('downloadSvg');
  entry.btnCopy.textContent = t('copySource');
  entry.btnDownloadMmd.textContent = t('downloadMmd');
  entry.btnReset.textContent = t('reset');
  entry.btnRetry.textContent = t('retryRender');
  entry.editor.setAttribute('aria-label', t('editorLabel'));
  entry.draftHint.textContent = t('draftHint');
  if (entry.statusKey) entry.statusEl.textContent = t(entry.statusKey, entry.statusParameters);
  updateNotice(entry);
  updateConfigWarning(entry);
  localizeGeneratedSvgTitle(
    entry.pane.querySelector('svg'),
    t('diagramTitle', { type: entry.badge.textContent || 'mermaid' }),
  );
  if (entry.messageKey && !entry.pane.querySelector('svg') && entry.pane.dataset.state !== 'ok') {
    const message = t(entry.messageKey, entry.messageParameters);
    entry.pane.textContent = message;
    if (entry.wrapper.dataset.state === 'error') entry.errorEl.textContent = message;
  }
  if (!entry.messageKey) entry.errorEl.textContent = '';
}

function refreshLocale() {
  currentLocale = detectLocale();
  for (const wrapper of wrappers) {
    const entry = entries.get(wrapper._dshCode);
    if (entry) localizeEntry(entry);
  }
  fullscreenViewer.localize();
}

function initializeMermaid(runtime, style) {
  runtime.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    ...JSON.parse(JSON.stringify(style)),
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
  if (hasMermaidLanguage(code.classList)) return true;
  if (hasExplicitLanguage(code.classList)) return false;
  return isMermaidSource((code.textContent || '').trim());
}

function setView(entry, view) {
  entry.wrapper.dataset.view = view;
  entry.btnDiagram.setAttribute('aria-pressed', String(view === 'diagram'));
  entry.btnCode.setAttribute('aria-pressed', String(view === 'code'));
  entry.btnEdit.setAttribute('aria-pressed', String(view === 'edit'));
  if (view === 'edit') {
    if (!entry.draftDirty) syncDraftFromMessage(entry);
    if (entry.editor.value !== entry.draft) entry.editor.value = entry.draft;
  } else if (view === 'code') {
    entry.codePane.textContent = currentRawSource(entry);
  }
  setActionAvailability(entry);
}

function setViewFromControl(entry, view) {
  if (entry.wrapper.dataset.view === view) return;
  const update = () => {
    setView(entry, view);
    if (view === 'edit') entry.editor.focus({ preventScroll: true });
  };
  if (preserveViewPosition) preserveViewPosition(entry, update);
  else update();
}

function setEntryStatus(entry, key, parameters = {}) {
  entry.statusKey = key;
  entry.statusParameters = parameters;
  entry.statusEl.textContent = t(key, parameters);
}

function setEntryRendered(entry) {
  entry.lastRenderState = 'ok';
  entry.failedTarget = null;
  entry.messageKey = null;
  entry.messageParameters = null;
  entry.wrapper.dataset.state = 'ok';
  entry.pane.dataset.state = 'ok';
  entry.errorEl.textContent = '';
  setNotice(entry, null);
  setEntryStatus(entry, 'rendered');
  setActionAvailability(entry);
  if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.setUpdating(false);
}

function setEntryLoading(entry) {
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  entry.wrapper.dataset.state = 'rendering';
  entry.errorEl.textContent = '';
  entry.messageKey = 'rendering';
  entry.messageParameters = {};
  if (hasSvg) {
    entry.pane.dataset.state = 'stale';
    setNotice(entry, 'previewUpdating', {}, 'info');
  } else {
    entry.pane.dataset.state = 'loading';
    entry.pane.textContent = t('rendering');
    setNotice(entry, null);
  }
  setEntryStatus(entry, 'rendering');
  setActionAvailability(entry);
  if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.setUpdating(true);
}

function setEntryError(entry, key, parameters, statusKey = key) {
  const message = t(key, parameters);
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  entry.wrapper.dataset.state = 'error';
  entry.messageKey = key;
  entry.messageParameters = parameters;
  entry.lastRenderState = 'error';
  entry.failedTarget = `${currentRawSource(entry).trim()}\0${currentStyleKey()}`;
  if (hasSvg) {
    entry.pane.dataset.state = 'stale';
    entry.errorEl.textContent = '';
    setPreviewStale(entry, key, parameters);
    setEntryStatus(
      entry,
      statusKey === key && key === 'renderFailed' ? 'previewStaleStatus' : statusKey,
      parameters,
    );
  } else {
    entry.pane.dataset.state = 'error';
    entry.pane.textContent = message;
    entry.errorEl.textContent = message;
    setNotice(entry, null);
    setEntryStatus(entry, statusKey, parameters);
    if (!RETRYABLE_RENDER_ERRORS.has(key) && entry.wrapper.dataset.view === 'diagram') setView(entry, 'edit');
  }
  setActionAvailability(entry);
  if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.close();
}

function setEntryEmpty(entry, key = 'emptyDraft') {
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  const statusKey = hasSvg && key === 'emptyDiagram' ? 'emptyDiagramStale' : key;
  entry.wrapper.dataset.state = 'empty';
  entry.messageKey = key;
  entry.messageParameters = {};
  entry.errorEl.textContent = '';
  entry.lastRenderState = 'empty';
  if (hasSvg) {
    entry.pane.dataset.state = 'stale';
    setNotice(entry, statusKey);
  } else {
    entry.pane.dataset.state = 'empty';
    entry.pane.textContent = t(key);
    setNotice(entry, null);
  }
  setEntryStatus(entry, statusKey);
  setActionAvailability(entry);
}

function downloadSvg(entry) {
  if (!isPreviewFresh(entry)) return;
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

function downloadMmd(entry) {
  const source = currentRawSource(entry);
  const type = diagramType(source.trim()) || diagramType(entry.lastRendered) || 'diagram';
  const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mermaid-${type}.mmd`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setEntryStatus(entry, 'downloadedMmd');
}

function copyWithFallback(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = Boolean(document.execCommand?.('copy'));
  } finally {
    area.remove();
  }
  if (!copied) throw new Error('Clipboard is unavailable.');
}

async function copySource(entry) {
  const source = currentRawSource(entry);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source);
    else copyWithFallback(source);
    setEntryStatus(entry, 'copied');
  } catch {
    setEntryStatus(entry, 'copyFailed');
  }
}

function resetDraft(entry) {
  entry.draft = entry.code.textContent || '';
  entry.draftDirty = false;
  entry.composing = false;
  entry.editor.value = entry.draft;
  entry.codePane.textContent = entry.draft;
  setEntryStatus(entry, 'draftReset');
  setActionAvailability(entry);
  entry.editor.focus({ preventScroll: true });
  scheduleRender(entry);
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
  const btnDiagram = document.createElement('button');
  btnDiagram.type = 'button';
  btnDiagram.className = 'dsh-mmd-btn dsh-mmd-view-control';
  btnDiagram.setAttribute('aria-pressed', 'true');
  const btnCode = document.createElement('button');
  btnCode.type = 'button';
  btnCode.className = 'dsh-mmd-btn dsh-mmd-view-control';
  btnCode.setAttribute('aria-pressed', 'false');
  const btnEdit = document.createElement('button');
  btnEdit.type = 'button';
  btnEdit.className = 'dsh-mmd-btn dsh-mmd-view-control';
  btnEdit.setAttribute('aria-pressed', 'false');
  const btnFullscreen = document.createElement('button');
  btnFullscreen.type = 'button';
  btnFullscreen.className = 'dsh-mmd-btn dsh-mmd-diagram-action';
  const btnDownloadSvg = document.createElement('button');
  btnDownloadSvg.type = 'button';
  btnDownloadSvg.className = 'dsh-mmd-btn dsh-mmd-diagram-action';
  const btnCopy = document.createElement('button');
  btnCopy.type = 'button';
  btnCopy.className = 'dsh-mmd-btn dsh-mmd-source-action';
  const btnDownloadMmd = document.createElement('button');
  btnDownloadMmd.type = 'button';
  btnDownloadMmd.className = 'dsh-mmd-btn dsh-mmd-source-action';
  const btnRetry = document.createElement('button');
  btnRetry.type = 'button';
  btnRetry.className = 'dsh-mmd-btn dsh-mmd-retry';
  const actionSlot = document.createElement('div');
  actionSlot.className = 'dsh-mmd-action-slot';
  actionSlot.append(btnCopy, btnDownloadMmd, btnDownloadSvg, btnFullscreen, btnRetry);
  const body = document.createElement('div');
  body.className = 'dsh-mmd-body';
  const pane = document.createElement('div');
  pane.className = 'dsh-mmd-pane';
  pane.dataset.state = 'loading';
  const codePane = document.createElement('pre');
  codePane.className = 'dsh-mmd-code';
  codePane.tabIndex = -1;
  codePane.textContent = code.textContent || '';
  const editorPane = document.createElement('div');
  editorPane.className = 'dsh-mmd-editor';
  const editor = document.createElement('textarea');
  editor.className = 'dsh-mmd-textarea';
  editor.value = code.textContent || '';
  editor.rows = 10;
  editor.spellcheck = false;
  editor.setAttribute('autocomplete', 'off');
  editor.setAttribute('autocapitalize', 'off');
  editor.setAttribute('wrap', 'off');
  const editorFooter = document.createElement('div');
  editorFooter.className = 'dsh-mmd-editor-footer';
  const draftHint = document.createElement('span');
  draftHint.className = 'dsh-mmd-draft-hint';
  const btnReset = document.createElement('button');
  btnReset.type = 'button';
  btnReset.className = 'dsh-mmd-btn dsh-mmd-reset';
  btnReset.disabled = true;
  editorFooter.append(draftHint, btnReset);
  editorPane.append(editor, editorFooter);
  const noticeEl = document.createElement('div');
  noticeEl.className = 'dsh-mmd-notice';
  noticeEl.hidden = true;
  const configWarning = document.createElement('div');
  configWarning.className = 'dsh-mmd-config-warning';
  configWarning.hidden = true;
  const errorEl = document.createElement('div');
  errorEl.className = 'dsh-mmd-error';
  const statusEl = document.createElement('div');
  statusEl.className = 'dsh-mmd-sr-only';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');

  body.append(pane, codePane, editorPane, configWarning, noticeEl, errorEl, statusEl);
  bar.append(badge, btnCode, btnDiagram, btnEdit, actionSlot);
  wrapper.append(bar, body);

  const entry = {
    code, wrapper, bar, pane, codePane, editorPane, editor, editorFooter, draftHint, btnReset,
    noticeEl, configWarning, errorEl, statusEl, badge, btnDiagram, btnCode, btnEdit,
    btnFullscreen, btnDownloadSvg, btnCopy, btnDownloadMmd, btnRetry, actionSlot,
    draft: code.textContent || '', draftDirty: false, composing: false,
    lastRendered: '', lastRenderedStyleKey: '', lastRenderState: 'idle',
    targetStyleKey: currentStyleKey(), mountId: mount.id,
    stableTimer: null, renderTimer: null, renderGeneration: 0, viewAdjustment: 0,
    messageKey: 'rendering', messageParameters: {},
    statusKey: null, statusParameters: {}, tooltipPositioner,
    noticeKey: null, noticeParameters: {}, noticeDetailKey: null,
    noticeDetailParameters: null, noticeTone: 'info',
  };
  entries.set(code, entry);
  localizeEntry(entry);
  setActionAvailability(entry);

  btnDiagram.addEventListener('click', () => setViewFromControl(entry, 'diagram'));
  btnCode.addEventListener('click', () => setViewFromControl(entry, 'code'));
  btnEdit.addEventListener('click', () => setViewFromControl(entry, 'edit'));
  btnFullscreen.addEventListener('click', () => { if (isPreviewFresh(entry)) fullscreenViewer.open(entry); });
  btnDownloadSvg.addEventListener('click', () => downloadSvg(entry));
  btnCopy.addEventListener('click', () => { void copySource(entry); });
  btnDownloadMmd.addEventListener('click', () => downloadMmd(entry));
  btnReset.addEventListener('click', () => resetDraft(entry));
  btnRetry.addEventListener('click', () => {
    if (btnRetry.hidden) return;
    const hadFocus = document.activeElement === btnRetry;
    scheduleRender(entry, 0);
    if (hadFocus) bar.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  });
  editor.addEventListener('input', () => {
    entry.draft = editor.value;
    entry.draftDirty = true;
    entry.codePane.textContent = entry.draft;
    scheduleRender(entry);
  });
  editor.addEventListener('compositionstart', () => {
    entry.composing = true;
    cancelScheduledRender(entry);
    entry.renderGeneration += 1;
    setEntryLoading(entry);
  });
  editor.addEventListener('compositionend', () => {
    entry.composing = false;
    entry.draft = editor.value;
    entry.draftDirty = true;
    entry.codePane.textContent = entry.draft;
    scheduleRender(entry);
  });

  // Track pending cards too, so disposal also cancels their first-mount timer.
  wrapper._dshCode = code;
  wrappers.add(wrapper);
  entry.stableTimer = setTimeout(() => {
    entry.stableTimer = null;
    const pre = code.closest('pre');
    if (!code.isConnected || !pre?.parentNode) {
      disposeEntry(entry);
      return;
    }
    pre.parentNode.insertBefore(wrapper, pre);
    scheduleRender(entry);
  }, STABLE_MS);
}

async function renderDiagram(entry) {
  // A queued task can outlive its debounce or enter composition while waiting.
  if (entry.composing || entry.renderTimer) return;
  if (!entry.draftDirty) syncDraftFromMessage(entry);
  const raw = currentRawSource(entry);
  const source = raw.trim();
  if (!source) {
    ++entry.renderGeneration;
    if (!entry.draftDirty) {
      disposeEntry(entry);
      return;
    }
    setEntryEmpty(entry);
    return;
  }
  if (canRestorePreview(entry)) {
    setEntryRendered(entry);
    return;
  }

  const generation = ++entry.renderGeneration;
  const owner = mount;
  // The configuration request is shared; style is captured only after it settles.
  let capturedKey;
  const isCurrent = () => mount === owner && owner?.id === entry.mountId
    && generation === entry.renderGeneration && entry.wrapper.isConnected && entry.code.isConnected
    && currentRawSource(entry).trim() === source && (!capturedKey || capturedKey === currentStyleKey());
  entry.badge.textContent = diagramType(source) || 'mermaid';
  if (!entry.draftDirty) entry.codePane.textContent = raw;
  setEntryLoading(entry);

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
    setEntryError(entry, limitMessage.key, limitMessage.parameters);
    return;
  }

  let runtime;
  try {
    const [loadedRuntime, snapshot] = await Promise.all([loadMermaidRuntime().catch(() => null), loadStyle(owner)]);
    runtime = loadedRuntime;
    if (!isCurrent()) return;
    if (!runtime) {
      setEntryError(entry, 'runtimeLoadFailed', {});
      return;
    }
    const style = effectiveStyle(snapshot.style, isDark());
    capturedKey = styleKey(style);
    entry.targetStyleKey = capturedKey;
    initializeMermaid(runtime, style);
    const id = `dsh-mmd-${++uid}`;
    const { svg, bindFunctions } = await runtime.render(id, source);
    if (!isCurrent()) return;
    const markup = document.createElement('template');
    markup.innerHTML = svg;
    const svgElement = markup.content.querySelector('svg');
    if (!svgElement) {
      setEntryError(entry, 'missingSvg', {});
      return;
    }
    if (!hasSvgContent(svgElement)) {
      setEntryEmpty(entry, 'emptyDiagram');
      if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.close();
      return;
    }
    // Binding requires the mounted SVG. Keep the original nodes for rollback
    // so a binding failure cannot separate the preview from lastRendered.
    const previousNodes = [...entry.pane.childNodes];
    try {
      entry.pane.replaceChildren(markup.content);
      ensureSvgAccessibility(svgElement, t('diagramTitle', { type: entry.badge.textContent || 'mermaid' }));
      if (bindFunctions) {
        try {
          bindFunctions(svgElement);
        } finally {
          const positions = entry.tooltipPositioner;
          if (positions && !positions.disposed) {
            positions.instance ||= tooltipPositionerFactory?.(document);
            positions.instance?.trackCurrent();
          }
        }
      }
    } catch (error) {
      entry.pane.replaceChildren(...previousNodes);
      throw error;
    }
    if (!isCurrent()) {
      entry.pane.replaceChildren(...previousNodes);
      return;
    }
    entry.lastRendered = source;
    entry.lastRenderedStyleKey = capturedKey;
    setEntryRendered(entry);
    if (fullscreenViewer.isOpenFor(entry)) fullscreenViewer.update(entry, false);
  } catch (error) {
    if (!isCurrent()) return;
    const parameters = { detail: error?.message || String(error) };
    if (runtime?.isSourceError?.(error)) {
      const hasSvg = Boolean(entry.pane.querySelector('svg'));
      setEntryError(entry, 'renderFailed', parameters, hasSvg ? 'previewStaleStatus' : 'renderFailedStatus');
    } else {
      setEntryError(entry, 'runtimeRenderFailed', parameters);
    }
  }
}

function cancelScheduledRender(entry) {
  if (entry.renderTimer) clearTimeout(entry.renderTimer);
  entry.renderTimer = null;
}

function scheduleRender(entry, delay = RENDER_DEBOUNCE_MS) {
  cancelScheduledRender(entry);
  entry.renderGeneration += 1;
  if (!entry.draftDirty && !entry.composing) {
    syncDraftFromMessage(entry);
    if (!(entry.code.textContent || '').trim()) {
      disposeEntry(entry);
      return;
    }
  }
  // Reflect stale previews during the debounce and while other cards render.
  if (canRestorePreview(entry)) setEntryRendered(entry);
  else if (!currentRawSource(entry).trim()) setEntryEmpty(entry);
  else setEntryLoading(entry);
  if (entry.composing) return;
  entry.renderTimer = setTimeout(() => {
    entry.renderTimer = null;
    enqueueRender(entry);
  }, delay);
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
    const entry = code ? entries.get(code) : null;
    if ((!wrapper.isConnected && !entry?.stableTimer) || !code?.isConnected) {
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
  entriesToRender.forEach((entry) => scheduleRender(entry));
  collectGarbage();
}

function reRenderAll() {
  const key = currentStyleKey();
  for (const wrapper of wrappers) {
    const entry = entries.get(wrapper._dshCode);
    if (entry && entry.targetStyleKey !== key) {
      entry.targetStyleKey = key;
      scheduleRender(entry);
    }
  }
}

function apply(ctx) {
  registerNativeSettings(ctx, typeof require === 'function' ? require : null);
  ctx.effect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;
    if (mount) throw new Error('dsh-mermaid: duplicate client mount');
    const owner = { id: ++mountSequence, loader: createStyleLoader(), snapshot: null, promise: null, warningAnnounced: false };
    mount = owner;
    currentLocale = detectLocale();
    injectCss();
    const positions = { disposed: false, instance: null };
    tooltipPositioner = positions;

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
      if (mount === owner) mount = null;
      owner.loader.dispose();
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
      positions.disposed = true;
      positions.instance?.dispose();
      if (tooltipPositioner === positions) tooltipPositioner = null;
      removeCss();
    };
  });
}

const inject = [];
export { inject, apply, setMermaidRuntimeForTesting };
