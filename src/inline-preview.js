import { svgDimensions } from './svg.js';

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
    const centerX = (pane.scrollLeft + anchorX) / (pane.scrollWidth || 1);
    const centerY = (pane.scrollTop + anchorY) / (pane.scrollHeight || 1);
    scale = Math.max(0.5, Math.min(8, nextScale));
    if (fit) pane.setAttribute('data-fit', '');
    update(svg);
    pane.scrollLeft = scale === 1 ? 0 : centerX * pane.scrollWidth - anchorX;
    pane.scrollTop = scale === 1 ? 0 : centerY * pane.scrollHeight - anchorY;
    onZoom?.();
  }

  function stop(event) {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    pane.removeAttribute('data-dragging');
  }

  pane.addEventListener('dblclick', (event) => {
    if (event.target.closest?.(INTERACTIVE)) return;
    const bounds = pane.getBoundingClientRect();
    if (scale === 1) zoom(2, event.clientX - bounds.left, event.clientY - bounds.top);
    else zoom(1, undefined, undefined, true);
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
    dispose() { observer.disconnect(); },
  };
}

export { createInlinePreview };
