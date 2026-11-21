import { svgDimensions } from './svg.js';
import { bindTouchZoom } from './touch-zoom.js';

const INTERACTIVE = 'a,button,input,select,textarea,[role="button"]';

function createInlinePreview(pane, onZoom, onResize) {
  let scale = 1;
  let pointer = null;

  function refreshOverflow() {
    const canPan = pane.scrollWidth > pane.clientWidth || pane.scrollHeight > pane.clientHeight;
    pane.toggleAttribute('data-pannable', canPan);
    pane.tabIndex = canPan ? 0 : -1;
  }

  function update(svg) {
    const { width, height } = svgDimensions(svg);
    pane.style.setProperty('--dsh-mmd-inline-width', `${width}px`);
    pane.style.setProperty('--dsh-mmd-inline-aspect', String(width / height));
    pane.style.setProperty('--dsh-mmd-inline-scale', String(scale));
    refreshOverflow();
  }

  function zoom(nextScale, anchorX = pane.clientWidth / 2, anchorY = pane.clientHeight / 2, fit = false) {
    const svg = pane.querySelector('svg');
    if (!svg) return;
    const before = svg.getBoundingClientRect();
    const viewport = pane.getBoundingClientRect();
    const x = (viewport.left + anchorX - before.left) / (before.width || 1);
    const y = (viewport.top + anchorY - before.top) / (before.height || 1);
    scale = Math.max(0.5, Math.min(8, nextScale));
    if (fit) pane.setAttribute('data-fit', '');
    update(svg);
    const after = svg.getBoundingClientRect();
    pane.scrollLeft = fit ? 0 : pane.scrollLeft + after.left + x * after.width - viewport.left - anchorX;
    pane.scrollTop = fit ? 0 : pane.scrollTop + after.top + y * after.height - viewport.top - anchorY;
    onZoom?.();
  }

  function stop(event) {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    pane.removeAttribute('data-dragging');
  }

  function toggleZoom(x, y) {
    const bounds = pane.getBoundingClientRect();
    if (scale === 1) zoom(2, x - bounds.left, y - bounds.top);
    else zoom(1, undefined, undefined, true);
  }

  pane.addEventListener('dblclick', (event) => {
    if (event.sourceCapabilities?.firesTouchEvents || event.target.closest?.(INTERACTIVE)) return;
    toggleZoom(event.clientX, event.clientY);
  });
  const unbindTouch = bindTouchZoom(pane, {
    zoom(factor, before, after) {
      const bounds = pane.getBoundingClientRect();
      zoom(scale * factor, before.x - bounds.left, before.y - bounds.top);
      pane.scrollLeft += before.x - after.x;
      pane.scrollTop += before.y - after.y;
    },
    doubleTap({ x, y }) { toggleZoom(x, y); },
  });
  pane.addEventListener('pointerdown', (event) => {
    if (pointer || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
    if (!pane.hasAttribute('data-pannable') || event.target.closest?.(INTERACTIVE)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: pane.scrollLeft, top: pane.scrollTop };
  });
  pane.addEventListener('pointermove', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pane.hasAttribute('data-dragging')) {
      if (Math.hypot(dx, dy) < 4) return;
      // Keep ordinary clicks on diagram elements. Capture only after a drag starts.
      pane.setPointerCapture(event.pointerId);
      pane.setAttribute('data-dragging', '');
    }
    pane.scrollLeft = pointer.left - dx;
    pane.scrollTop = pointer.top - dy;
  });
  pane.addEventListener('pointerleave', (event) => {
    if (!pane.hasAttribute('data-dragging')) stop(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pane.addEventListener(type, stop);

  const observer = new pane.ownerDocument.defaultView.ResizeObserver(() => {
    onResize?.();
    refreshOverflow();
  });
  observer.observe(pane);
  return {
    get scale() { return scale; },
    zoom,
    fit() { zoom(1, undefined, undefined, true); },
    update,
    dispose() { observer.disconnect(); unbindTouch(); },
  };
}

export { createInlinePreview };
