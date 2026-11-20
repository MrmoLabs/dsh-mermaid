import { svgDimensions } from './svg.js';

function createInlinePreview(pane) {
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

  function zoom(nextScale) {
    const svg = pane.querySelector('svg');
    if (!svg) return;
    const centerX = (pane.scrollLeft + pane.clientWidth / 2) / (pane.scrollWidth || 1);
    const centerY = (pane.scrollTop + pane.clientHeight / 2) / (pane.scrollHeight || 1);
    scale = Math.max(0.5, Math.min(8, nextScale));
    update(svg);
    pane.scrollLeft = scale === 1 ? 0 : centerX * pane.scrollWidth - pane.clientWidth / 2;
    pane.scrollTop = scale === 1 ? 0 : centerY * pane.scrollHeight - pane.clientHeight / 2;
  }

  function stop(event) {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    pane.removeAttribute('data-dragging');
  }

  pane.addEventListener('pointerdown', (event) => {
    if (pointer || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
    if (!pane.hasAttribute('data-pannable') || event.target.closest?.('a,button,input,select,textarea,[role="button"]')) return;
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

  const observer = new pane.ownerDocument.defaultView.ResizeObserver(refreshOverflow);
  observer.observe(pane);
  return {
    get scale() { return scale; },
    zoom,
    update,
    dispose() { observer.disconnect(); },
  };
}

export { createInlinePreview };
