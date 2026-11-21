import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNativeFences } from '../src/fence-registration.js';

test('native fence wildcard recognizes unlabelled Mermaid and preserves other fences', () => {
  const layers = new Map();
  const active = [];
  let dispose;
  const react = {
    createElement: (type, props) => ({ type, props }),
    useRef() {},
    useLayoutEffect() {},
  };
  registerNativeFences({ inject(_keys, mount) {
    mount({
      effect(callback) { dispose = callback(); },
      slots: {
        inject(_name, callback) { return callback(); },
        register({ key, id }, layer) {
          assert.equal(id, 'dsh-mermaid/fence');
          layers.set(key, layer);
          return () => layers.delete(key);
        },
      },
    });
  } }, () => react, () => {}, (value) => active.push(value));
  assert.deepEqual([...layers.keys()], [undefined, 'mermaid', 'mermaidjs', 'mmd']);
  const source = { code: 'flowchart LR\nA-->B', streaming: true, children: 'host-source' };
  assert.deepEqual(layers.get(undefined)(source), { type: layers.get('mermaid'), props: source });
  const withDirective = { ...source, code: '%%{init: {"theme":"neutral"}}%% ' + source.code };
  assert.deepEqual(layers.get(undefined)(withDirective), { type: layers.get('mermaid'), props: withDirective });
  assert.equal(layers.get(undefined)({ ...source, lang: 'javascript' }), 'host-source');
  assert.equal(layers.get(undefined)({ ...source, code: 'plain source' }), 'host-source');
  dispose();
  assert.deepEqual(active, [true, false]);
  assert.equal(layers.size, 0);
});
