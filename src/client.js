import {
  diagramType,
  hasExplicitLanguage,
  hasMermaidLanguage,
  isMermaidSource,
} from './detection.js';
import { resolveLocale, translate } from './i18n.js';
import { CSS } from './styles.js';
import { ensureSvgAccessibility, hasSvgContent, localizeGeneratedSvgTitle, prepareSvgPreview, serializeSvg } from './svg.js';
import { DEFAULT_STYLE, effectiveStyle, styleKey } from './render-config.js';
import { createStyleLoader } from './style-loader.js';
import { FENCE_SELECTOR, registerNativeFences } from './fence-registration.js';
import { registerNativeSettings } from './settings-registration.js';

const TAG_ID = 'dsh-mermaid/css';
const STABLE_MS = 300;
const RENDER_DEBOUNCE_MS = 500;
const MAX_SOURCE_CHARS = 50_000;
const MAX_SOURCE_LINES = 2_000;
const RUNTIME_LOAD_TIMEOUT_MS = 12_000;
const RETRYABLE_RENDER_ERRORS = new Set(['runtimeLoadFailed', 'runtimeRenderFailed', 'missingSvg']);
const RUNTIME_REVISION = typeof __DSH_MERMAID_RUNTIME_REV__ === 'undefined'
  ? 'development'
  : __DSH_MERMAID_RUNTIME_REV__;
const RUNTIME_URL = `/dsh-mermaid/mermaid-runtime.js?rev=${RUNTIME_REVISION}`;
const ENGINE_VERSION = typeof __DSH_MERMAID_VERSION__ === 'undefined' ? 'development' : __DSH_MERMAID_VERSION__;

let uid = 0;
let currentLocale = 'en';
let styleTag = null;
let mermaidRuntime = null;
let runtimePromise = null;
let runtimeRetry = 0;
let renderQueueActive = false;
let tooltipPositioner = null;
let tooltipPositionerFactory = null;
let preserveViewPosition = null;
let fullscreenViewer = null;
let mount = null;
let mountSequence = 0;
const entries = new WeakMap();
const wrappers = new Set();
const renderQueue = [];

function setMermaidRuntimeForTesting(runtime, positionerFactory, viewPositioner, viewerFactory) {
  const previous = mermaidRuntime;
  const previousPromise = runtimePromise;
  const previousPositionerFactory = tooltipPositionerFactory;
  const previousViewPositioner = preserveViewPosition;
  const previousViewer = fullscreenViewer;
  mermaidRuntime = runtime;
  runtimePromise = Promise.resolve(runtime);
  tooltipPositionerFactory = positionerFactory;
  preserveViewPosition = viewPositioner;
  fullscreenViewer = viewerFactory?.({ t }) ?? null;
  return () => {
    mermaidRuntime = previous;
    runtimePromise = previousPromise;
    tooltipPositionerFactory = previousPositionerFactory;
    preserveViewPosition = previousViewPositioner;
    fullscreenViewer = previousViewer;
  };
}

function loadMermaidRuntime() {
  if (mermaidRuntime) return Promise.resolve(mermaidRuntime);
  if (!runtimePromise) {
    let timeout;
    const url = runtimeRetry ? `${RUNTIME_URL}&retry=${runtimeRetry}` : RUNTIME_URL;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        runtimeRetry += 1;
        reject(new Error('Mermaid runtime load timed out'));
      }, RUNTIME_LOAD_TIMEOUT_MS);
    });
    runtimePromise = Promise.race([import(url), deadline])
      .then((module) => {
        mermaidRuntime = {
          initialize: module.default.initialize,
          render: module.renderMermaid,
          isSourceError: module.isMermaidSourceError,
          createInlinePreview: module.createInlinePreview,
          rasterizeSvg: module.rasterizeSvg,
        };
        tooltipPositionerFactory = module.createTooltipPositioner;
        preserveViewPosition = module.preserveViewPosition;
        fullscreenViewer = module.createFullscreenViewer?.({ t }) ?? null;
        return mermaidRuntime;
      })
      .catch((error) => {
        runtimePromise = null;
        throw error;
      })
      .finally(() => clearTimeout(timeout));
  }
  return runtimePromise;
}

function isDark() {
  return document.body?.hasAttribute('data-ds-dark-theme') ?? false;
}

function t(key, parameters) {
  return translate(currentLocale, key, parameters);
}

function detectLocale() {
  const languages = [...(navigator.languages || [])];
  if (navigator.language && !languages.includes(navigator.language)) languages.push(navigator.language);
  return resolveLocale(document.documentElement?.lang, languages);
}

function currentRawSource(entry) {
  if (entry.draftDirty) return entry.draft;
  return messageSource(entry);
}

function messageSource(entry) {
  return entry.nativeSource ?? entry.code.textContent ?? '';
}

function syncDraftFromMessage(entry) {
  if (entry.draftDirty) return false;
  const raw = messageSource(entry);
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
  entry.btnDownloadPng.disabled = !fresh || entry.pngPending;
  entry.btnReset.disabled = !entry.draftDirty;
  entry.btnRetry.hidden = !RETRYABLE_RENDER_ERRORS.has(entry.messageKey);
  entry.errorActions.hidden = entry.wrapper.dataset.state !== 'error';
  const scale = entry.inlinePreview?.scale;
  entry.zoomOut.disabled = !scale || scale <= 0.5;
  entry.zoomIn.disabled = !scale || scale >= 8;
  entry.zoomFit.disabled = !scale;
}

function zoomInline(entry, multiplier) {
  const preview = entry.inlinePreview;
  if (!preview) return;
  preview.zoom(multiplier ? preview.scale * multiplier : 1);
  setActionAvailability(entry);
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
  entry.views.setAttribute('aria-label', t('viewOptions'));
  entry.fileActions.setAttribute('aria-label', t('fileActions'));
  entry.previewControls.setAttribute('aria-label', t('previewControls'));
  entry.pane.setAttribute('aria-label', t('diagramCanvas'));
  entry.btnDiagram.textContent = t('diagramView');
  entry.btnCode.textContent = t('codeView');
  entry.btnEdit.textContent = t('editView');
  entry.btnFullscreen.textContent = t('fullscreen');
  entry.exportButton.textContent = t('export');
  entry.exportMenu.setAttribute('aria-label', t('export'));
  entry.btnDownloadSvg.textContent = t('downloadSvg');
  entry.btnDownloadPng.textContent = t('downloadPng');
  entry.btnCopy.textContent = t('copySource');
  entry.btnDownloadMmd.textContent = t('downloadMmd');
  entry.btnReset.textContent = t('reset');
  entry.btnRetry.textContent = t('retryRender');
  entry.btnDiagnostics.textContent = t('copyDiagnostics');
  entry.zoomOut.setAttribute('aria-label', t('zoomCardOut'));
  entry.zoomFit.textContent = t('fitCard');
  entry.zoomIn.setAttribute('aria-label', t('zoomCardIn'));
  entry.editor.setAttribute('aria-label', t('editorLabel'));
  entry.sourceLabel.textContent = t('sourceLabel');
  entry.previewLabel.textContent = t('previewLabel');
  entry.draftHint.textContent = t('draftHint');
  if (entry.statusKey) entry.statusEl.textContent = t(entry.statusKey, entry.statusParameters);
  updateNotice(entry);
  updateConfigWarning(entry);
  localizeGeneratedSvgTitle(
    entry.pane.querySelector('svg'),
    t('diagramTitle', { type: entry.type }),
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
  fullscreenViewer?.localize();
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
  if (code.closest('.dsh-mmd-native-fence') || (mount?.nativeFencesActive && code.closest(FENCE_SELECTOR))) return false;
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
    entry.preview.append(entry.feedback);
    if (!entry.draftDirty) syncDraftFromMessage(entry);
    if (entry.editor.value !== entry.draft) entry.editor.value = entry.draft;
  } else {
    if (entry.feedback.parentNode !== entry.wrapper) entry.body.before(entry.feedback);
    if (view === 'code') entry.codePane.textContent = currentRawSource(entry);
  }
  setActionAvailability(entry);
  if (view !== 'code' && entry.deferredRender) scheduleRender(entry, 0);
  else if (view !== 'code' && entry.previewNeedsMeasurement && isPreviewFresh(entry)) {
    entry.previewNeedsMeasurement = false;
    const svg = entry.pane.querySelector('svg');
    if (!prepareSvgPreview(svg, entry.renderedType)) {
      svg.remove();
      setEntryEmpty(entry, 'emptyDiagram');
    } else entry.inlinePreview?.update(svg);
  }
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
  entry.statusEl.className = key === 'pngExportFailed' ? 'dsh-mmd-export-error' : 'dsh-mmd-sr-only';
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
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.setUpdating(false);
}

function setEntryLoading(entry, deferred = false) {
  const key = deferred ? 'renderDeferred' : 'rendering';
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  entry.wrapper.dataset.state = deferred ? 'pending' : 'rendering';
  entry.errorEl.textContent = '';
  entry.messageKey = key;
  entry.messageParameters = {};
  if (hasSvg) {
    entry.pane.dataset.state = 'stale';
    setNotice(entry, deferred ? key : 'previewUpdating');
  } else {
    entry.pane.dataset.state = 'loading';
    entry.pane.textContent = t(key);
    setNotice(entry, deferred ? key : null);
  }
  setEntryStatus(entry, key);
  setActionAvailability(entry);
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.setUpdating(true);
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
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.close();
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
  if (key === 'emptyDiagram' && fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.close();
}

function downloadFile(entry, blob, type, extension, status) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mermaid-${type}.${extension}`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setEntryStatus(entry, status);
}

async function exportDiagram(entry, extension) {
  if (extension === 'mmd') {
    const source = currentRawSource(entry);
    const type = diagramType(source.trim()) || diagramType(entry.lastRendered) || 'diagram';
    downloadFile(entry, new Blob([source], { type: 'text/plain;charset=utf-8' }), type, extension, 'downloadedMmd');
    return;
  }
  if (!isPreviewFresh(entry)) return;
  const svg = entry.pane.querySelector('svg');
  const type = diagramType(entry.lastRendered) || 'diagram';
  if (extension === 'svg') {
    downloadFile(entry, new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), type, extension, 'downloaded');
    return;
  }
  if (entry.pngPending) return;
  entry.pngPending = true;
  setActionAvailability(entry);
  const isCurrent = () => entry.wrapper.isConnected && entry.pane.querySelector('svg') === svg && isPreviewFresh(entry);
  try {
    const blob = await mermaidRuntime.rasterizeSvg(svg);
    if (isCurrent()) downloadFile(entry, blob, type, extension, 'downloadedPng');
  } catch {
    if (isCurrent()) setEntryStatus(entry, 'pngExportFailed');
  } finally {
    entry.pngPending = false;
    if (entry.wrapper.isConnected) setActionAvailability(entry);
  }
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

async function copyText(entry, text, status) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyWithFallback(text);
    setEntryStatus(entry, status);
  } catch {
    setEntryStatus(entry, 'copyFailed');
  }
}

function resetDraft(entry) {
  entry.draft = messageSource(entry);
  entry.draftDirty = false;
  entry.composing = false;
  entry.editor.value = entry.draft;
  entry.codePane.textContent = entry.draft;
  setEntryStatus(entry, 'draftReset');
  setActionAvailability(entry);
  entry.editor.focus({ preventScroll: true });
  scheduleRender(entry);
}

function createButton(kind = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind ? `dsh-mmd-btn ${kind}` : 'dsh-mmd-btn';
  return button;
}

function createEntry(code, nativeSource) {
  const raw = nativeSource ?? code.textContent ?? '';
  const wrapper = document.createElement('div');
  wrapper.className = 'dsh-mmd';
  wrapper.dataset.view = 'diagram';

  const bar = document.createElement('div');
  bar.className = 'dsh-mmd-bar';
  const views = document.createElement('div');
  views.className = 'dsh-mmd-views';
  views.setAttribute('role', 'group');
  const btnDiagram = createButton('dsh-mmd-view-control');
  btnDiagram.dataset.view = 'diagram';
  btnDiagram.setAttribute('aria-pressed', 'true');
  const btnCode = createButton('dsh-mmd-view-control');
  btnCode.dataset.view = 'code';
  btnCode.setAttribute('aria-pressed', 'false');
  const btnEdit = createButton('dsh-mmd-view-control');
  btnEdit.dataset.view = 'edit';
  btnEdit.setAttribute('aria-pressed', 'false');
  views.append(btnDiagram, btnCode, btnEdit);
  const btnFullscreen = createButton('dsh-mmd-diagram-action dsh-mmd-fullscreen');
  const btnDownloadSvg = createButton('dsh-mmd-diagram-action');
  const btnDownloadPng = createButton();
  const btnCopy = createButton('dsh-mmd-source-action');
  const btnDownloadMmd = createButton('dsh-mmd-source-action');
  const btnRetry = createButton('dsh-mmd-retry');
  const btnDiagnostics = createButton('dsh-mmd-diagnostics');
  const fileActions = document.createElement('div');
  fileActions.className = 'dsh-mmd-file-actions';
  fileActions.setAttribute('role', 'group');
  const exportButton = createButton('dsh-mmd-export');
  const exportMenu = document.createElement('div');
  exportMenu.className = 'dsh-mmd-export-list';
  exportMenu.setAttribute('popover', 'auto');
  exportMenu.setAttribute('role', 'group');
  exportButton.popoverTargetElement = exportMenu;
  exportMenu.append(btnDownloadSvg, btnDownloadPng, btnDownloadMmd);
  fileActions.append(btnCopy, exportButton, exportMenu);
  const errorActions = document.createElement('div');
  errorActions.className = 'dsh-mmd-error-actions';
  errorActions.append(btnRetry, btnDiagnostics);
  const preview = document.createElement('div');
  preview.className = 'dsh-mmd-preview';
  const previewHeader = document.createElement('div');
  previewHeader.className = 'dsh-mmd-panel-head';
  const previewLabel = document.createElement('span');
  previewLabel.className = 'dsh-mmd-preview-label';
  const previewControls = document.createElement('div');
  previewControls.className = 'dsh-mmd-preview-controls';
  previewControls.setAttribute('role', 'group');
  const zoomControls = document.createElement('div');
  zoomControls.className = 'dsh-mmd-inline-zoom';
  const zoomOut = createButton();
  const zoomFit = createButton();
  const zoomIn = createButton();
  zoomControls.append(zoomOut, zoomFit, zoomIn);
  zoomOut.textContent = '−';
  zoomIn.textContent = '+';
  previewControls.append(zoomControls, btnFullscreen);
  const body = document.createElement('div');
  body.className = 'dsh-mmd-body';
  const pane = document.createElement('div');
  pane.className = 'dsh-mmd-pane';
  pane.dataset.state = 'loading';
  pane.setAttribute('role', 'group');
  previewHeader.append(previewLabel, previewControls);
  preview.append(previewHeader, pane);
  const codePane = document.createElement('pre');
  codePane.className = 'dsh-mmd-code';
  codePane.tabIndex = -1;
  codePane.textContent = raw;
  const editorPane = document.createElement('div');
  editorPane.className = 'dsh-mmd-editor';
  const editorHeader = document.createElement('div');
  editorHeader.className = 'dsh-mmd-panel-head';
  const sourceLabel = document.createElement('span');
  const editor = document.createElement('textarea');
  editor.className = 'dsh-mmd-textarea';
  editor.value = raw;
  editor.rows = 10;
  editor.spellcheck = false;
  editor.setAttribute('autocomplete', 'off');
  editor.setAttribute('autocapitalize', 'off');
  editor.setAttribute('wrap', 'off');
  const draftHint = document.createElement('span');
  draftHint.className = 'dsh-mmd-draft-hint';
  const btnReset = createButton('dsh-mmd-reset');
  btnReset.disabled = true;
  editorHeader.append(sourceLabel, btnReset);
  editorPane.append(editorHeader, editor, draftHint);
  const feedback = document.createElement('div');
  feedback.className = 'dsh-mmd-feedback';
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

  body.append(codePane, editorPane, preview, configWarning, statusEl);
  bar.append(views, fileActions);
  feedback.append(noticeEl, errorEl, errorActions);
  wrapper.append(bar, feedback, body);

  const entry = {
    code, wrapper, bar, views, fileActions, preview, previewControls, pane, codePane, editor, body, feedback,
    sourceLabel, previewLabel, draftHint, btnReset, noticeEl, configWarning, errorEl, errorActions, statusEl,
    type: 'mermaid', btnDiagram, btnCode, btnEdit,
    btnFullscreen, btnDownloadSvg, btnDownloadPng, btnCopy, btnDownloadMmd, btnRetry, btnDiagnostics,
    exportButton, exportMenu, pngPending: false,
    zoomOut, zoomFit, zoomIn, inlinePreview: null,
    nativeSource, draft: raw, draftDirty: false, composing: false,
    lastRendered: '', lastRenderedStyleKey: '', lastRenderState: 'idle',
    targetStyleKey: currentStyleKey(), mountId: mount.id,
    retryCount: 0, failureStage: '',
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
  btnFullscreen.addEventListener('click', () => { if (isPreviewFresh(entry)) fullscreenViewer?.open(entry); });
  btnCopy.addEventListener('click', () => { void copyText(entry, currentRawSource(entry), 'copied'); });
  exportMenu.addEventListener('toggle', (event) => {
    if (event.newState !== 'open') return;
    if (!window.CSS.supports('position-area: block-end span-inline-start')) {
      const rect = exportButton.getBoundingClientRect();
      const gap = 4;
      exportMenu.style.left = `${Math.max(gap, rect.right - exportMenu.offsetWidth)}px`;
      exportMenu.style.top = `${rect.bottom + gap + exportMenu.offsetHeight <= window.innerHeight
        ? rect.bottom + gap : Math.max(gap, rect.top - gap - exportMenu.offsetHeight)}px`;
    }
    exportMenu.querySelector('button:enabled')?.focus({ preventScroll: true });
  });
  for (const [button, format] of [[btnDownloadSvg, 'svg'], [btnDownloadPng, 'png'], [btnDownloadMmd, 'mmd']]) {
    button.addEventListener('click', () => {
      exportMenu.hidePopover?.();
      exportButton.focus({ preventScroll: true });
      void exportDiagram(entry, format);
    });
  }
  btnReset.addEventListener('click', () => resetDraft(entry));
  zoomOut.addEventListener('click', () => zoomInline(entry, 1 / 1.5));
  zoomFit.addEventListener('click', () => zoomInline(entry));
  zoomIn.addEventListener('click', () => zoomInline(entry, 1.5));
  btnRetry.addEventListener('click', () => {
    if (btnRetry.hidden) return;
    const hadFocus = document.activeElement === btnRetry;
    entry.retryCount += 1;
    scheduleRender(entry, 0, true);
    if (hadFocus) bar.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  });
  btnDiagnostics.addEventListener('click', () => {
    if (errorActions.hidden) return;
    const report = {
      diagram: entry.type,
      mermaid: ENGINE_VERSION,
      stage: entry.failureStage,
      outcome: entry.messageKey,
      retryAttempts: entry.retryCount,
    };
    void copyText(entry, JSON.stringify(report, null, 2), 'diagnosticsCopied');
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
  if (nativeSource !== undefined) {
    code.append(wrapper);
    scheduleRender(entry, 0);
    return;
  }
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

function updateNativeCard(seat, source) {
  if (!seat) return;
  const entry = entries.get(seat);
  if (!source?.trim()) {
    if (entry) disposeEntry(entry);
    return;
  }
  if (!mount || !seat.isConnected) return;
  if (!entry) createEntry(seat, source);
  else if (entry.nativeSource !== source) {
    entry.nativeSource = source;
    if (!entry.draftDirty) scheduleRender(entry, 0);
  }
}

async function renderDiagram(entry) {
  // A queued task can outlive its debounce or enter composition while waiting.
  if (entry.composing || entry.renderTimer) return;
  if (entry.wrapper.dataset.view === 'code' && !entry.renderInCode) {
    entry.deferredRender = true;
    setEntryLoading(entry, true);
    return;
  }
  entry.renderInCode = false;
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
  entry.type = diagramType(source) || 'mermaid';
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
    entry.failureStage = 'limit';
    setEntryError(entry, limitMessage.key, limitMessage.parameters);
    return;
  }

  let runtime;
  entry.failureStage = 'load';
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
    entry.failureStage = 'initialize';
    initializeMermaid(runtime, style);
    entry.failureStage = 'render';
    const id = `dsh-mmd-${++uid}`;
    const { svg, bindFunctions, diagramType: renderedType } = await runtime.render(id, source);
    if (!isCurrent()) return;
    entry.failureStage = 'svg';
    const markup = document.createElement('template');
    markup.innerHTML = svg;
    const svgElement = markup.content.querySelector('svg');
    if (!svgElement) {
      setEntryError(entry, 'missingSvg', {});
      return;
    }
    if (!hasSvgContent(svgElement)) {
      setEntryEmpty(entry, 'emptyDiagram');
      return;
    }
    // Binding requires the mounted SVG. Keep the original nodes for rollback
    // so a binding failure cannot separate the preview from lastRendered.
    const previousNodes = [...entry.pane.childNodes];
    const { scrollLeft, scrollTop } = entry.pane;
    try {
      entry.pane.replaceChildren(markup.content);
      if (!prepareSvgPreview(svgElement, renderedType)) {
        entry.pane.replaceChildren(...previousNodes);
        setEntryEmpty(entry, 'emptyDiagram');
        return;
      }
      ensureSvgAccessibility(svgElement, t('diagramTitle', { type: entry.type }));
      if (bindFunctions) {
        entry.failureStage = 'bind';
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
    entry.renderedType = renderedType;
    entry.previewNeedsMeasurement = entry.wrapper.dataset.view === 'code';
    entry.inlinePreview ||= runtime.createInlinePreview?.(entry.pane);
    entry.inlinePreview?.update(svgElement);
    entry.pane.scrollLeft = scrollLeft;
    entry.pane.scrollTop = scrollTop;
    setEntryRendered(entry);
    if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.update(entry, false);
  } catch (error) {
    if (!isCurrent()) return;
    const parameters = { detail: error?.message || String(error) };
    if (runtime?.isSourceError?.(error)) {
      entry.failureStage = 'source';
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

function scheduleRender(entry, delay = RENDER_DEBOUNCE_MS, renderInCode = false) {
  cancelScheduledRender(entry);
  entry.renderGeneration += 1;
  if (!entry.draftDirty && !entry.composing) {
    syncDraftFromMessage(entry);
    if (!messageSource(entry).trim()) {
      disposeEntry(entry);
      return;
    }
  }
  entry.deferredRender = false;
  entry.renderInCode = renderInCode;
  if (canRestorePreview(entry)) {
    setEntryRendered(entry);
    return;
  }
  if (!currentRawSource(entry).trim()) {
    setEntryEmpty(entry);
    return;
  }
  // Reflect stale previews during the debounce and while other cards render.
  entry.deferredRender = entry.wrapper.dataset.view === 'code' && !renderInCode;
  setEntryLoading(entry, entry.deferredRender);
  if (entry.composing || entry.deferredRender) return;
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
  entry.inlinePreview?.dispose();
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.close();
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
  const hostRequire = typeof require === 'function' ? require : null;
  registerNativeSettings(ctx, hostRequire);
  ctx.effect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;
    if (mount) throw new Error('dsh-mermaid: duplicate client mount');
    const owner = { id: ++mountSequence, loader: createStyleLoader(), snapshot: null, promise: null, warningAnnounced: false, nativeFencesActive: false };
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
        fullscreenViewer?.close();
      }
    };
    const handleWindowResize = () => {
      if (fullscreenViewer?.isOpen()) fullscreenViewer.fit();
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
      fullscreenViewer?.destroy();
      positions.disposed = true;
      positions.instance?.dispose();
      if (tooltipPositioner === positions) tooltipPositioner = null;
      removeCss();
    };
  });
  registerNativeFences(ctx, hostRequire, updateNativeCard, (active) => {
    if (!mount) return;
    mount.nativeFencesActive = active;
    if (active) {
      for (const wrapper of wrappers) {
        const entry = entries.get(wrapper._dshCode);
        if (entry?.nativeSource === undefined && entry?.code.closest(FENCE_SELECTOR)) disposeEntry(entry);
      }
    }
  });
}

const inject = [];
export { inject, apply, setMermaidRuntimeForTesting };
