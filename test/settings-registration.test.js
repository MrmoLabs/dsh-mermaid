import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNativeSettings } from '../src/settings-registration.js';

test('missing optional host services or UI libraries do not prevent diagram plugin mounting', () => {
  assert.doesNotThrow(() => registerNativeSettings({}, () => {}));
  assert.doesNotThrow(() => registerNativeSettings({ inject() { throw new Error('should not inject without host loader'); } }, null));
  assert.doesNotThrow(() => registerNativeSettings({ inject(_services, callback) { callback({ configForms: {}, slots: {} }); } }, () => {}));
  const child = { effect(callback) { return callback(); }, slots: { inject() {}, register() {} }, configForms: { get() {}, describe() {}, whileServed(_names, register) { return register(); } } };
  assert.doesNotThrow(() => registerNativeSettings({ inject(_services, callback) { callback(child); } }, () => { throw new Error('not present on older host'); }));
});

test('native bundle slot registers lazily and disposes with its served namespace', () => {
  let cleanup;
  let registration;
  let disposed = false;
  const child = {
    effect(callback) { cleanup = callback(); },
    configForms: { get(id) { assert.equal(id, 'ui-mermaid'); return {}; }, describe() {}, whileServed(names, register) { assert.deepEqual(names, ['ui-mermaid']); return register(); } },
    slots: { inject(name, callback) { assert.equal(name, 'plugins.bundle.config'); return callback(); }, register(options, component) { registration = { options, component }; return () => { disposed = true; }; } },
  };
  registerNativeSettings({ inject(names, callback) { assert.deepEqual(names, ['slots', 'locale', 'configForms']); callback(child); } }, (name) => name === 'react' ? { useSyncExternalStore() {} } : { SettingsForm() {}, Button() {}, Input() {} });
  assert.equal(registration.options.key, 'dsh-mermaid');
  assert.equal(typeof registration.component, 'function');
  cleanup();
  assert.equal(disposed, true);
});
