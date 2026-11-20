function touchPair(first, second) {
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
  };
}

function bindTouchZoom(element, { zoom, doubleTap, pan }) {
  const controller = new element.ownerDocument.defaultView.AbortController();
  const { signal } = controller;
  const points = (event) => Array.from(event.touches).filter((touch) => element.contains(touch.target));
  let pinch;
  let finger;
  let previousTap;
  const reset = () => { pinch = finger = previousTap = undefined; };

  element.addEventListener('touchstart', (event) => {
    const touches = points(event);
    if (touches.length === 2) {
      reset();
      pinch = touchPair(...touches);
    } else if (touches.length === 1 && !event.target.closest?.('a,button,input,select,textarea,[role="button"]')) {
      const [touch] = touches;
      finger = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, moved: false };
    } else reset();
  }, { passive: true, signal });

  element.addEventListener('touchmove', (event) => {
    if (!pinch && !finger) return;
    const touches = points(event);
    if (pinch && touches.length === 2) {
      if (event.cancelable) event.preventDefault();
      const next = touchPair(...touches);
      if (pinch.distance > 0 && next.distance > 0) zoom(next.distance / pinch.distance, pinch, next);
      pinch = next;
    } else if (finger && touches.length === 1) {
      const [touch] = touches;
      const dx = touch.clientX - finger.x;
      const dy = touch.clientY - finger.y;
      if (!finger.moved && Math.hypot(dx, dy) < 8) return;
      finger.moved = true;
      finger.x = touch.clientX;
      finger.y = touch.clientY;
      if (pan) {
        if (event.cancelable) event.preventDefault();
        pan(dx, dy);
      }
    }
  }, { passive: false, signal });

  element.addEventListener('touchend', (event) => {
    if (pinch || !finger || finger.moved || event.timeStamp - finger.time > 300) return reset();
    const tap = { x: finger.x, y: finger.y, time: event.timeStamp };
    finger = undefined;
    if (previousTap && tap.time - previousTap.time < 300 && Math.hypot(tap.x - previousTap.x, tap.y - previousTap.y) < 28) {
      if (event.cancelable) event.preventDefault();
      doubleTap(tap);
      previousTap = undefined;
    } else previousTap = tap;
  }, { passive: false, signal });
  element.addEventListener('touchcancel', reset, { passive: true, signal });
  return () => controller.abort();
}

export { bindTouchZoom };
