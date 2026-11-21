import { DEFAULT_STYLE, isPlainObject, normalizeRenderConfig, styleKey } from './render-config.js';

const GROUPS = ['common', 'light', 'dark'];
const INDIGO_STYLE = {
  theme: 'base', look: 'classic', themeVariables: {
    common: { fontFamily: '"Noto Sans CJK SC", system-ui, sans-serif', fontSize: '15px' },
    light: { primaryColor: '#e0e7ff', primaryTextColor: '#312e81', primaryBorderColor: '#818cf8', secondaryColor: '#ccfbf1', secondaryBorderColor: '#5eead4', mainBkg: '#eef2ff', lineColor: '#64748b', clusterBkg: '#f8fafc', clusterBorder: '#e2e8f0' },
    dark: { primaryColor: '#312e81', primaryTextColor: '#e0e7ff', primaryBorderColor: '#818cf8', secondaryColor: '#134e4a', secondaryBorderColor: '#5eead4', mainBkg: '#1e293b', lineColor: '#94a3b8', clusterBkg: '#0f1a2b', clusterBorder: '#334155' },
  },
};

function jsonText(value) { return JSON.stringify(value, null, 2) ?? 'null'; }

function draftFor(value) {
  const source = isPlainObject(value) ? value : {};
  const variables = isPlainObject(source.themeVariables) ? source.themeVariables : {};
  return {
    theme: Object.hasOwn(source, 'theme') ? source.theme : DEFAULT_STYLE.theme,
    look: Object.hasOwn(source, 'look') ? source.look : DEFAULT_STYLE.look,
    groups: Object.fromEntries(GROUPS.map((group) => [group, jsonText(Object.hasOwn(variables, group) ? variables[group] : {})])),
    // Preserve unsupported structures too: editing a known field must not erase them.
    extras: Object.fromEntries(Object.entries(source).filter(([key]) => !['theme', 'look', 'themeVariables'].includes(key))),
    variableExtras: Object.fromEntries(Object.entries(variables).filter(([key]) => !GROUPS.includes(key))),
    invalidRoot: value !== undefined && !isPlainObject(value) ? { value } : null,
    invalidVariables: Object.hasOwn(source, 'themeVariables') && !isPlainObject(source.themeVariables) ? { value: source.themeVariables } : null,
  };
}

function validateDraft(draft) {
  if (draft.invalidRoot) return { value: draft.invalidRoot.value, diagnostics: normalizeRenderConfig(draft.invalidRoot.value).diagnostics };
  const variables = {};
  const diagnostics = [];
  for (const group of GROUPS) {
    try { variables[group] = JSON.parse(draft.groups[group].trim() || '{}'); }
    catch { diagnostics.push({ code: 'INVALID_JSON', path: `themeVariables.${group}` }); }
  }
  if (diagnostics.length) return { diagnostics };
  const value = { ...draft.extras, theme: draft.theme, look: draft.look, themeVariables: draft.invalidVariables ? draft.invalidVariables.value : { ...draft.variableExtras, ...variables } };
  const normalized = normalizeRenderConfig(value);
  return { value, diagnostics: normalized.diagnostics, style: normalized.status === 'ready' ? normalized.style : undefined };
}

function draftKey(draft) {
  const result = validateDraft(draft);
  if (result.style) return `valid:${styleKey(result.style)}`;
  // Invalid variable trees are already bounded by the validator. Compare their
  // editable text, rather than traversing rejected deep input a second time.
  return `invalid:${JSON.stringify(draft)}`;
}

// The public describe mirror retains invalid/null JSON that the host's decoded
// ConfigForm.value deliberately does not accept. Writes still use that form.
function createSettingsScope(configForms) {
  const form = configForms.get('ui-mermaid');
  const mirror = configForms.describe();
  let previous;
  let snapshot;
  return {
    getSnapshot() {
      const current = mirror.getSnapshot();
      if (snapshot && current === previous) return snapshot;
      previous = current;
      const view = current.view;
      const namespace = view?.namespaces.find((item) => item.ns === 'ui-mermaid');
      snapshot = { status: namespace ? 'ready' : view ? 'unavailable' : 'loading', writable: Boolean(view?.writable), value: namespace?.value, revision: namespace?.revision };
      return snapshot;
    },
    subscribe: (listener) => mirror.subscribe(listener),
    mutate: (ops, revision) => form.mutate(ops, revision),
  };
}

// A staged form over the host's revisioned configForms service. No second store.
function createSettingsModel(scope) {
  let disposed = false;
  let snapshot;
  let baseline;
  let draft;
  let baselineKey;
  let dirty = false;
  let saving = false;
  let failed = false;
  let saved = false;
  const listeners = new Set();

  function acceptHost() {
    const host = scope.getSnapshot();
    draft = draftFor(host.value);
    baseline = host.revision;
    baselineKey = draftKey(draft);
  }
  function publish() {
    if (disposed) return;
    const host = scope.getSnapshot();
    const validation = validateDraft(draft);
    const stored = normalizeRenderConfig(host.value);
    snapshot = {
      draft: { ...draft, groups: { ...draft.groups } },
      draftStyle: validation.style,
      available: host.status === 'ready' || (host.revision !== undefined && host.writable),
      writable: Boolean(host.writable),
      dirty, saving, failed, invalid: !validation.style || !host.writable,
      diagnostics: validation.diagnostics,
      storedInvalid: host.value !== undefined && stored.status !== 'ready',
      originalJSON: stored.status !== 'ready' ? jsonText(host.value) : '',
      needsProfileRepair: Boolean(draft.invalidRoot || draft.invalidVariables || Object.keys(draft.extras).length || Object.keys(draft.variableExtras).length),
      blockedStructure: Boolean(draft.invalidRoot || draft.invalidVariables),
      conflict: dirty && !saving && baseline !== host.revision,
      status: saving ? 'saving' : failed ? 'failed' : dirty ? 'dirty' : saved ? 'saved' : 'clean',
    };
    for (const listener of listeners) listener();
  }
  function edited() {
    dirty = draftKey(draft) !== baselineKey;
    if (!dirty && scope.getSnapshot().revision !== baseline) acceptHost();
    failed = false;
    saved = false;
    publish();
  }
  function replaceDraft(style) { draft = draftFor(style); edited(); }
  function discard() {
    if (saving) return;
    dirty = false; failed = false; saved = false;
    acceptHost();
    publish();
  }
  async function save() {
    if (disposed || saving || !dirty || !scope.getSnapshot().writable) return false;
    const candidate = validateDraft(draft);
    if (!candidate.style) { publish(); return false; }
    const revision = baseline;
    saving = true; failed = false;
    publish();
    let accepted = false;
    try {
      accepted = await scope.mutate([{ op: 'set', path: [], value: candidate.style }], revision);
      if (disposed) return accepted;
      const host = scope.getSnapshot();
      const readback = normalizeRenderConfig(host.value);
      accepted = accepted && readback.status === 'ready' && styleKey(readback.style) === styleKey(candidate.style);
      if (accepted) {
        baseline = host.revision;
        baselineKey = `valid:${styleKey(readback.style)}`;
        dirty = draftKey(draft) !== baselineKey;
        saved = !dirty;
      }
    } catch { accepted = false; }
    finally {
      if (!disposed) { saving = false; failed = !accepted; publish(); }
    }
    return accepted;
  }
  acceptHost();
  const unsubscribe = scope.subscribe(() => {
    if (!dirty && !saving) acceptHost();
    publish();
  });
  publish();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    edit(field, value) { if (disposed || !scope.getSnapshot().writable) return; draft[field] = value; edited(); },
    editGroup(group, text) { if (disposed || !scope.getSnapshot().writable) return; draft.groups[group] = text; edited(); },
    editVariable(group, key, value) {
      if (disposed || !scope.getSnapshot().writable) return;
      let variables;
      try { variables = JSON.parse(draft.groups[group].trim() || '{}'); } catch { return; }
      if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return;
      if (value === '') delete variables[key]; else variables[key] = value;
      draft.groups[group] = JSON.stringify(variables, null, 2);
      edited();
    },
    defaults() { if (!disposed && scope.getSnapshot().writable) replaceDraft(DEFAULT_STYLE); },
    indigo() { if (!disposed && scope.getSnapshot().writable) replaceDraft(INDIGO_STYLE); },
    discard, save,
    dispose() { disposed = true; unsubscribe(); listeners.clear(); },
  };
}

export { INDIGO_STYLE, createSettingsModel, createSettingsScope, validateDraft };
