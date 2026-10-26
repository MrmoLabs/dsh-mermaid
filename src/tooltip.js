const COORDINATOR = Symbol.for('dsh-mermaid/tooltip-positioning/v1');
const CLASS_NAME = 'dsh-mmd-tooltip-fixed';
const OFFSET_X = '--dsh-mmd-tooltip-offset-x';
const OFFSET_Y = '--dsh-mmd-tooltip-offset-y';

function property(element, name) {
  return { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) };
}

function sameProperty(left, right) {
  return left.value === right.value && left.priority === right.priority;
}

function write(record, name, value, priority = '') {
  record.node.style.setProperty(name, value, priority);
  record.written.set(name, property(record.node, name));
}

function translateComponents(value) {
  if (!value || value === 'none') return ['0px', '0px', '0px'];
  // Computed translate can contain calc() expressions with spaces.
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (index === value.length || (depth === 0 && /\s/.test(char))) {
      if (index > start) parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  return [parts[0] || '0px', parts[1] || '0px', parts[2] || '0px'];
}

function createCoordinator(document) {
  const window = document.defaultView;
  const records = new Map();
  const style = document.createElement('style');
  style.dataset.dshMmdTooltip = 'true';
  style.textContent = '.mermaidTooltip.dsh-mmd-tooltip-fixed{position:fixed!important;top:0;left:0}';
  document.head.appendChild(style);
  const sync = () => {
    for (const record of records.values()) {
      for (const [name, value] of [[OFFSET_X, `${-window.scrollX}px`], [OFFSET_Y, `${-window.scrollY}px`]]) {
        // Another writer may have taken this property over. Do not reclaim it.
        if (sameProperty(property(record.node, name), record.written.get(name))) {
          if (property(record.node, name).value !== value) write(record, name, value);
        }
      }
    }
  };
  window.addEventListener('scroll', sync, { capture: true, passive: true });
  window.addEventListener('resize', sync, { passive: true });
  document.addEventListener('mouseover', sync, { capture: true, passive: true });

  const coordinator = {
    acquire(node) {
      let record = records.get(node);
      if (record) {
        record.references += 1;
        return;
      }
      const original = new Map(['translate', OFFSET_X, OFFSET_Y].map((name) => [name, property(node, name)]));
      const [x, y, z] = translateComponents(window.getComputedStyle(node).getPropertyValue('translate'));
      record = { node, original, written: new Map(), hadClass: node.classList.contains(CLASS_NAME), references: 1 };
      records.set(node, record);
      write(record, OFFSET_X, `${-window.scrollX}px`);
      write(record, OFFSET_Y, `${-window.scrollY}px`);
      write(record, 'translate', `calc(${x} + var(${OFFSET_X})) calc(${y} + var(${OFFSET_Y})) ${z}`, 'important');
      node.classList.add(CLASS_NAME);
    },
    release(node) {
      const record = records.get(node);
      if (!record || --record.references > 0) return;
      // No consumer has positioned an untouched, hidden tooltip yet. Avoid
      // restoring its original static position when our fixed rule goes away.
      if (window.getComputedStyle(node).opacity === '0' && !node.style.left && !node.style.top) {
        node.style.left = '0px';
        node.style.top = '0px';
      }
      for (const [name, previous] of record.original) {
        if (!sameProperty(property(node, name), record.written.get(name))) continue;
        if (previous.value) node.style.setProperty(name, previous.value, previous.priority);
        else node.style.removeProperty(name);
      }
      if (!record.hadClass) node.classList.remove(CLASS_NAME);
      records.delete(node);
      if (!records.size) {
        window.removeEventListener('scroll', sync, true);
        window.removeEventListener('resize', sync);
        document.removeEventListener('mouseover', sync, true);
        style.remove();
        if (document[COORDINATOR] === coordinator) delete document[COORDINATOR];
      }
    },
  };
  document[COORDINATOR] = coordinator;
  return coordinator;
}

function createTooltipPositioner(document) {
  const tracked = new Map();
  let disposed = false;
  return {
    trackCurrent() {
      if (disposed || !document.defaultView) return;
      for (const [node, coordinator] of tracked) {
        if (!node.isConnected) {
          coordinator.release(node);
          tracked.delete(node);
        }
      }
      const node = document.querySelector('.mermaidTooltip');
      if (!node || tracked.has(node)) return;
      const coordinator = document[COORDINATOR] || createCoordinator(document);
      coordinator.acquire(node);
      tracked.set(node, coordinator);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [node, coordinator] of tracked) coordinator.release(node);
      tracked.clear();
    },
  };
}

export { createTooltipPositioner };
