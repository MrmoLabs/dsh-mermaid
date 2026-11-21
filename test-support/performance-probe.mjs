// Compare the shipped split runtime with a single-file baseline using local Chromium.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { apply, RUNTIME_PREFIX, runtimeUrl } from '../lib/index.js';

const [playwrightModule, executablePath, baseline] = process.argv.slice(2);
assert.ok(playwrightModule, 'Pass the installed Playwright module and optional Chromium executable.');
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const single = baseline ? await readFile(baseline) : (await build({
  entryPoints: ['src/mermaid-runtime.js'], write: false, bundle: true, minify: true, platform: 'browser', format: 'esm',
  target: 'chrome120', alias: { katex: fileURLToPath(import.meta.resolve('katex')) },
})).outputFiles[0].contents;
const client = await readFile('lib/client.js');
const routes = new Map();
apply({ effect(callback) { callback(); }, webServer: { register(route) { routes.set(route.path, route); } } }, {});
const blocks = Array.from({ length: 40 }, (_, n) => `<pre><code class="language-mermaid">flowchart LR\n A[Item ${n}]--&gt;B</code></pre>`).join('<div style="height:420px"></div>');
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = routes.get(pathname) || (pathname.startsWith(`${RUNTIME_PREFIX}/`) && routes.get(RUNTIME_PREFIX));
  const assets = (pathname === '/engine.js' && single) || (pathname === '/client.js' && client);
  if (assets) {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(assets);
  } else if (pathname === '/conversation') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="en"><body>
      ${blocks}<script>window.__ModuleLoader__={load({factory}){factory(()=>{}).apply({effect(fn){fn()}})}};</script>
      <script src="/client.js"></script></body></html>`);
  } else if (route) {
    void route.handler(req, res);
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html><body></body></html>');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const round = (n) => Math.round(n * 10) / 10;
const median = (results, key) => results.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const report = {};
  const variants = { single: '/engine.js', split: runtimeUrl() };
  for (const [variant, modulePath] of Object.entries(variants)) {
    const measurements = [];
    for (let run = 0; run < 5; run += 1) {
      const page = await browser.newPage();
      await page.goto(origin);
      measurements.push(await page.evaluate(async (url) => {
        const start = performance.now();
        const runtime = await import(url);
        const loaded = performance.now();
        const render = (id, source) => {
          runtime.default.initialize({ theme: 'default', securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true });
          return runtime.renderMermaid(id, source);
        };
        const first = await render('first', 'flowchart LR\nA-->B');
        if (!first.svg.includes('node')) throw new Error('Flowchart failed');
        const samples = () => performance.getEntriesByType('resource').filter((entry) => /\.js$/.test(entry.name));
        const loadedFirst = samples();
        const firstDone = performance.now();
        for (const [index, source] of [
          'sequenceDiagram\nAlice->>Bob: Hello', 'classDiagram\nAnimal <|-- Dog', 'stateDiagram-v2\nA-->B',
          'gantt\ndateFormat YYYY-MM-DD\nTask :a, 2026-11-16, 2d', 'pie\n "A": 1', 'journey\n section Plan\n Step: 5: Alice',
          'xychart-beta\n x-axis [a,b]\n bar [1,2]', ...Array.from({ length: 8 }, (_, n) => `flowchart LR\nA[Item ${n}]-->B`),
        ].entries()) {
          await render(`small-${index}`, source);
        }
        const galleryDone = performance.now();
        const wide = Array.from({ length: 150 }, (_, n) => `N${n}[Node ${n}] --> N${n + 1}`).join('\n');
        await render('large', `flowchart LR\n${wide}`);
        return {
          loadMs: loaded - start, coldFirstMs: firstDone - start, galleryMs: galleryDone - firstDone,
          largeMs: performance.now() - galleryDone, firstRequests: loadedFirst.length,
          firstBytes: loadedFirst.reduce((sum, entry) => sum + entry.decodedBodySize, 0), galleryRequests: samples().length,
        };
      }, modulePath));
      await page.close();
    }
    report[variant] = Object.fromEntries(Object.keys(measurements[0]).map((key) => [key, round(median(measurements, key))]));
  }
  const page = await browser.newPage({ viewport: { width: 1050, height: 760 } });
  await page.route(`**${runtimeUrl()}`, (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `import { renderMermaid as render } from '${runtimeUrl(999)}';
      export { default } from '${runtimeUrl(999)}';
      export * from '${runtimeUrl(999)}';
      export function renderMermaid(id, source, signal, streaming) {
        window.renders = (window.renders || 0) + 1;
        if (source.includes('[Item 23]')) window.probeRenders = (window.probeRenders || 0) + 1;
        return render(id, source, signal, streaming);
      }`,
  }));
  await page.goto(`${origin}/conversation`);
  const heapSession = await page.context().newCDPSession(page);
  const initialHeap = (await heapSession.send('Runtime.getHeapUsage')).usedSize;
  const cards = page.locator('.dsh-mmd');
  await cards.first().locator('svg').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.dsh-mmd[data-state="pending"]').length >= 32);
  const initial = await page.evaluate(() => window.renders);
  const card = cards.nth(23);
  await card.scrollIntoViewIfNeeded();
  await card.locator('svg').waitFor();
  const before = await page.evaluate(() => window.probeRenders);
  const averageSwitchMs = await card.evaluate((node) => {
    const code = node.querySelector('.dsh-mmd-view-control:nth-child(2)');
    const diagram = node.querySelector('.dsh-mmd-view-control');
    const start = performance.now();
    for (let index = 0; index < 10; index += 1) { code.click(); diagram.click(); }
    return (performance.now() - start) / 20;
  });
  await page.waitForTimeout(650);
  const reRendersFor20ViewChanges = (await page.evaluate(() => window.probeRenders)) - before;
  assert.equal(reRendersFor20ViewChanges, 0);
  assert.ok(initial <= 8);
  const remountStarted = Date.now();
  const previous = await card.locator('svg').elementHandle();
  await card.evaluate((node) => {
    const source = node.nextElementSibling;
    source.replaceWith(source.cloneNode(true));
  });
  await page.waitForFunction((svg) => !svg.isConnected, previous);
  await previous.dispose();
  await page.locator('.dsh-mmd svg', { hasText: 'Item 23' }).waitFor();
  const sameBlockRemountMs = Date.now() - remountStarted;
  assert.equal(await page.evaluate(() => window.probeRenders), before + 1);
  await heapSession.send('HeapProfiler.collectGarbage');
  const afterHeap = (await heapSession.send('Runtime.getHeapUsage')).usedSize;
  report.conversation = {
    total: 40, initiallyRendered: initial, reRendersFor20ViewChanges, sameBlockRemountMs,
    averageSwitchMs: round(averageSwitchMs), initialHeapBytes: initialHeap, retainedHeapBytes: afterHeap,
  };
  await page.close();

  const budgetPage = await browser.newPage();
  await budgetPage.goto(origin);
  const layoutWarnings = [];
  budgetPage.on('console', (message) => {
    if (/layout algorithm.*(?:not registered|fallback)/i.test(message.text())) layoutWarnings.push(message.text());
  });
  report.budget = await budgetPage.evaluate(async (url) => {
    const runtime = await import(url);
    runtime.default.initialize({ securityLevel: 'strict', suppressErrorRendering: true, maxEdges: 2000, logLevel: 'warn' });
    const measurements = [];
    const watcher = new PerformanceObserver((list) => measurements.push(...list.getEntries().map((entry) => entry.duration)));
    watcher.observe({ type: 'longtask' });
    const samples = {
      branchingFlowchart: 'flowchart LR\n' + Array.from({ length: 150 }, (_, index) => 'N' + index + '-->N' + (index + 1) + ' & N' + (index + 2)).join('\n'),
      treemap: 'treemap-beta\n"Section"\n' + Array.from({ length: 100 }, (_, index) => '    "Item ' + index + '": ' + (index + 1)).join('\n'),
      gantt: 'gantt\ndateFormat YYYY-MM-DD\nsection Plan\n' + Array.from({ length: 80 }, (_, index) => 'Task ' + index + ' :task' + index + ', 2026-11-01, 4d').join('\n'),
      externalLayoutRequest: '---\nconfig:\n  layout: elk\n---\nflowchart LR\nA-->B',
    };
    const durations = {};
    for (const [name, source] of Object.entries(samples)) {
      const started = performance.now();
      const output = await runtime.renderMermaid(name, source);
      if (!output.svg.includes('<svg')) throw new Error('Empty result for ' + name);
      durations[name] = Math.round(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    watcher.disconnect();
    return { durationsMs: durations, longestTaskMs: Math.max(0, ...measurements) };
  }, runtimeUrl());
  report.budget.externalLayoutFallsBack = layoutWarnings.some((warning) => /elk.*dagre/i.test(warning));
  await budgetPage.close();

  const slowPage = await browser.newPage();
  const slowSession = await slowPage.context().newCDPSession(slowPage);
  await slowSession.send('Network.enable');
  await slowSession.send('Network.emulateNetworkConditions', {
    offline: false, latency: 75, downloadThroughput: 256 * 1024, uploadThroughput: 128 * 1024,
  });
  await slowPage.goto(origin);
  report.slowConnection = await slowPage.evaluate(async (url) => {
    const started = performance.now();
    const runtime = await import(url);
    runtime.default.initialize({ securityLevel: 'strict', suppressErrorRendering: true });
    const source = 'flowchart LR\nA-->B';
    await runtime.renderMermaid('cold', source);
    const cold = performance.now();
    const entries = performance.getEntriesByType('resource').filter((entry) => entry.name.endsWith('.js'));
    await runtime.renderMermaid('warm', source);
    return {
      coldMs: Math.round(cold - started), warmMs: Math.round(performance.now() - cold),
      requests: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    };
  }, runtimeUrl());
  await slowPage.close();
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
