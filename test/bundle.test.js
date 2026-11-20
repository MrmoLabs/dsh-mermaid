import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

test('browser bundle registers dsh-mermaid and its real runtime respects the documented DOM boundary', async (t) => {
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const bundle = await readFile('lib/client.js', 'utf8');
  const runtime = await readFile('lib/mermaid-runtime.js');
  const katexVersion = JSON.parse(await readFile('node_modules/katex/package.json', 'utf8')).version;
  const chunkNames = (await readdir('lib/mermaid-chunks')).filter((name) => name.endsWith('.js'));
  const chunks = await Promise.all(chunkNames.map((name) => readFile(`lib/mermaid-chunks/${name}`)));
  assert.ok(chunks.some((chunk) => chunk.includes(`"${katexVersion}"`)), 'the browser runtime must embed the pinned KaTeX');
  const runtimeRevision = createHash('sha256').update(runtime).digest('hex').slice(0, 12);
  assert.ok(bundle.length < 50_000, `client bootstrap unexpectedly grew to ${bundle.length} bytes`);
  assert.ok(runtime.length < 100_000 && chunks.some((chunk) => chunk.length > 100_000), 'the browser entry and heavy diagram modules must be split');
  assert.match(bundle, /\/dsh-mermaid\/runtime/);
  assert.ok(bundle.includes(runtimeRevision), 'client bootstrap has a stale runtime revision');
  const cardCss = await readFile('lib/card.css');
  const styleRevision = createHash('sha256').update(cardCss).digest('hex').slice(0, 12);
  assert.ok(bundle.includes(`/dsh-mermaid/card.css?rev=${styleRevision}`));
  const settings = await readFile('lib/settings-runtime.js');
  const settingsRevision = createHash('sha256').update(settings).digest('hex').slice(0, 12);
  assert.ok(bundle.includes(settingsRevision), 'native settings asset must be content-versioned independently');
  assert.ok(settings.length < 40_000, 'native editor must use host React/controls instead of bundling them');
  const hostBundle = await readFile('lib/index.js', 'utf8');
  assert.doesNotMatch(hostBundle, /from ['"]\.\.?\//);
  assert.ok(hostBundle.length < 100_000, 'host must contain only configuration schema and routes, not the Mermaid browser runtime');
  const host = await import(new URL('../lib/index.js', import.meta.url).href);
  const routes = new Map();
  const cleanups = [];
  host.apply({ effect(callback) { cleanups.push(callback()); }, webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } }, { theme: 'neutral' });
  let config;
  routes.get(host.CONFIG_PATH).handler({ method: 'GET' }, { writeHead() {}, end(body) { config = JSON.parse(body); } });
  assert.equal(config.style.theme, 'neutral');
  let runtimeStatus;
  const runtimeRoute = routes.get(host.RUNTIME_PREFIX);
  assert.equal(runtimeRoute.kind, 'prefix');
  const runtimeRequest = async (method, url) => {
    const result = {};
    await runtimeRoute.handler({ method, url }, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body; } });
    return result;
  };
  ({ status: runtimeStatus } = await runtimeRequest('HEAD', host.runtimeUrl()));
  assert.equal(runtimeStatus, 200, 'built host must resolve its runtime alongside itself');
  const chunk = new URL(`mermaid-chunks/${chunkNames[0]}`, `http://localhost${host.runtimeUrl(1)}`).pathname;
  const chunkResponse = await runtimeRequest('GET', chunk);
  assert.equal(chunkResponse.status, 200);
  assert.deepEqual(chunkResponse.body, chunks[0]);
  assert.match(chunkResponse.headers['cache-control'], /immutable/);
  assert.equal((await runtimeRequest('POST', chunk)).status, 405);
  assert.equal((await runtimeRequest('GET', `${chunk}/../../index.js`)).status, 404);
  let styleType;
  let styleBody;
  await routes.get(host.STYLE_PATH).handler({ method: 'GET' }, {
    writeHead(status, headers) { assert.equal(status, 200); styleType = headers['content-type']; },
    end(body) { styleBody = body; },
  });
  assert.equal(styleType, 'text/css; charset=utf-8');
  assert.deepEqual(styleBody, cardCss);
  for (const cleanup of cleanups.reverse()) cleanup?.();

  let registration;
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value;
        },
      },
    },
  };

  vm.runInNewContext(bundle, context, { filename: 'lib/client.js' });
  assert.equal(registration?.id, 'dsh-mermaid');
  assert.equal(typeof registration?.factory, 'function');

  // Build once, then import this exact artifact in fresh processes so DOMPurify's
  // initialization and the ESM cache cannot leak between environment scenarios.
  for (const scenario of ['with-dom', 'without-dom', 'dom-after-import']) {
    await t.test(`real Mermaid runtime: ${scenario}`, () => {
      const probe = spawnSync(process.execPath, [
        fileURLToPath(new URL('../test-support/runtime-probe.mjs', import.meta.url)),
        scenario,
        new URL('../lib/mermaid-runtime.js', import.meta.url).href,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(probe.error, undefined, probe.error?.message);
      assert.equal(probe.status, 0, probe.stderr || probe.stdout);
    });
  }
});
