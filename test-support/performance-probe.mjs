// Compare the shipped runtime with an esbuild split build using local Chromium.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { apply } from '../lib/index.js';

const [playwrightModule, executablePath] = process.argv.slice(2);
assert.ok(playwrightModule, 'Pass the installed Playwright module and optional Chromium executable.');
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const split = await build({
  entryPoints: { engine: 'src/mermaid-runtime.js' }, outdir: '.runtime/performance-split',
  write: false, bundle: true, minify: true, splitting: true, platform: 'browser', format: 'esm', target: 'chrome120',
  legalComments: 'external',
});
const splitAssets = new Map(split.outputFiles.filter((file) => file.path.endsWith('.js'))
  .map((file) => [`/split/${basename(file.path)}`, file.contents]));
const single = await readFile('lib/mermaid-runtime.js');
const client = await readFile('lib/client.js');
const routes = new Map();
apply({ effect(callback) { callback(); }, webServer: { register(route) { routes.set(route.path, route); } } }, {});
const blocks = Array.from({ length: 40 }, (_, n) => `<pre><code class="language-mermaid">flowchart LR\n A[Item ${n}]--&gt;B</code></pre>`).join('<div style="height:420px"></div>');
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const assets = splitAssets.get(pathname) || (pathname === '/engine.js' && single) || (pathname === '/client.js' && client);
  if (assets) {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(assets);
  } else if (pathname === '/conversation') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="en"><body>
      ${blocks}<script>window.__ModuleLoader__={load({factory}){factory(()=>{}).apply({effect(fn){fn()}})}};</script>
      <script src="/client.js"></script></body></html>`);
  } else if (routes.has(pathname)) {
    void routes.get(pathname).handler(req, res);
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
  const variants = { single: '/engine.js', split: '/split/engine.js' };
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
  await page.route('**/dsh-mermaid/mermaid-runtime.js?*', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `import { renderMermaid as render } from '/engine.js';
      export { default, isMermaidSourceError, createInlinePreview, createFullscreenViewer, preserveViewPosition, createTooltipPositioner } from '/engine.js';
      export function renderMermaid(id, source, signal) {
        window.renders = (window.renders || 0) + 1;
        if (source.includes('[Item 23]')) window.probeRenders = (window.probeRenders || 0) + 1;
        return render(id, source, signal);
      }`,
  }));
  await page.goto(`${origin}/conversation`);
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
  report.conversation = { total: 40, initiallyRendered: initial, reRendersFor20ViewChanges, averageSwitchMs: round(averageSwitchMs) };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
