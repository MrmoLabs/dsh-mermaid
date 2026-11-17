import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsModel, createSettingsScope, validateDraft } from '../src/settings-model.js';
import { DEFAULT_STYLE } from '../src/render-config.js';

function scopeFor(value = {}) {
  let snapshot = { status: 'ready', writable: true, revision: 1, value };
  const listeners = new Set();
  const calls = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(change) { snapshot = { ...snapshot, ...change }; listeners.forEach((listener) => listener()); },
    async mutate(ops, revision) {
      calls.push({ ops, revision });
      if (revision !== snapshot.revision || !snapshot.writable) return false;
      scope.update({ value: ops[0].value, revision: snapshot.revision + 1 });
      return true;
    },
  };
  return { scope, calls };
}

test('native editor stages example/defaults, preserves inactive variables, and saves one revisioned root mutation', async () => {
  const { scope, calls } = scopeFor({ theme: 'forest' });
  const model = createSettingsModel(scope);
  assert.equal(model.getSnapshot().dirty, false);
  model.indigo();
  assert.equal(calls.length, 0);
  assert.equal(model.getSnapshot().draft.theme, 'base');
  model.editGroup('light', '{"customArray":[1,true,{"color":"red"}]}');
  model.edit('theme', 'forest');
  assert.equal(await model.save(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].revision, 1);
  assert.deepEqual(calls[0].ops[0].path, []);
  assert.deepEqual(scope.getSnapshot().value.themeVariables.light.customArray, [1, true, { color: 'red' }]);
  assert.equal(model.getSnapshot().status, 'saved');
  model.defaults();
  assert.equal(calls.length, 1);
  assert.equal(model.getSnapshot().dirty, true);
  assert.equal(await model.save(), true);
  assert.deepEqual(scope.getSnapshot().value, DEFAULT_STYLE);
  model.dispose();
});

test('invalid JSON, dangerous data and limits never reach persistence and keep the raw draft', async () => {
  const { scope, calls } = scopeFor();
  const model = createSettingsModel(scope);
  for (const [text, code] of [['{"primaryColor":', 'INVALID_JSON'], ['null', 'INVALID_VARIABLES'], ['[]', 'INVALID_VARIABLES'], ['{"constructor":{}}', 'UNSAFE_KEY'], [JSON.stringify({ x: 'a'.repeat(8193) }), 'MAX_STRING']]) {
    model.editGroup('dark', text);
    assert.equal(model.getSnapshot().diagnostics[0].code, code);
    assert.equal(await model.save(), false);
    assert.equal(model.getSnapshot().draft.groups.dark, text);
  }
  assert.equal(calls.length, 0);
  model.dispose();
});

test('external revision changes preserve draft, refuse stale saves and discard reloads current values', async () => {
  const { scope, calls } = scopeFor({ theme: 'forest' });
  const model = createSettingsModel(scope);
  model.edit('theme', 'base');
  scope.update({ value: { theme: 'dark' }, revision: 2 });
  assert.equal(model.getSnapshot().draft.theme, 'base');
  assert.equal(model.getSnapshot().conflict, true);
  assert.equal(await model.save(), false);
  assert.equal(calls[0].revision, 1);
  assert.equal(model.getSnapshot().status, 'failed');
  model.discard();
  assert.equal(model.getSnapshot().draft.theme, 'dark');
  assert.equal(model.getSnapshot().dirty, false);
  model.dispose();
});

test('save failure and false readback retain input; later edits survive a successful pending save', async () => {
  const { scope } = scopeFor();
  const model = createSettingsModel(scope);
  let release;
  scope.mutate = (ops) => new Promise((done) => { release = () => { scope.update({ value: ops[0].value, revision: 2 }); done(true); }; });
  model.edit('theme', 'forest');
  const saving = model.save();
  assert.equal(model.getSnapshot().saving, true);
  assert.equal(await model.save(), false);
  model.edit('look', 'handDrawn');
  release();
  assert.equal(await saving, true);
  assert.equal(model.getSnapshot().dirty, true);
  assert.equal(model.getSnapshot().draft.look, 'handDrawn');
  scope.mutate = async () => true;
  assert.equal(await model.save(), false, 'success without matching readback must not clear a draft');
  assert.equal(model.getSnapshot().status, 'failed');
  scope.mutate = async () => { throw new Error('private error'); };
  assert.equal(await model.save(), false);
  assert.equal(model.getSnapshot().draft.look, 'handDrawn');
  model.dispose();
});

test('read-only, invalid stored settings and disposal are handled without losing accepted host values', async () => {
  const { scope, calls } = scopeFor({ theme: 'misspelling' });
  const model = createSettingsModel(scope);
  assert.equal(model.getSnapshot().storedInvalid, true);
  model.defaults();
  assert.equal(await model.save(), true);
  model.edit('look', 'handDrawn');
  scope.update({ writable: false });
  assert.equal(model.getSnapshot().dirty, true);
  model.discard();
  assert.equal(model.getSnapshot().draft.look, 'classic');
  assert.equal(model.getSnapshot().dirty, false);
  model.edit('theme', 'forest');
  model.indigo();
  assert.equal(model.getSnapshot().draft.theme, 'auto');
  assert.equal(await model.save(), false);
  assert.equal(calls.length, 1);
  model.dispose();
  scope.update({ value: { theme: 'dark' } });
  assert.equal(model.getSnapshot().draft.theme, 'auto');
});

test('simple fields preserve advanced variables and reject editing a malformed JSON group', () => {
  const { scope } = scopeFor();
  const model = createSettingsModel(scope);
  model.editGroup('light', '{"xyChart":{"plotColorPalette":"#abc"},"primaryColor":"#fff"}');
  model.editVariable('light', 'primaryColor', '#123456');
  let validation = validateDraft(model.getSnapshot().draft);
  assert.equal(validation.style.themeVariables.light.xyChart.plotColorPalette, '#abc');
  model.editVariable('light', 'primaryColor', '');
  validation = validateDraft(model.getSnapshot().draft);
  assert.equal(Object.hasOwn(validation.style.themeVariables.light, 'primaryColor'), false);
  model.editGroup('light', '{broken');
  model.editVariable('light', 'primaryColor', '#ffffff');
  assert.equal(model.getSnapshot().draft.groups.light, '{broken');
  model.dispose();
});

test('repairing an invalid theme preserves the saved variable tree', async () => {
  const variables = { common: { fontSize: '16px' }, light: { primaryColor: '#123456', xyChart: { plotColorPalette: '#123456,#abcdef' } }, dark: { mainBkg: '#234567' } };
  const { scope, calls } = scopeFor({ theme: 'bas', themeVariables: variables });
  const model = createSettingsModel(scope);
  assert.equal(model.getSnapshot().dirty, false);
  assert.deepEqual(JSON.parse(model.getSnapshot().draft.groups.light), variables.light);
  assert.equal(model.getSnapshot().draft.theme, 'bas');
  model.edit('theme', 'base');
  assert.equal(await model.save(), true);
  assert.deepEqual(calls[0].ops[0].value.themeVariables, variables);
  model.dispose();
});

test('returning to saved values is clean and JSON formatting alone neither writes nor replaces input', async () => {
  const { scope, calls } = scopeFor({ theme: 'forest', themeVariables: { light: { lineColor: '#123456' } } });
  const model = createSettingsModel(scope);
  model.edit('theme', 'base'); model.edit('theme', 'forest');
  assert.equal(model.getSnapshot().dirty, false);
  const raw = '{ "lineColor" : "#123456" }';
  model.editGroup('light', raw);
  assert.equal(model.getSnapshot().dirty, false);
  assert.equal(model.getSnapshot().draft.groups.light, raw);
  assert.equal(await model.save(), false);
  assert.equal(calls.length, 0);
  model.editGroup('light', '{');
  assert.equal(model.getSnapshot().dirty, true);
  model.editGroup('light', raw);
  assert.equal(model.getSnapshot().dirty, false);
  model.dispose();
});

test('invalid saved structures are not silently dropped by editing supported fields', async () => {
  for (const original of [
    { theme: 'bas', accidental: 1, themeVariables: { light: { primaryColor: '#123456' } } },
    { theme: 'bas', themeVariables: { lite: { primaryColor: '#123456' } } },
    { theme: 'bas', themeVariables: null },
  ]) {
    const { scope, calls } = scopeFor(original);
    const model = createSettingsModel(scope);
    model.edit('theme', 'base');
    assert.equal(await model.save(), false);
    assert.equal(calls.length, 0);
    assert.deepEqual(scope.getSnapshot().value, original);
    model.defaults();
    assert.equal(await model.save(), true, 'an explicit reset may replace the invalid structure');
    model.dispose();
  }
});

test('reverting edits during an in-flight save preserves the intended revert after readback', async () => {
  const { scope } = scopeFor({ theme: 'forest' });
  let release;
  scope.mutate = (ops) => new Promise((done) => { release = () => { scope.update({ value: ops[0].value, revision: 2 }); done(true); }; });
  const model = createSettingsModel(scope);
  model.edit('theme', 'base');
  const saving = model.save();
  model.edit('theme', 'forest');
  release(); await saving;
  assert.equal(model.getSnapshot().draft.theme, 'forest');
  assert.equal(model.getSnapshot().dirty, true);
  model.dispose();
});

test('native settings scope reads missing/null values from the mirror instead of stale decoded form values', async () => {
  let mirrorSnapshot = { view: { writable: true, namespaces: [{ ns: 'ui-mermaid', revision: 1 }] } };
  const listeners = new Set();
  let write;
  const forms = {
    get(id) { assert.equal(id, 'ui-mermaid'); return { getSnapshot: () => ({ value: { theme: 'forest' } }), mutate: async (ops, revision) => { write = { ops, revision }; return true; } }; },
    describe: () => ({ getSnapshot: () => mirrorSnapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } }),
  };
  const scope = createSettingsScope(forms);
  const model = createSettingsModel(scope);
  assert.equal(model.getSnapshot().available, true);
  assert.equal(model.getSnapshot().draft.theme, 'auto');
  assert.equal(model.getSnapshot().storedInvalid, false);
  mirrorSnapshot = { view: { writable: true, namespaces: [{ ns: 'ui-mermaid', revision: 2, value: null }] } };
  listeners.forEach((listener) => listener());
  assert.equal(scope.getSnapshot().value, null);
  assert.equal(model.getSnapshot().storedInvalid, true);
  assert.equal(model.getSnapshot().originalJSON, 'null');
  assert.equal(model.getSnapshot().invalid, true);
  await scope.mutate([{ op: 'set', path: [], value: {} }], 2);
  assert.equal(write.revision, 2);
  model.dispose();
});

test('base color and explicit node fill are independent and clearing fill restores common inheritance', () => {
  const { scope } = scopeFor({ theme: 'base', themeVariables: { common: { mainBkg: '#112233' } } });
  const model = createSettingsModel(scope);
  model.indigo();
  model.editVariable('light', 'primaryColor', '#ff0000');
  let style = validateDraft(model.getSnapshot().draft).style;
  assert.equal(style.themeVariables.light.mainBkg, '#eef2ff');
  model.editVariable('light', 'mainBkg', '#00ff00');
  style = validateDraft(model.getSnapshot().draft).style;
  assert.equal(style.themeVariables.light.primaryColor, '#ff0000');
  assert.equal(style.themeVariables.light.mainBkg, '#00ff00');
  model.editGroup('common', '{"mainBkg":"#112233"}');
  model.editVariable('light', 'mainBkg', '');
  style = validateDraft(model.getSnapshot().draft).style;
  assert.equal(Object.hasOwn(style.themeVariables.light, 'mainBkg'), false);
  assert.equal(style.themeVariables.common.mainBkg, '#112233');
  model.dispose();
});

test('invalid deeply nested JSON remains an editable draft without recursing again for dirty checks', async () => {
  const { scope, calls } = scopeFor();
  const model = createSettingsModel(scope);
  const text = '{"x":'.repeat(5000) + '1' + '}'.repeat(5000);
  assert.doesNotThrow(() => model.editGroup('light', text));
  assert.equal(model.getSnapshot().diagnostics[0].code, 'MAX_DEPTH');
  assert.equal(model.getSnapshot().draft.groups.light, text);
  assert.equal(await model.save(), false);
  assert.equal(calls.length, 0);
  model.dispose();
});
