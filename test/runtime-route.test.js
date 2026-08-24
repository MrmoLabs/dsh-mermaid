import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_PATH, apply, inject } from '../src/index.js';

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
        route = value;
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
  assert.match(getResponse.headers['cache-control'], /immutable/);
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
