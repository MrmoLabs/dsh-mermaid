function findScrollContainer(element) {
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (/^(auto|scroll|overlay)$/.test(window.getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement || document.documentElement;
}

// DSH rc.3 retains reader ownership on resize, including collapse to the floor.
// Reuse its action only at the physical floor so it can update follow state and
// saved reading position together. Keep this compatibility bridge scoped to the
// current Chat slot; unknown host controls and locales are left alone.
function reconcileChatTail(wrapper, scroller) {
  if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1) return;
  wrapper.closest('[data-slot="conversation.view"]')
    ?.querySelector('button[aria-label="Back to bottom"],button[aria-label="回到底部"]')?.click();
}

function preserveViewPosition(entry, update) {
  const toolbarTop = entry.bar.getBoundingClientRect().top;
  const previousHeight = entry.wrapper.getBoundingClientRect().height;
  const scroller = findScrollContainer(entry.wrapper);
  const adjustment = ++entry.viewAdjustment;
  update();
  window.requestAnimationFrame(() => {
    if (adjustment !== entry.viewAdjustment || !entry.wrapper.isConnected) return;
    const offset = entry.bar.getBoundingClientRect().top - toolbarTop;
    if (Math.abs(offset) >= 0.5) {
      if (scroller === (document.scrollingElement || document.documentElement)) window.scrollBy(0, offset);
      else scroller.scrollTop += offset;
    }
    if (entry.wrapper.getBoundingClientRect().height < previousHeight) reconcileChatTail(entry.wrapper, scroller);
  });
}

export { preserveViewPosition };
