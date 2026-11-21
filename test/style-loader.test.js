import test from 'node:test';
import assert from 'node:assert/strict';
import { createStyleLoader, validateProtocol } from '../src/style-loader.js';
import { normalizeRenderConfig } from '../src/render-config.js';

const response = (value = normalizeRenderConfig(), options = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...options });

test('loads once lazily and freezes the shared protocol snapshot', async () => {
  let calls = 0;
  const loader = createStyleLoader({ fetch: async (url, options) => {
    calls++;
    assert.equal(url, '/dsh-mermaid/config.json');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    return response(normalizeRenderConfig({ look: 'handDrawn' }));
  } });
  assert.equal(calls, 0);
  const first = loader.load();
  assert.equal(first, loader.load());
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.style.look, 'handDrawn');
  assert.ok(Object.isFrozen(result.style));
  loader.dispose();
});

test('validates complete protocol and never exposes arbitrary diagnostics', () => {
  const valid = normalizeRenderConfig();
  for (const value of [null, {}, { ...valid, schemaVersion: 2 }, { ...valid, status: 'oops' }, { ...valid, style: null },
    { ...valid, diagnostics: [{ code: 'INVALID_THEME', path: 'secret\nvalue' }] },
    { ...valid, diagnostics: [{ code: 'oops', path: '' }] }, { ...valid, diagnostics: [{ code: 'INVALID_THEME', path: 'constructor' }] },
    { ...valid, style: {} }, { ...valid, status: 'fallback' }, { ...valid, style: { theme: 'forest' }, status: 'fallback', diagnostics: [{ code: 'INVALID_THEME', path: 'theme' }] }]) {
    assert.throws(() => validateProtocol(value));
  }
  const fallback = validateProtocol(normalizeRenderConfig({ theme: null }));
  assert.equal(fallback.warning, 'configInvalid');
});

test('HTTP, JSON, protocol and actual streamed byte failures fall back once', async () => {
  for (const makeResponse of [() => response({}, { status: 500 }), () => new Response('{'),
    () => response({ schemaVersion: 2 }), () => new Response('x', { headers: { 'content-type': 'text/plain' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(131073)); controller.close(); } }), { headers: { 'content-type': 'application/json', 'content-length': '1' } })]) {
    let calls = 0;
    const loader = createStyleLoader({ fetch: async () => { calls++; return makeResponse(); } });
    assert.equal((await loader.load()).warning, 'configReadFailed');
    await loader.load();
    assert.equal(calls, 1);
    loader.dispose();
  }
});

test('deadline includes stalled body and abort/unmount ignores late success', async () => {
  let aborted = false;
  const stalled = createStyleLoader({ timeoutMs: 25, fetch: async (_url, { signal }) => {
    signal.addEventListener('abort', () => { aborted = true; });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }), { headers: { 'content-type': 'application/json' } });
  } });
  assert.equal((await stalled.load()).warning, 'configReadFailed');
  assert.equal(aborted, true);
  let resolve;
  const loader = createStyleLoader({ fetch: () => new Promise((done) => { resolve = done; }) });
  const pending = loader.load();
  loader.dispose();
  assert.equal((await pending).warning, 'configReadFailed');
  resolve(response(normalizeRenderConfig({ theme: 'forest' })));
  assert.equal((await loader.load()).style.theme, 'auto');
});

test('a recovery read is shared and only retries a temporary failure once', async () => {
  let calls = 0;
  const loader = createStyleLoader({ fetch: async () => ++calls === 1
    ? response({}, { status: 503 })
    : response(normalizeRenderConfig({ theme: 'forest' })) });
  assert.equal((await loader.load()).warning, 'configReadFailed');
  const retry = loader.retry();
  assert.ok(retry);
  assert.equal(loader.load(), retry);
  assert.equal((await retry).style.theme, 'forest');
  assert.equal(loader.retry(), null);
  assert.equal(calls, 2);
  loader.dispose();

  for (const result of [() => response(undefined, { status: 404 }), () => response({})]) {
    const permanent = createStyleLoader({ fetch: async () => result() });
    await permanent.load();
    assert.equal(permanent.retry(), null);
    permanent.dispose();
  }
});
