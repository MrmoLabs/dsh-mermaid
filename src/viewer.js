import { localizeGeneratedSvgTitle, rewriteSvgIds, svgDimensions } from './svg.js';
import { VIEWER_CSS } from './styles.js';
import { bindTouchZoom } from './touch-zoom.js';

function createFullscreenViewer({ t }) {
  let viewer = null;

  function updateTransform() {
    if (!viewer) return;
    viewer.zoomAnimation?.cancel();
    viewer.zoomAnimation = null;
    const { viewport, dimensions, scale } = viewer;
    if (dimensions) {
      const bound = (pan, diagram, available) => {
        if (!available) return pan;
        const overflow = Math.max(0, (diagram * scale - available) / 2);
        return Math.max(-overflow, Math.min(overflow, pan));
      };
      viewer.panX = bound(viewer.panX, dimensions.width, viewport.clientWidth);
      viewer.panY = bound(viewer.panY, dimensions.height, viewport.clientHeight);
    }
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
    viewer.fitted = false;
    updateTransform();
  }

  function resize() {
    if (!viewer || viewer.overlay.hidden || !viewer.dimensions) return;
    const { dimensions } = viewer;
    const width = viewer.viewport.clientWidth || 1200;
    const height = viewer.viewport.clientHeight || 800;
    viewer.fitScale = Math.min(4, Math.max(0.1, Math.min((width - 48) / dimensions.width, (height - 48) / dimensions.height)));
    if (viewer.fitted) {
      viewer.scale = viewer.fitScale;
      viewer.panX = viewer.panY = 0;
    }
    updateTransform();
  }

  function fit() {
    if (!viewer) return;
    viewer.fitted = true;
    resize();
  }

  function animateZoom(change) {
    const stage = viewer.stage;
    const animate = typeof stage.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = animate && window.getComputedStyle(stage).transform;
    change();
    const after = stage.style.transform;
    if (before && before !== 'none') {
      viewer.zoomAnimation = stage.animate([{ transform: before }, { transform: after }], { duration: 100, easing: 'ease-out' });
      // Interrupting the animation is expected when a gesture or resize starts.
      void viewer.zoomAnimation.finished.catch(() => {});
    }
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
    viewer.status.textContent = viewer.updating ? t('previewUpdating') : '';
    if (viewer.entry) {
      const type = viewer.entry.type;
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
    const dimensions = viewer.dimensions = svgDimensions(clone);
    viewer.viewport.style.setProperty('--dsh-mmd-diagram-background', entry.renderedBackground || '');
    clone.setAttribute('width', String(dimensions.width));
    clone.setAttribute('height', String(dimensions.height));
    viewer.stage.replaceChildren(clone);
    viewer.title.textContent = t('viewerTitle', { type: entry.type });
    if (shouldFit) fit();
    else resize();
    setUpdating(entry.streaming);
  }

  function setUpdating(updating) {
    if (!viewer) return;
    viewer.updating = updating;
    viewer.status.hidden = !updating;
    viewer.status.textContent = updating ? t('previewUpdating') : '';
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
    viewer.zoomAnimation?.cancel();
    viewer.dragging = false;
    viewer.pointerId = null;
    delete viewer.viewport.dataset.dragging;
    document.body.style.overflow = viewer.previousBodyOverflow;
    for (const [element, wasInert] of viewer.inertedElements) element.inert = wasInert;
    viewer.inertedElements = [];
    if (focusTarget?.isConnected) {
      const target = focusTarget.disabled
        ? focusTarget.closest('.dsh-mmd')?.querySelector('.dsh-mmd-view-control[aria-pressed="true"]')
        : focusTarget;
      target?.focus({ preventScroll: true });
    }
  }

  function create() {
    if (viewer) return viewer;
    const style = document.createElement('style');
    style.textContent = VIEWER_CSS;
    document.head.append(style);
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
    const status = document.createElement('div');
    status.className = 'dsh-mmd-viewer-status';
    status.hidden = true;
    status.setAttribute('role', 'status');
    toolbar.append(title, zoomOut, zoomLabel, zoomIn, fitButton, closeButton);
    overlay.append(toolbar, status, viewport);
    document.body.appendChild(overlay);
    viewer = {
      overlay, style, title, viewport, stage, status, updating: false, zoomOut, zoomLabel, zoomIn,
      fit: fitButton, close: closeButton, entry: null,
      scale: 1, fitScale: 1, panX: 0, panY: 0, dragging: false, pointerId: null,
      lastX: 0, lastY: 0, previousBodyOverflow: '', trigger: null, inertedElements: [],
    };
    viewer.resizeObserver = new window.ResizeObserver(resize);
    viewer.resizeObserver.observe(viewport);
    zoomOut.addEventListener('click', () => animateZoom(() => setScale(viewer.scale / 1.2)));
    zoomLabel.addEventListener('click', () => {
      viewer.scale = 1;
      viewer.panX = 0;
      viewer.panY = 0;
      viewer.fitted = false;
      updateTransform();
    });
    zoomIn.addEventListener('click', () => animateZoom(() => setScale(viewer.scale * 1.2)));
    fitButton.addEventListener('click', fit);
    closeButton.addEventListener('click', close);
    const anchorAt = (x, y) => {
      const bounds = viewport.getBoundingClientRect();
      return { x: x - bounds.left - bounds.width / 2, y: y - bounds.top - bounds.height / 2 };
    };
    const pan = (dx, dy) => {
      viewer.panX += dx;
      viewer.panY += dy;
      viewer.fitted = false;
      updateTransform();
    };
    bindTouchZoom(viewport, {
      zoom(factor, before, after) {
        setScale(viewer.scale * factor, anchorAt(before.x, before.y));
        pan(after.x - before.x, after.y - before.y);
      },
      doubleTap({ x, y }) {
        if (!viewer.fitted) fit();
        else setScale(viewer.scale * 2, anchorAt(x, y));
      },
      pan,
    });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      setScale(viewer.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), anchorAt(event.clientX, event.clientY));
    }, { passive: false });
    viewport.addEventListener('dblclick', (event) => {
      if (event.sourceCapabilities?.firesTouchEvents || event.target.closest?.('a,button,[role="button"]')) return;
      animateZoom(() => {
        if (!viewer.fitted) fit();
        else setScale(viewer.scale * 2, anchorAt(event.clientX, event.clientY));
      });
    });
    viewport.addEventListener('pointerdown', (event) => {
      if (viewer.dragging || event.button !== 0 || event.pointerType === 'touch' || event.target.closest?.('a,button,[role="button"]')) return;
      viewer.dragging = true;
      viewer.pointerId = event.pointerId;
      viewer.lastX = event.clientX;
      viewer.lastY = event.clientY;
      viewport.dataset.dragging = 'true';
      viewport.setPointerCapture?.(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!viewer.dragging || event.pointerId !== viewer.pointerId) return;
      pan(event.clientX - viewer.lastX, event.clientY - viewer.lastY);
      viewer.lastX = event.clientX;
      viewer.lastY = event.clientY;
    });
    const stopDragging = (event) => {
      if (!viewer.dragging || event.pointerId !== viewer.pointerId) return;
      viewer.dragging = false;
      viewer.pointerId = null;
      delete viewport.dataset.dragging;
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, stopDragging);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', (event) => {
      const directions = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const direction = Object.hasOwn(directions, event.key) && directions[event.key];
      if (!direction || event.altKey || event.ctrlKey || event.metaKey) { trapFocus(event); return; }
      event.preventDefault();
      pan(direction[0] * 48, direction[1] * 48);
    });
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
    viewer?.resizeObserver.disconnect();
    viewer?.overlay.remove();
    viewer?.style.remove();
    viewer = null;
  }

  return { close, destroy, fit, isOpen, isOpenFor, localize, open, update, setUpdating };
}

export { createFullscreenViewer };
