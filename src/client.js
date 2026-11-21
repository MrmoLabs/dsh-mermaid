import {
  diagramType,
  hasExplicitLanguage,
  hasMermaidLanguage,
  isMermaidSource,
} from './detection.js';
import { resolveLocale, translate } from './i18n.js';
import { CSS, FALLBACK_CSS } from './styles.js';
import { CONVERSATION_SESSION, conversationSession, createDiagramDrafts } from './diagram-drafts.js';
import { DEFAULT_STYLE, MAX_SOURCE_CHARS, effectiveStyle, initializeMermaid, styleKey } from './render-config.js';
import { createStyleLoader } from './style-loader.js';
import { FENCE_SELECTOR, registerNativeFences } from './fence-registration.js';
import { registerNativeSettings } from './settings-registration.js';
import { MERMAID_SETTINGS_SAVED } from './settings-event.js';
import { runtimeUrl } from './runtime-url.js';

const TAG_ID = 'dsh-mermaid/css';
const STABLE_MS = 300;
const RENDER_DEBOUNCE_MS = 500;
const STREAM_PREVIEW_MS = 250;
const LEGACY_SOURCE_WAIT_MS = 3_000;
const MAX_SOURCE_LINES = 2_000;
const RUNTIME_LOAD_TIMEOUT_MS = 12_000;
const RUNTIME_RENDER_TIMEOUT_MS = 15_000;
const LOAD_ERRORS = { 'load-module': 'runtimeLoadFailed', 'load-fetch': 'runtimeFetchFailed', 'load-timeout': 'runtimeLoadTimeout' };
const RETRYABLE_RENDER_ERRORS = new Set([...Object.values(LOAD_ERRORS), 'runtimeRenderFailed', 'runtimeRenderTimeout', 'missingSvg']);
const ENGINE_VERSION = typeof __DSH_MERMAID_VERSION__ === 'undefined' ? 'development' : __DSH_MERMAID_VERSION__;

let uid = 0;
let currentLocale = 'en';
let styleTag = null;
let styleLink = null;
let mermaidRuntime = null;
let svgTools;
let importRuntime = (url) => import(url);
let runtimePromise = null;
let runtimeRetry = 0;
let runtimeLoadFailure = null;
let renderQueueActive = false;
let tooltipPositioner = null;
let tooltipPositionerFactory = null;
let preserveViewPosition = null;
let fullscreenViewer = null;
let mount = null;
const entries = new WeakMap();
const wrappers = new Set();
const renderQueue = [];

function setMermaidRuntimeForTesting(runtime, positionerFactory, viewPositioner, viewerFactory, testSvgTools) {
  const previous = mermaidRuntime;
  const previousPromise = runtimePromise;
  const previousPositionerFactory = tooltipPositionerFactory;
  const previousViewPositioner = preserveViewPosition;
  const previousViewer = fullscreenViewer;
  const previousImport = importRuntime;
  const previousSvgTools = svgTools;
  mermaidRuntime = runtime;
  svgTools = testSvgTools;
  runtimePromise = Promise.resolve(runtime);
  importRuntime = async () => ({
    ...testSvgTools,
    default: runtime,
    renderMermaid: runtime.render,
    isMermaidSourceError: runtime.isSourceError,
    createInlinePreview: runtime.createInlinePreview,
    rasterizeSvg: runtime.rasterizeSvg,
    createTooltipPositioner: positionerFactory,
    preserveViewPosition: viewPositioner,
    createFullscreenViewer: viewerFactory,
  });
  tooltipPositionerFactory = positionerFactory;
  preserveViewPosition = viewPositioner;
  fullscreenViewer = viewerFactory?.({ t }) ?? null;
  return () => {
    mermaidRuntime = previous;
    runtimePromise = previousPromise;
    tooltipPositionerFactory = previousPositionerFactory;
    preserveViewPosition = previousViewPositioner;
    fullscreenViewer = previousViewer;
    importRuntime = previousImport;
    svgTools = previousSvgTools;
  };
}

function withDeadline(work, delay, timeoutError, signal) {
  let timer;
  let abort;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), delay);
    if (signal) {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  });
}

function retireRuntime() {
  mermaidRuntime = runtimePromise = runtimeLoadFailure = null;
  runtimeRetry += 1;
}

function isModuleLoadError(error) {
  return error?.name === 'TypeError' && /failed to fetch|loading (?:dynamically imported )?module|module script/i.test(error.message);
}

function loadMermaidRuntime() {
  if (mermaidRuntime) return Promise.resolve(mermaidRuntime);
  if (!runtimePromise) {
    const url = runtimeUrl(runtimeRetry);
    const timeout = new Error('Mermaid runtime load timed out');
    runtimePromise = withDeadline(importRuntime(url), RUNTIME_LOAD_TIMEOUT_MS, timeout)
      .then((module) => {
        svgTools = module;
        mermaidRuntime = {
          initialize: module.default.initialize,
          render: module.renderMermaid,
          isSourceError: module.isMermaidSourceError,
          createInlinePreview: module.createInlinePreview,
          rasterizeSvg: module.rasterizeSvg,
        };
        tooltipPositionerFactory = module.createTooltipPositioner;
        preserveViewPosition = module.preserveViewPosition;
        fullscreenViewer ||= module.createFullscreenViewer?.({ t });
        return mermaidRuntime;
      })
      .catch((error) => {
        runtimeLoadFailure = error === timeout ? 'load-timeout'
          : isModuleLoadError(error) ? 'load-fetch' : 'load-module';
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

function matchingPreview(entry) {
  if (!entry.lastRendered || entry.composing || currentRawSource(entry).trim() !== entry.lastRendered ||
      entry.lastRenderedStyleKey !== currentStyleKey()) return null;
  return entry.pane.querySelector('svg');
}

function readyPreview(entry) {
  return !entry.streaming && entry.lastRenderState === 'ok' && !entry.previewNeedsMeasurement ? matchingPreview(entry) : null;
}

function viewablePreview(entry) {
  return entry.streaming ? entry.pane.querySelector('svg') : readyPreview(entry);
}

function canRestorePreview(entry) {
  return Boolean(matchingPreview(entry)
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

function loadStyle(owner, request, recovery = false) {
  owner.promise ||= (request || owner.loader.load()).then((snapshot) => {
    if (mount !== owner) return snapshot;
    if (snapshot.warning === 'configReadFailed' && owner.snapshot) snapshot = { ...snapshot, style: owner.snapshot.style };
    owner.snapshot = snapshot;
    for (const wrapper of wrappers) {
      const entry = entries.get(wrapper._dshCode);
      if (entry) updateConfigWarning(entry);
    }
    if (!recovery && snapshot.warning === 'configReadFailed') {
      owner.configRetryTimer = setTimeout(() => {
        const recovery = owner.loader.retry();
        if (!recovery) return;
        owner.promise = null;
        void loadStyle(owner, recovery, true);
      }, 2_000);
    }
    if (request) reRenderAll();
    return snapshot;
  });
  return owner.promise;
}

function setActionAvailability(entry) {
  const ready = Boolean(readyPreview(entry));
  entry.btnFullscreen.disabled = !viewablePreview(entry);
  entry.btnEdit.disabled = entry.streaming;
  entry.btnDownloadSvg.disabled = !ready;
  entry.btnDownloadPng.disabled = entry.btnDownloadPngBackground.disabled = !ready || entry.pngPending;
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
  if (multiplier) preview.zoom(preview.scale * multiplier);
  else preview.fit();
}

function renderMessage(key, parameters) {
  if (key !== 'renderFailed') return t(key, parameters);
  const reason = t(parameters.reason || 'syntaxInvalid');
  return t(parameters.line ? 'renderFailedLine' : key, { line: parameters.line, reason });
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
    parameters.detail = renderMessage(entry.noticeDetailKey, entry.noticeDetailParameters);
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
  entry.btnDownloadPngBackground.textContent = t('downloadPngBackground');
  entry.btnCopy.textContent = t('copySource');
  entry.btnDownloadMmd.textContent = t('downloadMmd');
  entry.btnReset.textContent = t('reset');
  entry.btnRetry.textContent = t('retryRender');
  entry.btnDiagnostics.textContent = t('copyDiagnostics');
  entry.diagnosticsSource.lastChild.textContent = t('includeSource');
  entry.zoomOut.setAttribute('aria-label', t('zoomCardOut'));
  entry.zoomFit.textContent = t('fitCard');
  entry.zoomIn.setAttribute('aria-label', t('zoomCardIn'));
  entry.editor.setAttribute('aria-label', t('editorLabel'));
  entry.sourceLabel.textContent = t('sourceLabel');
  entry.previewLabel.textContent = t('previewLabel');
  entry.draftHint.textContent = t(entry.draftKey ? 'draftHint' : 'draftHintLegacy');
  entry.detailsLabel.textContent = t('errorDetails');
  if (entry.statusKey) entry.statusEl.textContent = t(entry.statusKey, entry.statusParameters);
  updateNotice(entry);
  updateConfigWarning(entry);
  svgTools?.localizeGeneratedSvgTitle(
    entry.pane.querySelector('svg'),
    t('diagramTitle', { type: entry.type }),
  );
  if (entry.messageKey && !entry.pane.querySelector('svg') && entry.pane.dataset.state !== 'ok') {
    const message = renderMessage(entry.messageKey, entry.messageParameters);
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

function injectCss() {
  if (styleTag || !document.head) return;
  styleTag = document.createElement('style');
  styleTag.id = TAG_ID;
  styleTag.textContent = typeof __DSH_MERMAID_STYLE_REV__ === 'undefined' ? CSS : FALLBACK_CSS;
  document.head.appendChild(styleTag);
  if (typeof __DSH_MERMAID_STYLE_REV__ !== 'undefined') {
    styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = `/dsh-mermaid/card.css?rev=${__DSH_MERMAID_STYLE_REV__}`;
    document.head.appendChild(styleLink);
  }
}

function removeCss() {
  styleTag?.remove();
  styleTag = null;
  styleLink?.remove();
  styleLink = null;
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
  for (const button of entry.views.children) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  if (view === 'edit') {
    entry.preview.append(entry.feedback);
    if (!entry.draftDirty) syncDraftFromMessage(entry);
    if (entry.editor.value !== entry.draft) entry.editor.value = entry.draft;
  } else {
    if (entry.feedback.parentNode !== entry.wrapper) entry.body.before(entry.feedback);
    if (view === 'code') entry.codePane.textContent = currentRawSource(entry);
  }
  setActionAvailability(entry);
  if (view !== 'code' && (entry.deferredRender || view === 'edit' && entry.messageKey === 'awaitingSource')) scheduleRender(entry, 0);
  else measurePendingPreview(entry);
}

function measurePendingPreview(entry) {
  if (!entry.previewNeedsMeasurement || entry.lastRenderState !== 'ok') return;
  const svg = matchingPreview(entry);
  if (!svg?.getClientRects().length) return;
  entry.previewNeedsMeasurement = false;
  if (svgTools.prepareSvgPreview(svg, entry.renderedType)) {
    entry.inlinePreview?.update(svg);
    setActionAvailability(entry);
  } else {
    svg.remove();
    setEntryEmpty(entry, 'emptyDiagram');
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

function setErrorDetails(entry, detail = '') {
  entry.errorDetails.open = false;
  entry.errorDetails.hidden = !detail;
  entry.detailText.textContent = detail.slice(0, 4000);
}

function setEntryRendered(entry) {
  entry.lastRenderState = 'ok';
  entry.failedTarget = null;
  entry.messageKey = null;
  entry.messageParameters = null;
  entry.wrapper.dataset.state = 'ok';
  entry.pane.dataset.state = 'ok';
  entry.errorEl.textContent = '';
  setErrorDetails(entry);
  entry.wrapper.toggleAttribute('data-stream-preview', entry.streaming);
  entry.wrapper.inert = false;
  setNotice(entry, entry.streaming ? 'streamingPreview' : null);
  setEntryStatus(entry, entry.streaming ? 'streamingPreview' : 'rendered');
  setActionAvailability(entry);
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.setUpdating(entry.streaming);
}

function setEntryLoading(entry, key = 'rendering') {
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  entry.wrapper.dataset.state = key === 'rendering' ? 'rendering' : 'pending';
  entry.errorEl.textContent = '';
  setErrorDetails(entry);
  entry.messageKey = key;
  entry.messageParameters = {};
  if (hasSvg) {
    entry.pane.dataset.state = 'stale';
    setNotice(entry, key === 'rendering' ? 'previewUpdating' : key);
  } else {
    entry.pane.dataset.state = 'loading';
    entry.pane.textContent = t(key);
    setNotice(entry, key === 'renderDeferred' ? key : null);
  }
  setEntryStatus(entry, key);
  setActionAvailability(entry);
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.setUpdating(true);
}

function setEntryError(entry, key, parameters) {
  if (entry.streaming) return setEntryLoading(entry, 'streamingPreview');
  const message = renderMessage(key, parameters);
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  entry.wrapper.dataset.state = 'error';
  entry.messageKey = key;
  entry.messageParameters = parameters;
  entry.lastRenderState = 'error';
  entry.failedTarget = `${currentRawSource(entry).trim()}\0${currentStyleKey()}`;
  if (entry.diagnosticTarget !== entry.failedTarget) {
    entry.diagnosticTarget = entry.failedTarget;
    entry.diagnosticsSource.firstChild.checked = false;
    entry.diagnosticFailures.clear();
    entry.retryCount = 0;
  }
  const failure = { stage: entry.failureStage, outcome: key, reason: parameters.reason, line: parameters.line };
  const fingerprint = JSON.stringify(failure);
  const previousCount = entry.diagnosticFailures.get(fingerprint)?.occurrences || 0;
  // Retain a short history for this source and theme without recording the source itself.
  entry.diagnosticFailures.delete(fingerprint);
  if (entry.diagnosticFailures.size === 8) entry.diagnosticFailures.delete(entry.diagnosticFailures.keys().next().value);
  entry.diagnosticFailures.set(fingerprint, { ...failure, occurrences: previousCount + 1 });
  setErrorDetails(entry, key === 'renderFailed' ? parameters.detail : '');
  if (hasSvg) {
    entry.pane.dataset.state = 'stale';
    entry.errorEl.textContent = '';
    setPreviewStale(entry, key, parameters);
    setEntryStatus(
      entry,
      key === 'renderFailed' ? 'previewStaleStatus' : key,
      parameters,
    );
  } else {
    entry.pane.dataset.state = 'error';
    entry.pane.textContent = message;
    entry.errorEl.textContent = message;
    setNotice(entry, null);
    setEntryStatus(entry, key === 'renderFailed' ? 'renderFailedStatus' : key, parameters);
    const unconfirmedSource = key === 'renderFailed' && entry.nativeSource === undefined && !entry.draftDirty;
    if (!unconfirmedSource && !RETRYABLE_RENDER_ERRORS.has(key) && entry.wrapper.dataset.view === 'diagram') setView(entry, 'edit');
  }
  setActionAvailability(entry);
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.close();
}

function setEntryEmpty(entry, key = 'emptyDraft') {
  if (entry.streaming) return setEntryLoading(entry, 'streamingPreview');
  const hasSvg = Boolean(entry.pane.querySelector('svg'));
  const statusKey = hasSvg && key === 'emptyDiagram' ? 'emptyDiagramStale' : key;
  entry.wrapper.dataset.state = 'empty';
  entry.messageKey = key;
  entry.messageParameters = {};
  entry.errorEl.textContent = '';
  setErrorDetails(entry);
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

function downloadFile(entry, blob, source, extension, status, suffix = '') {
  const type = diagramType(source) || diagramType(entry.lastRendered) || 'diagram';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mermaid-${type}-${(hash >>> 0).toString(16).padStart(8, '0')}${suffix}.${extension}`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setEntryStatus(entry, status);
}

async function exportDiagram(entry, extension, matchTheme) {
  if (extension === 'mmd') {
    const source = currentRawSource(entry);
    downloadFile(entry, new Blob([source], { type: 'text/plain;charset=utf-8' }), source.trim(), extension, 'downloadedMmd');
    return;
  }
  const svg = readyPreview(entry);
  if (!svg) return;
  const source = entry.lastRendered;
  if (extension === 'svg') {
    const exported = svg.cloneNode(true);
    if (entry.renderedBackground) exported.style.backgroundColor = entry.renderedBackground;
    downloadFile(entry, new Blob([svgTools.serializeSvg(exported)], { type: 'image/svg+xml;charset=utf-8' }), source, extension, 'downloaded');
    return;
  }
  if (entry.pngPending) return;
  entry.pngPending = true;
  setActionAvailability(entry);
  const isCurrent = () => entry.wrapper.isConnected && readyPreview(entry) === svg;
  try {
    const background = matchTheme ? entry.renderedBackground || (isDark() ? '#000' : '#fff') : null;
    const blob = await entry.rasterizeSvg(svg, background);
    if (isCurrent()) downloadFile(entry, blob, source, extension, 'downloadedPng', matchTheme ? '-background' : '');
  } catch {
    if (isCurrent()) setEntryStatus(entry, 'pngExportFailed');
  } finally {
    entry.pngPending = false;
    if (entry.wrapper.isConnected) setActionAvailability(entry);
  }
}

function copyWithFallback(text) {
  const focused = document.activeElement;
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
    focused?.focus({ preventScroll: true });
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
  entry.drafts.remove(entry.draftKey);
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

function createEntry(code, nativeSource, streaming = false) {
  const raw = nativeSource ?? code.textContent ?? '';
  const drafts = mount.drafts;
  const draftSession = conversationSession(code);
  const draftKey = drafts.key(code, draftSession);
  const draft = streaming ? undefined : drafts.get(draftKey, raw);
  const wrapper = document.createElement('div');
  wrapper.className = 'dsh-mmd';

  const bar = document.createElement('div');
  bar.className = 'dsh-mmd-bar';
  const views = document.createElement('div');
  views.className = 'dsh-mmd-views';
  views.setAttribute('role', 'group');
  const viewButtons = ['diagram', 'code', 'edit'].map((view) => {
    const button = createButton('dsh-mmd-view-control');
    button.dataset.view = view;
    return button;
  });
  const [btnDiagram, btnCode, btnEdit] = viewButtons;
  views.append(...viewButtons);
  const btnFullscreen = createButton('dsh-mmd-diagram-action dsh-mmd-fullscreen');
  const btnDownloadSvg = createButton('dsh-mmd-diagram-action');
  const btnDownloadPng = createButton();
  const btnDownloadPngBackground = createButton();
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
  exportMenu.append(btnDownloadSvg, btnDownloadPng, btnDownloadPngBackground, btnDownloadMmd);
  fileActions.append(btnCopy, exportButton, exportMenu);
  const errorActions = document.createElement('div');
  errorActions.className = 'dsh-mmd-error-actions';
  const diagnosticsSource = document.createElement('label');
  const includeSource = document.createElement('input');
  includeSource.type = 'checkbox';
  diagnosticsSource.append(includeSource, document.createTextNode(''));
  errorActions.append(btnRetry, btnDiagnostics, diagnosticsSource);
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
  codePane.textContent = draft ?? raw;
  const editorPane = document.createElement('div');
  editorPane.className = 'dsh-mmd-editor';
  const editorHeader = document.createElement('div');
  editorHeader.className = 'dsh-mmd-panel-head';
  const sourceLabel = document.createElement('span');
  const editor = document.createElement('textarea');
  editor.className = 'dsh-mmd-textarea';
  editor.value = draft ?? raw;
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
  const errorDetails = document.createElement('details');
  errorDetails.className = 'dsh-mmd-error-details';
  const detailsLabel = document.createElement('summary');
  const detailText = document.createElement('pre');
  errorDetails.append(detailsLabel, detailText);
  errorDetails.hidden = true;
  const statusEl = document.createElement('div');
  statusEl.className = 'dsh-mmd-sr-only';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');

  body.append(codePane, editorPane, preview, configWarning, statusEl);
  bar.append(views, fileActions);
  feedback.append(noticeEl, errorEl, errorDetails, errorActions);
  wrapper.append(bar, feedback, body);

  const entry = {
    code, wrapper, bar, views, fileActions, preview, previewControls, pane, codePane, editor, body, feedback,
    sourceLabel, previewLabel, draftHint, btnReset, noticeEl, configWarning, errorEl, errorActions, statusEl,
    type: 'mermaid', btnDiagram, btnCode, btnEdit, errorDetails, detailsLabel, detailText,
    btnFullscreen, btnDownloadSvg, btnDownloadPng, btnDownloadPngBackground, btnCopy, btnDownloadMmd, btnRetry, btnDiagnostics, diagnosticsSource,
    exportButton, exportMenu, pngPending: false,
    zoomOut, zoomFit, zoomIn, inlinePreview: null,
    nativeSource, streaming, drafts, draftSession, draftKey, draftOrigin: raw, draft: draft ?? raw, draftDirty: draft !== undefined, composing: false,
    lastRendered: '', lastRenderedStyleKey: '', lastRenderState: 'idle',
    targetStyleKey: currentStyleKey(),
    retryCount: 0, failureStage: '', diagnosticFailures: new Map(),
    stableTimer: null, renderTimer: null, renderGeneration: 0, viewAdjustment: 0,
    messageKey: 'rendering', messageParameters: {},
    statusKey: null, statusParameters: {}, tooltipPositioner,
    noticeKey: null, noticeParameters: {}, noticeDetailKey: null,
    noticeDetailParameters: null, noticeTone: 'info',
  };
  entries.set(code, entry);
  localizeEntry(entry);
  setView(entry, entry.draftDirty ? 'edit' : 'diagram');

  for (const button of viewButtons) {
    button.addEventListener('click', () => setViewFromControl(entry, button.dataset.view));
  }
  btnFullscreen.addEventListener('click', () => {
    if (viewablePreview(entry)) fullscreenViewer?.open(entry);
  });
  btnCopy.addEventListener('click', () => { void copyText(entry, currentRawSource(entry), 'copied'); });
  exportMenu.addEventListener('toggle', (event) => {
    exportButton.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState !== 'open') return;
    if (!window.CSS.supports('position-area: block-end span-inline-start')) {
      const rect = exportButton.getBoundingClientRect();
      const gap = 4;
      exportMenu.style.left = `${Math.max(gap, rect.right - exportMenu.offsetWidth)}px`;
      exportMenu.style.top = `${rect.bottom + gap + exportMenu.offsetHeight <= window.innerHeight
        ? rect.bottom + gap : Math.max(gap, rect.top - gap - exportMenu.offsetHeight)}px`;
    }
    if (!exportMenu.contains(document.activeElement)) exportMenu.querySelector('button:enabled')?.focus({ preventScroll: true });
  });
  fileActions.addEventListener('keydown', (event) => {
    if (!exportMenu.matches(':popover-open')) return;
    const buttons = [...exportMenu.querySelectorAll('button:enabled')];
    const index = buttons.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 };
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      exportMenu.hidePopover?.();
      exportButton.focus({ preventScroll: true });
    } else if (Object.hasOwn(next, event.key)) {
      event.preventDefault();
      buttons[next[event.key]]?.focus({ preventScroll: true });
    }
  });
  for (const [button, format, matchTheme] of [
    [btnDownloadSvg, 'svg'], [btnDownloadPng, 'png'], [btnDownloadPngBackground, 'png', true], [btnDownloadMmd, 'mmd'],
  ]) {
    button.addEventListener('click', () => {
      exportMenu.hidePopover?.();
      exportButton.focus({ preventScroll: true });
      void exportDiagram(entry, format, matchTheme);
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
    if (runtimeLoadFailure || (entry.failedRuntime && entry.failedRuntime === mermaidRuntime)) retireRuntime();
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
      line: entry.messageParameters?.line,
      retryAttempts: entry.retryCount,
      failures: [...entry.diagnosticFailures.values()],
    };
    if (includeSource.checked) {
      report.source = currentRawSource(entry);
      includeSource.checked = false;
    }
    void copyText(entry, JSON.stringify(report, null, 2), 'diagnosticsCopied');
  });
  function updateDraft() {
    if (!entry.draftDirty) entry.draftOrigin = messageSource(entry);
    entry.draft = editor.value;
    entry.draftDirty = true;
    entry.codePane.textContent = entry.draft;
    if (!entry.composing) drafts.set(entry.draftKey, entry.draftOrigin, entry.draft);
    scheduleRender(entry);
  }
  editor.addEventListener('input', updateDraft);
  editor.addEventListener('compositionstart', () => {
    entry.composing = true;
    cancelScheduledRender(entry);
    entry.renderGeneration += 1;
    setEntryLoading(entry);
  });
  editor.addEventListener('compositionend', () => {
    entry.composing = false;
    updateDraft();
  });

  // Track pending cards too, so disposal also cancels their first-mount timer.
  wrapper._dshCode = code;
  wrappers.add(wrapper);
  if (nativeSource !== undefined) {
    wrapper.toggleAttribute('data-streaming', streaming);
    wrapper.inert = streaming;
    code.append(wrapper);
    mount.viewport?.observe(wrapper);
    scheduleRender(entry, streaming ? STREAM_PREVIEW_MS : 0);
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
    mount.viewport?.observe(wrapper);
    scheduleRender(entry);
  }, STABLE_MS);
}

function updateNativeCard(seat, source, streaming = false) {
  if (!seat) return;
  const entry = entries.get(seat);
  if (!source?.trim()) {
    if (entry) disposeEntry(entry);
    return;
  }
  if (!mount || !seat.isConnected) return;
  if (!entry || entry.draftSession !== conversationSession(seat)) {
    if (entry) disposeEntry(entry);
    createEntry(seat, source, streaming);
  } else if (entry.nativeSource !== source || entry.streaming !== streaming) {
    entry.nativeSource = source;
    entry.streaming = streaming;
    entry.wrapper.toggleAttribute('data-streaming', streaming);
    entry.wrapper.inert = streaming && !entry.wrapper.hasAttribute('data-stream-preview');
    if (entry.draftDirty) { setActionAvailability(entry); return; }
    if (streaming && entry.renderTimer) syncDraftFromMessage(entry);
    else scheduleRender(entry, streaming ? STREAM_PREVIEW_MS : 0);
  }
}

async function renderDiagram(entry) {
  // A queued task can outlive its debounce or enter composition while waiting.
  if (entry.composing || entry.renderTimer) return;
  if (entry.wrapper.dataset.view === 'code' && !entry.renderInCode) {
    entry.deferredRender = true;
    setEntryLoading(entry, 'renderDeferred');
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
  const streaming = entry.streaming;
  const isMounted = () => mount === owner && entry.wrapper.isConnected && entry.code.isConnected
    && (!capturedKey || capturedKey === currentStyleKey());
  const isCurrent = () => isMounted() && generation === entry.renderGeneration && currentRawSource(entry).trim() === source;
  const canDisplay = () => isCurrent() || (streaming && entry.streaming && isMounted()
    && entry.wrapper.dataset.view !== 'code' && currentRawSource(entry).trim().startsWith(source));
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
  let controller;
  const renderTimeout = new Error('Mermaid render timed out');
  entry.failureStage = 'load';
  entry.failedRuntime = null;
  try {
    const [loadedRuntime, snapshot] = await Promise.all([loadMermaidRuntime().catch(() => null), loadStyle(owner)]);
    runtime = loadedRuntime;
    if (!isCurrent()) return;
    if (!runtime) {
      entry.failureStage = runtimeLoadFailure || 'load-module';
      setEntryError(entry, LOAD_ERRORS[entry.failureStage], {});
      return;
    }
    const style = effectiveStyle(snapshot.style, isDark());
    capturedKey = styleKey(style);
    entry.targetStyleKey = capturedKey;
    entry.failureStage = 'initialize';
    initializeMermaid(runtime, style);
    entry.failureStage = 'render';
    const id = `dsh-mmd-${++uid}`;
    controller = entry.renderController = new AbortController();
    const { svg, bindFunctions, diagramType: renderedType, background } = await withDeadline(
      runtime.render(id, source, controller.signal, streaming), RUNTIME_RENDER_TIMEOUT_MS, renderTimeout, controller.signal,
    );
    if (!canDisplay()) return;
    entry.failureStage = 'svg';
    const markup = document.createElement('template');
    markup.innerHTML = svg;
    const svgElement = markup.content.querySelector('svg');
    if (!svgElement) {
      setEntryError(entry, 'missingSvg', {});
      return;
    }
    if (!svgTools.hasSvgContent(svgElement)) {
      setEntryEmpty(entry, 'emptyDiagram');
      return;
    }
    // Binding requires the mounted SVG. Keep the original nodes for rollback
    // so a binding failure cannot separate the preview from lastRendered.
    const previousNodes = [...entry.pane.childNodes];
    const { scrollLeft, scrollTop } = entry.pane;
    let measured;
    try {
      entry.pane.replaceChildren(markup.content);
      svgTools.applyDiagramPalette(svgElement, renderedType, background);
      measured = svgTools.prepareSvgPreview(svgElement, renderedType);
      if (measured === false) {
        entry.pane.replaceChildren(...previousNodes);
        setEntryEmpty(entry, 'emptyDiagram');
        return;
      }
      svgTools.ensureSvgAccessibility(svgElement, t('diagramTitle', { type: entry.type }));
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
    if (!canDisplay()) {
      entry.pane.replaceChildren(...previousNodes);
      return;
    }
    entry.lastRendered = source;
    entry.lastRenderedStyleKey = capturedKey;
    entry.renderedType = renderedType;
    entry.renderedBackground = background;
    entry.rasterizeSvg = runtime.rasterizeSvg;
    entry.previewNeedsMeasurement = measured === null;
    entry.pane.style.setProperty('--dsh-mmd-diagram-background', background || '');
    entry.inlinePreview ||= runtime.createInlinePreview?.(
      entry.pane, () => setActionAvailability(entry), () => measurePendingPreview(entry),
    );
    entry.inlinePreview?.update(svgElement);
    entry.pane.scrollLeft = scrollLeft;
    entry.pane.scrollTop = scrollTop;
    setEntryRendered(entry);
    if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.update(entry, false);
  } catch (error) {
    if (controller?.signal.aborted || error === renderTimeout) {
      // A cancelled render can leave Mermaid's internal queue occupied.
      // Use an independent module graph for the next card.
      controller.abort(error);
      if (runtime === mermaidRuntime) retireRuntime();
      if (error === renderTimeout && isCurrent()) {
        entry.failureStage = 'render-timeout';
        setEntryError(entry, 'runtimeRenderTimeout', {});
      }
      return;
    }
    if (!isCurrent()) return;
    const sourceError = runtime?.isSourceError?.(error);
    if (!sourceError && entry.failureStage === 'render' && isModuleLoadError(error) && runtime === mermaidRuntime) {
      // A failed chunk import is cached by URL. Retry from a fresh module graph.
      entry.failedRuntime = runtime;
      entry.failureStage = 'load-fetch';
      setEntryError(entry, 'runtimeFetchFailed', {});
      return;
    }
    const parameters = { detail: error?.message || String(error) };
    if (sourceError) {
      if (error.line) parameters.line = error.line + (raw.slice(0, raw.length - raw.trimStart().length).match(/\r\n|\r|\n/g)?.length || 0);
      parameters.reason = error.reason;
      entry.failureStage = 'source';
      const reportError = () => setEntryError(entry, 'renderFailed', parameters);
      if (error.incomplete && entry.nativeSource === undefined && !entry.draftDirty && entry.wrapper.dataset.view === 'diagram') {
        setEntryLoading(entry, 'awaitingSource');
        entry.sourceWaitTimer = setTimeout(() => {
          entry.sourceWaitTimer = null;
          if (isCurrent()) reportError();
        }, LEGACY_SOURCE_WAIT_MS);
      } else reportError();
    } else {
      setEntryError(entry, 'runtimeRenderFailed', parameters);
    }
  } finally {
    entry.renderController = null;
  }
}

function cancelScheduledRender(entry) {
  if (entry.renderTimer) clearTimeout(entry.renderTimer);
  if (entry.sourceWaitTimer) clearTimeout(entry.sourceWaitTimer);
  entry.renderTimer = null;
  entry.sourceWaitTimer = null;
}

function scheduleRender(entry, delay = RENDER_DEBOUNCE_MS, renderInCode = false) {
  cancelScheduledRender(entry);
  entry.renderGeneration += 1;
  entry.waitingForViewport = false;
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
  setEntryLoading(entry, entry.deferredRender ? 'renderDeferred' : 'rendering');
  if (entry.composing || entry.deferredRender) return;
  entry.renderTimer = setTimeout(() => {
    entry.renderTimer = null;
    enqueueRender(entry);
  }, delay);
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function canRenderInViewport(entry) {
  return !mount?.viewport || entry.nearViewport || entry.renderInCode || entry.draftDirty || fullscreenViewer?.isOpenFor(entry);
}

function waitForViewport(entry) {
  entry.waitingForViewport = true;
  setEntryLoading(entry, 'awaitingViewport');
}

function enqueueRender(entry) {
  if (entry.renderQueued) return;
  if (!canRenderInViewport(entry)) return waitForViewport(entry);
  svgTools?.supersedeRender?.(entry);
  entry.waitingForViewport = false;
  entry.renderQueued = true;
  const bounds = mount?.viewport && entry.wrapper.getBoundingClientRect();
  if (bounds && bounds.bottom > 0 && bounds.top < window.innerHeight) renderQueue.unshift(entry);
  else renderQueue.push(entry);
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
        if (!canRenderInViewport(entry) && entry.wrapper.dataset.view !== 'code') {
          waitForViewport(entry);
          continue;
        }
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
  cancelScheduledRender(entry);
  entry.renderGeneration += 1;
  entry.renderController?.abort();
  mount?.viewport?.unobserve(entry.wrapper);
  entry.inlinePreview?.dispose();
  if (fullscreenViewer?.isOpenFor(entry)) fullscreenViewer.close();
  entry.wrapper.remove();
  wrappers.delete(entry.wrapper);
  entries.delete(entry.code);
}

function collectGarbage(conversationChanged) {
  for (const wrapper of wrappers) {
    const code = wrapper._dshCode;
    const entry = code ? entries.get(code) : null;
    const rebind = conversationChanged && code?.isConnected && entry && entry.draftSession !== conversationSession(code);
    if (rebind || (!wrapper.isConnected && !entry?.stableTimer) || !code?.isConnected) {
      if (entry) {
        disposeEntry(entry);
        if (rebind && entry.nativeSource !== undefined) createEntry(code, entry.nativeSource, entry.streaming);
        else if (code.isConnected) maybeEnhance(code);
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
  collectGarbage(mutations.some(({ type }) => type === 'attributes'));
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
    const owner = { drafts: createDiagramDrafts(), loader: createStyleLoader(), snapshot: null, promise: null, warningAnnounced: false, nativeFencesActive: false };
    if (document.documentElement.clientHeight && window.IntersectionObserver) {
      owner.viewport = new window.IntersectionObserver((changes) => {
        for (const change of changes) {
          const entry = entries.get(change.target._dshCode);
          if (!entry || entry.wrapper !== change.target) continue;
          entry.nearViewport = change.isIntersecting;
          if (entry.nearViewport && entry.waitingForViewport) enqueueRender(entry);
        }
      }, { rootMargin: '360px 0px' });
    }
    mount = owner;
    currentLocale = detectLocale();
    injectCss();
    const positions = { disposed: false, instance: null };
    tooltipPositioner = positions;

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributeFilter: [CONVERSATION_SESSION] });
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
    const refreshSettings = () => {
      owner.settingsRefresh = (owner.settingsRefresh || Promise.resolve()).then(async () => {
        await owner.promise;
        if (mount !== owner) return;
        clearTimeout(owner.configRetryTimer);
        owner.promise = null;
        await loadStyle(owner, owner.loader.refresh());
      });
    };
    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener(MERMAID_SETTINGS_SAVED, refreshSettings);

    document.querySelectorAll('pre code').forEach(maybeEnhance);

    return () => {
      if (mount === owner) mount = null;
      clearTimeout(owner.configRetryTimer);
      owner.loader.dispose();
      owner.viewport?.disconnect();
      observer.disconnect();
      themeObserver.disconnect();
      localeObserver.disconnect();
      document.removeEventListener('keydown', handleDocumentKeydown);
      window.removeEventListener(MERMAID_SETTINGS_SAVED, refreshSettings);
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
  }, t);
}

const inject = [];
export { inject, apply, setMermaidRuntimeForTesting };
