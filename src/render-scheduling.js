const LEGACY_SUPERSEDE_GRACE_MS = 1_250;
const pendingAborts = new WeakSet();

function supersedeRender(entry) {
  const controller = entry.renderController;
  if (!controller) return;
  if (entry.draftDirty || entry.nativeSource !== undefined && !entry.streaming) {
    controller.abort();
    return;
  }
  if (entry.streaming || pendingAborts.has(controller)) return;

  // A legacy host cannot distinguish append-only streaming from a replacement.
  // Give the current draw a short chance to finish without reloading Mermaid.
  pendingAborts.add(controller);
  setTimeout(() => {
    if (entry.renderController === controller && entry.renderQueued) controller.abort();
  }, LEGACY_SUPERSEDE_GRACE_MS);
}

export { supersedeRender };
