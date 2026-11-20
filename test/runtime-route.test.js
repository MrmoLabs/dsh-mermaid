import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, CONFIG_PATH, RUNTIME_PATH, SETTINGS_PATH, apply, inject } from '../src/index.js';
import { updateVolatile } from '@deepseek-ai/cosmokit';
import { normalizeRenderConfig } from '../src/render-config.js';

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('host face exposes the bundled Mermaid runtime as a read-only route', async () => {
  assert.deepEqual(inject, ['webServer']);
  let route;
  const ctx = {
    effect(register) {
      return register();
    },
    webServer: {
      register(value) {
        if (value.path === RUNTIME_PATH) route = value;
        return () => {
          route = null;
        };
      },
    },
  };

  apply(ctx);
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, RUNTIME_PATH);

  const getResponse = responseRecorder();
  await route.handler({ method: 'GET' }, getResponse);
  assert.equal(getResponse.status, 200);
  assert.match(getResponse.headers['content-type'], /text\/javascript/);
  assert.equal(getResponse.headers['cache-control'], 'no-cache');
  assert.ok(getResponse.body.length > 0);

  const headResponse = responseRecorder();
  await route.handler({ method: 'HEAD' }, headResponse);
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.body, undefined);

  const postResponse = responseRecorder();
  await route.handler({ method: 'POST' }, postResponse);
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.body, undefined);
});

test('config route is read-only, bounded to its protocol, and rejects duplicate registration', async () => {
  const routes = new Map();
  const cleanups = [];
  const server = { register(route) {
    assert.equal(routes.has(route.path), false);
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  } };
  const ctx = { webServer: server, effect(callback) { cleanups.push(callback()); } };
  const config = { theme: 'base', look: 'handDrawn', themeVariables: { common: { primaryColor: '#abc' } } };
  apply(ctx, config);
  config.theme = 'dark';
  const route = routes.get(CONFIG_PATH);
  const get = responseRecorder();
  await route.handler({ method: 'GET' }, get);
  assert.equal(get.status, 200);
  assert.equal(get.headers['cache-control'], 'no-store');
  assert.equal(get.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(get.headers['access-control-allow-origin'], undefined);
  assert.equal(JSON.parse(get.body).style.theme, 'base');
  const head = responseRecorder();
  route.handler({ method: 'HEAD' }, head);
  assert.equal(head.status, get.status);
  assert.deepEqual(head.headers, get.headers);
  assert.equal(head.body, undefined);
  const post = responseRecorder();
  route.handler({ method: 'POST' }, post);
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.throws(() => apply(ctx, {}), /duplicate instance/);
  while (cleanups.length) cleanups.pop()?.();
  assert.equal(routes.size, 0);
  apply(ctx, { theme: 'secret input' });
  const invalid = responseRecorder();
  routes.get(CONFIG_PATH).handler({ method: 'GET' }, invalid);
  assert.equal(invalid.status, 200);
  assert.equal(JSON.parse(invalid.body).status, 'fallback');
  assert.doesNotMatch(invalid.body, /secret input/);
  while (cleanups.length) cleanups.pop()?.();
});

test('native host config reference updates the endpoint without remounting and preserves fallback diagnostics', () => {
  const routes = new Map();
  const cleanups = [];
  const reference = Config({ theme: 'forest' });
  apply({ effect(callback) { cleanups.push(callback()); }, webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } }, reference);
  const read = () => { const response = responseRecorder(); routes.get(CONFIG_PATH).handler({ method: 'GET' }, response); return JSON.parse(response.body); };
  assert.equal(read().style.theme, 'forest');
  updateVolatile(reference, Config({ theme: 'base', themeVariables: { light: { primaryColor: '#abc' } } }));
  assert.equal(read().style.theme, 'base');
  assert.equal(read().style.themeVariables.light.primaryColor, '#abc');
  updateVolatile(reference, Config({ theme: 'invalid' }));
  assert.equal(read().status, 'fallback');
  assert.equal(reference.get().theme, 'invalid', 'endpoint must not rewrite host-owned config');
  for (const cleanup of cleanups.reverse()) cleanup?.();
});

test('native settings runtime is an independently cached read-only asset', async () => {
  const routes = new Map();
  const cleanups = [];
  apply({ effect(callback) { cleanups.push(callback()); }, webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } });
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = responseRecorder();
    await routes.get(SETTINGS_PATH).handler({ method }, response);
    assert.equal(response.status, method === 'POST' ? 405 : 200);
    if (method === 'GET') { assert.match(response.headers['cache-control'], /immutable/); assert.match(String(response.body), /registerSettingsRuntime/); }
    else assert.equal(response.body, undefined);
    if (method === 'POST') assert.equal(response.headers.allow, 'GET, HEAD');
  }
  for (const cleanup of cleanups.reverse()) cleanup?.();
});

test('host schema preserves missing versus explicit null configuration semantics', () => {
  for (const input of [undefined, null, {}, [], { theme: null }]) {
    assert.deepEqual(normalizeRenderConfig(Config(input).get()), normalizeRenderConfig(input));
  }
});
