import { localizeGeneratedSvgTitle, rewriteSvgIds, svgDimensions } from './svg.js';

function createFullscreenViewer({ t }) {
  let viewer = null;

  function updateTransform() {
    if (!viewer) return;
    viewer.stage.style.transform = `translate(-50%,-50%) translate(${viewer.panX}px,${viewer.panY}px) scale(${viewer.scale})`;
    viewer.zoomLabel.textContent = `${Math.round(viewer.scale * 100)}%`;
  }

  function setScale(scale, anchor) {
    if (!viewer) return;
    const previousScale = viewer.scale;
    const nextScale = Math.min(5, Math.max(0.1, scale));
    if (anchor && previousScale > 0 && nextScale !== previousScale) {
      const ratio = nextScale / previousScale;
      viewer.panX = anchor.x - ((anchor.x - viewer.panX) * ratio);
      viewer.panY = anchor.y - ((anchor.y - viewer.panY) * ratio);
    }
    viewer.scale = nextScale;
    updateTransform();
  }

  function fit() {
    if (!viewer) return;
    const svg = viewer.stage.querySelector('svg');
    if (!svg) return;
    const dimensions = svgDimensions(svg);
    const width = viewer.viewport.clientWidth || 1200;
    const height = viewer.viewport.clientHeight || 800;
    viewer.scale = Math.min(4, Math.max(0.1, Math.min((width - 48) / dimensions.width, (height - 48) / dimensions.height)));
    viewer.panX = 0;
    viewer.panY = 0;
    updateTransform();
  }

  function localize() {
    if (!viewer) return;
    viewer.overlay.setAttribute('aria-label', t('viewerLabel'));
    viewer.zoomOut.setAttribute('aria-label', t('zoomOut'));
    viewer.zoomLabel.setAttribute('aria-label', t('resetZoom'));
    viewer.zoomIn.setAttribute('aria-label', t('zoomIn'));
    viewer.fit.textContent = t('fitWindow');
    viewer.fit.setAttribute('aria-label', t('fitWindow'));
    viewer.close.textContent = t('closeViewer');
    viewer.close.setAttribute('aria-label', t('closeViewer'));
    if (viewer.entry) {
      const type = viewer.entry.badge.textContent || 'mermaid';
      viewer.title.textContent = t('viewerTitle', { type });
      localizeGeneratedSvgTitle(viewer.stage.querySelector('svg'), t('diagramTitle', { type }));
    }
  }

  function update(entry, shouldFit) {
    if (!viewer) return;
    const sourceSvg = entry.pane.querySelector('svg');
    if (!sourceSvg) return;
    const clone = sourceSvg.cloneNode(true);
    rewriteSvgIds(clone);
    const dimensions = svgDimensions(clone);
    clone.setAttribute('width', String(dimensions.width));
    clone.setAttribute('height', String(dimensions.height));
    viewer.stage.replaceChildren(clone);
    viewer.title.textContent = t('viewerTitle', { type: entry.badge.textContent || 'mermaid' });
    if (shouldFit) fit();
  }

  function focusableElements() {
    if (!viewer) return [];
    return [...viewer.overlay.querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden);
  }

  function trapFocus(event) {
    if (!viewer || viewer.overlay.hidden || event.key !== 'Tab') return;
    const focusable = focusableElements();
    if (!focusable.length) {
      event.preventDefault();
      viewer.overlay.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if (!viewer.overlay.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close() {
    if (!viewer || viewer.overlay.hidden) return;
    const focusTarget = viewer.trigger;
    viewer.overlay.hidden = true;
    viewer.entry = null;
    viewer.trigger = null;
    viewer.stage.replaceChildren();
    document.body.style.overflow = viewer.previousBodyOverflow;
    for (const [element, wasInert] of viewer.inertedElements) element.inert = wasInert;
    viewer.inertedElements = [];
    if (focusTarget?.isConnected) focusTarget.focus();
  }

  function create() {
    if (viewer) return viewer;
    const overlay = document.createElement('div');
    overlay.className = 'dsh-mmd-viewer';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('viewerLabel'));
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
    const zoomOut = button('−', t('zoomOut'));
    const zoomLabel = button('100%', t('resetZoom'));
    const zoomIn = button('+', t('zoomIn'));
    const fitButton = button(t('fitWindow'), t('fitWindow'));
    const closeButton = button(t('closeViewer'), t('closeViewer'));
    const viewport = document.createElement('div');
    viewport.className = 'dsh-mmd-viewer-viewport';
    const stage = document.createElement('div');
    stage.className = 'dsh-mmd-viewer-stage';
    viewport.appendChild(stage);
    toolbar.append(title, zoomOut, zoomLabel, zoomIn, fitButton, closeButton);
    overlay.append(toolbar, viewport);
    document.body.appendChild(overlay);
    viewer = {
      overlay, title, viewport, stage, zoomOut, zoomLabel, zoomIn,
      fit: fitButton, close: closeButton, entry: null,
      scale: 1, panX: 0, panY: 0, dragging: false, pointerId: null,
      lastX: 0, lastY: 0, previousBodyOverflow: '', trigger: null, inertedElements: [],
    };
    zoomOut.addEventListener('click', () => setScale(viewer.scale / 1.2));
    zoomLabel.addEventListener('click', () => {
      viewer.scale = 1;
      viewer.panX = 0;
      viewer.panY = 0;
      updateTransform();
    });
    zoomIn.addEventListener('click', () => setScale(viewer.scale * 1.2));
    fitButton.addEventListener('click', fit);
    closeButton.addEventListener('click', close);
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const anchor = {
        x: event.clientX - bounds.left - (bounds.width / 2),
        y: event.clientY - bounds.top - (bounds.height / 2),
      };
      setScale(viewer.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), anchor);
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
      updateTransform();
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
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', trapFocus);
    return viewer;
  }

  function open(entry) {
    if (!entry.pane.querySelector('svg')) return;
    const current = create();
    current.entry = entry;
    current.trigger = entry.btnFullscreen;
    current.previousBodyOverflow = document.body.style.overflow;
    current.inertedElements = [...document.body.children]
      .filter((element) => element !== current.overlay)
      .map((element) => [element, Boolean(element.inert)]);
    for (const [element] of current.inertedElements) element.inert = true;
    document.body.style.overflow = 'hidden';
    current.overlay.hidden = false;
    update(entry, true);
    current.close.focus();
  }

  function isOpenFor(entry) {
    return Boolean(viewer && !viewer.overlay.hidden && viewer.entry === entry);
  }

  function isOpen() {
    return Boolean(viewer && !viewer.overlay.hidden);
  }

  function destroy() {
    close();
    viewer?.overlay.remove();
    viewer = null;
  }

  return { close, destroy, fit, isOpen, isOpenFor, localize, open, update };
}

export { createFullscreenViewer };
