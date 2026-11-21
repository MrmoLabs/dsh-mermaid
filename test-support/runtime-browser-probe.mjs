// Build first, then run with Playwright's Chromium or a supplied executable.
// npm run check:browser -- [--smoke] [playwright-module] [browser-executable]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply, RUNTIME_PREFIX, runtimeUrl } from '../lib/index.js';
import { normalizeRenderConfig } from '../src/render-config.js';

const args = process.argv.slice(2);
const smokeCases = args[0] === '--smoke' ? new Set([
  'issue1InvalidSource', 'issues4And7Titlebar', 'issue6TooltipOverflow', 'issues8And10ExportAndDraft',
  'issue9Original', 'issue12Original', 'codeRetryExport', 'palette-base-typography', 'palette-base-node-fill',
  'diamondAndZenUml', 'touchCanvas', 'runtimeChunkRetry',
  'disposingStalledCardReleasesQueue', 'legacyReplacementReleasesStalledDraw', 'renderingUsesOriginalPositionsAndTypes', 'recoversComplexLabelsWithoutChangingSource',
  'offCenterZoomKeepsSvgCoordinate', 'draftSurvivesRemountAndSettingsApply', 'fullscreenRetainsZoomAndBoundsAtResize',
  'keyboardExportAndOptionalDiagnosticSource', 'zenUmlDarkPaletteAndExport',
]) : null;
const [playwrightModule, executablePath] = smokeCases ? args.slice(1) : args;
const { chromium } = await import(playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : 'playwright-core');
const routes = new Map();
const cleanups = [];
apply({
  effect(callback) { cleanups.push(callback()); },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
}, {});

const basic = 'flowchart LR\nA-->B';
const unfinished = 'flowchart LR\nA-->';
const mixed = 'flowchart LR\nA[选中"节点"]-->B[Select(node)]';
const complexLabels = [
  'flowchart LR',
  'A[Wait (5s); then retry] -->|f(g(x))| B{Target "ready" (x(y))?}',
  'B --> C{{Check(input)?}} --> D(Review (confirm(x)))',
].join('\n');
const issueFixture = async (number) => (await readFile(new URL(`./fixtures/issue-${number}.mmd`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const [issue8, issue9, issue12] = await Promise.all([8, 9, 12].map(issueFixture));
const issue1 = 'this is not a diagram';
const wide = `flowchart LR\n${Array.from({ length: 18 }, (_, n) => `N${n}[Node ${n + 1}]`).join(' --> ')}`;
const journey = 'journey\n title A long project title\n section Plan\n First step: 5: Alex\n Second step: 3: Alex';
const codeBlock = (source) => `<pre><code class="language-mermaid">${source.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</code></pre>`;
const fixtures = {
  '/retry': codeBlock(basic),
  '/draft-navigation': '<section data-conversation-session="session-one"><div data-chat-flow-key="message-1">'
    + ('<div data-slot="conversation.chat.markdown.fence">' + codeBlock(basic) + '</div>').repeat(2) + '</div></section>',
  '/dark-zenuml': codeBlock('zenuml\nAlice->Bob: Message'),
  '/edge-budget': codeBlock('flowchart LR\n' + Array.from({ length: 2002 }, (_, i) => 'N' + i).join('-->')),
  '/issue-1': codeBlock(issue1),
  '/issue-6': '<style>html,body{height:100%;margin:0}article{height:100%;overflow:auto}</style>' + codeBlock(basic),
  '/issue-8': codeBlock(issue8),
  '/issue-9': codeBlock(issue9),
  '/issue-12': codeBlock(issue12),
  '/code-retry-export': codeBlock(journey.replace('A long project title', 'A very long title '.repeat(10).trimEnd())),
  '/stream': codeBlock(unfinished),
  '/canvas': codeBlock(mixed) + codeBlock(basic),
  '/complex-labels': codeBlock(complexLabels),
  '/anchored-zoom': '<div style="width:667px">' + codeBlock('flowchart LR\nA[One] --> B[Two] --> C[Three] --> D[Four]') + '</div>',
  '/render-diagnostics': [
    '---\ntitle: Example\nconfig:\n  theme: neutral\n---\nflowchart LR\nA --> B\nC[Broken (f(x)] --> D',
    '%%{init: {"theme":"neutral"}}%%\nflowchart LR\n%% Comment\nA --> B\nC[Broken (f(x)] --> D',
    'flowchart LR\nA[failed to fetch (bad(x)] --> B',
  ].map(codeBlock).join(''),
  '/treemap-contents': ['treemap-beta', 'treemap-beta\n"Category"\n    "Item": 0', 'treemap-beta\n"Category"\n    "Item": 15'].map(codeBlock).join(''),
  '/untagged-diagrams': '<pre><code>treemap-beta\n"Category"\n    "Item": 15</code></pre>'
    + '<pre><code>info</code></pre>'
    + '<pre><code class="language-text">treemap-beta\n"Category"\n    "Item": 15</code></pre>',
  '/queue': codeBlock('flowchart LR\nA[STALL]-->B') + codeBlock(basic),
  '/offscreen': Array.from({ length: 15 }, (_, index) => codeBlock(`flowchart LR\nA[Node ${index}]-->B`) + '<div style="height:450px"></div>').join(''),
  '/geometry': `<div style="width:480px">${[wide, journey, '---\ntitle: Only a title\n---\nflowchart LR', 'xychart-beta\n x-axis [a,b,c]\n y-axis 0 --> 10\n bar [1,3,5]'].map(codeBlock).join('')}${codeBlock('flowchart LR\nInvisible --> B')}<div hidden>${codeBlock('flowchart LR\nWasHidden --> B')}</div></div>`,
  '/palette': codeBlock('sequenceDiagram\n Alice->>Bob: Message') + codeBlock(basic),
  '/palette-node-text-override': codeBlock('---\nconfig:\n  theme: base\n  themeVariables:\n    primaryTextColor: "#0055aa"\n---\n' + basic) + codeBlock(basic),
  '/math': codeBlock('flowchart LR\nA["$$x^2+1$$"]-->B'),
  '/expanded-compat': codeBlock('flowchart LR\nA{Check(input)?} --> B') + '<div style="height:1600px"></div>'
    + codeBlock('zenuml\nAlice->Bob: Hello'),
};
const client = await readFile('lib/client.js');
const referenceRuntime = `export * from '${runtimeUrl(999)}';export {default} from '${runtimeUrl(999)}';`;
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const route = routes.get(pathname) || (pathname.startsWith(`${RUNTIME_PREFIX}/`) && routes.get(RUNTIME_PREFIX));
  if (route) return void route.handler(request, response);
  if (pathname === '/client.js' || pathname === '/engine.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(pathname === '/client.js' ? client : referenceRuntime);
    return;
  }
  if (Object.hasOwn(fixtures, pathname)) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
      <style>article{max-width:790px;margin:auto}</style><article>${fixtures[pathname]}</article>
      <script>window.__ModuleLoader__={load({factory}){factory(()=>{}).apply({effect(fn){fn()}})}};</script>
      <script src="/client.js"></script>`);
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const moduleRoutes = /\/dsh-mermaid\/runtime\/[^/]+\/\d{1,2}\/mermaid-runtime\.js$/;
const readyCard = '.dsh-mmd[data-state="ok"]';
const report = {};
let browser;

async function run(name, test) {
  if (smokeCases && !smokeCases.has(name)) return;
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, acceptDownloads: true });
  try { report[name] = await test(page); }
  catch (error) { throw new Error(`Browser check failed for ${name}`, { cause: error }); }
  finally { await page.close(); }
}

async function download(page, card, label) {
  await card.getByRole('button', { name: /^导出/ }).click();
  const pending = page.waitForEvent('download');
  await card.getByRole('button', { name: label, exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

function contrastRatio(first, second) {
  const luminance = (value) => {
    const [r, g, b] = value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map((channel) => Number(channel) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const levels = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (levels[1] + 0.05) / (levels[0] + 0.05);
}

try {
  browser = await chromium.launch({ headless: true, executablePath });
  await run('issue1InvalidSource', async (page) => {
    await page.goto(`${origin}/issue-1`);
    const card = page.locator('.dsh-mmd[data-state="error"]');
    await card.waitFor();
    assert.equal(await page.locator('svg').count(), 0);
    await card.getByRole('button', { name: '代码', exact: true }).click();
    assert.equal(await card.locator('.dsh-mmd-code').textContent(), issue1);
    return true;
  });

  await run('issues4And7Titlebar', async (page) => {
    await page.goto(`${origin}/retry`);
    const card = page.locator(readyCard);
    await card.waitFor();
    await page.evaluate(() => {
      document.documentElement.dataset.windowsTitlebar = '';
      document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px');
    });
    await card.getByRole('button', { name: '全屏', exact: true }).click();
    const viewer = page.locator('.dsh-mmd-viewer');
    const controls = await viewer.locator('.dsh-mmd-viewer-bar button').all();
    assert.equal(controls.length, 5);
    for (const control of controls) {
      assert.ok((await control.boundingBox()).y >= 40);
      await control.click();
    }
    await viewer.waitFor({ state: 'hidden' });
    return { minimumTitlebarClearance: 40, controlsClicked: controls.length };
  });

  await run('issue6TooltipOverflow', async (page) => {
    await page.goto(`${origin}/issue-6`);
    await page.locator(readyCard).waitFor();
    const tooltip = page.locator('body > .mermaidTooltip');
    await tooltip.waitFor({ state: 'attached' });
    const measure = () => tooltip.evaluate((node) => ({
      position: getComputedStyle(node).position,
      overflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    assert.deepEqual(await measure(), { position: 'fixed', overflow: 0 });
    await page.locator('article').evaluate((article) => article.replaceChildren('Next conversation'));
    await page.locator('.dsh-mmd').waitFor({ state: 'detached' });
    assert.deepEqual(await measure(), { position: 'fixed', overflow: 0 });
    return { rootOverflow: 0, tooltipRetained: true };
  });

  await run('issues8And10ExportAndDraft', async (page) => {
    await page.goto(`${origin}/issue-8`);
    const card = page.locator('.dsh-mmd');
    const svg = card.locator('.dsh-mmd-pane svg');
    await page.locator(readyCard).waitFor();
    const baseline = await svg.textContent();
    const file = await download(page, card, '下载 SVG');
    assert.equal(await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
      return !doc.querySelector('parsererror') &&
        doc.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'br').length === 1;
    }, file.bytes.toString('utf8')), true);
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = card.locator('textarea');
    const draft = `${issue8}\nC -->`;
    await editor.fill(draft);
    await page.locator('.dsh-mmd[data-state="error"]').waitFor();
    assert.equal(await svg.textContent(), baseline);
    assert.equal(await card.getByRole('button', { name: '全屏', exact: true }).isEnabled(), false);
    await card.getByRole('button', { name: /^导出/ }).click();
    for (const name of ['下载 SVG', '下载 PNG', '下载 PNG（主题背景）']) {
      assert.equal(await card.getByRole('button', { name, exact: true }).isEnabled(), false);
    }
    await page.keyboard.press('Escape');
    const exported = await download(page, card, '下载 .mmd');
    assert.equal(exported.bytes.toString('utf8'), draft);
    assert.equal(await page.locator('article > pre code').textContent(), issue8);
    await card.getByRole('button', { name: '恢复原文', exact: true }).click();
    await page.locator(readyCard).waitFor();
    assert.equal(await editor.inputValue(), issue8);
    return { validXhtmlSvg: true, stalePreviewRetained: true, rawDraftExport: true, reset: true };
  });

  await run('issue9Original', async (page) => {
    await page.goto(`${origin}/issue-9`);
    const card = page.locator(readyCard);
    const svg = card.locator('.dsh-mmd-pane svg');
    await svg.waitFor();
    assert.equal(await svg.locator('g.node').count(), 9);
    const labels = await svg.textContent();
    assert.match(labels, /UsbPresence\(true\/false\)/);
    assert.match(labels, /SetFlag\(false\)/);
    const exported = await download(page, card, '下载 .mmd');
    assert.equal(exported.bytes.toString('utf8'), issue9);
    return { nodes: 9, sourceExportUnchanged: true };
  });

  await run('issue12Original', async (page) => {
    await page.goto(`${origin}/issue-12`);
    const card = page.locator('.dsh-mmd');
    await page.waitForFunction(() => ['ok', 'error'].includes(document.querySelector('.dsh-mmd')?.dataset.state));
    assert.equal(await card.getAttribute('data-state'), 'ok', await card.locator('.dsh-mmd-error').textContent());
    const svg = card.locator('.dsh-mmd-pane svg');
    assert.equal(await svg.locator('g.node').count(), 6);
    assert.match(await svg.textContent(), /"关联在\+拒连\/超时"/);
    assert.ok(await svg.locator('br').count() > 0, 'label line breaks must remain visible');
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const original = await card.locator('textarea').inputValue();
    assert.equal(original, issue12);
    const exported = await download(page, card, '下载 .mmd');
    assert.equal(exported.bytes.toString('utf8'), issue12);
    return { nodes: 6, quotesAndBreaksPreserved: true, sourceExportUnchanged: true };
  });

  for (const [scenario, fail, message] of [
    ['runtimeModuleRetry', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("module evaluation failed");' }), /模块无法启动/],
    ['runtimeDownloadRetry', (route) => route.abort('failed'), /无法下载 Mermaid 渲染器文件/],
  ]) {
    await run(scenario, async (page) => {
      const urls = [];
      await page.route(moduleRoutes, (route) => {
        urls.push(route.request().url());
        return urls.length === 1 ? fail(route) : route.continue();
      });
      await page.goto(`${origin}/retry`);
      const card = page.locator('.dsh-mmd[data-state="error"]');
      await card.waitFor();
      assert.match(await card.textContent(), message);
      await page.getByRole('button', { name: '重试渲染' }).click();
      await page.locator(readyCard).waitFor();
      assert.equal(urls.length, 2);
      assert.match(urls[1], /\/1\/mermaid-runtime\.js$/);
      return true;
    });
  }

  await run('codeRetryExport', async (page) => {
    let attempts = 0;
    await page.route(moduleRoutes, (route) => ++attempts === 1 ? route.abort() : route.continue());
    await page.goto(`${origin}/code-retry-export`);
    const card = page.locator('.dsh-mmd');
    await card.locator('.dsh-mmd-error').waitFor();
    await card.getByRole('button', { name: '代码', exact: true }).click();
    await card.getByRole('button', { name: '重试渲染' }).click();
    await page.locator(readyCard).waitFor();
    assert.equal(await card.getAttribute('data-view'), 'code');
    const exported = await download(page, card, '下载 SVG');
    const viewBox = await page.evaluate((xml) => new DOMParser().parseFromString(xml, 'image/svg+xml')
      .documentElement.getAttribute('viewBox'), exported.bytes.toString('utf8'));
    const [, , width] = viewBox.split(/\s+/).map(Number);
    assert.ok(width > 2000, `the export clipped the title to ${width} units`);
    const png = await download(page, card, '下载 PNG');
    assert.ok(png.bytes.readUInt32BE(16) > 2000);
    await card.getByRole('button', { name: '图形', exact: true }).click();
    assert.equal(await card.locator('svg').getAttribute('viewBox'), viewBox);
    return { width, pngWidth: png.bytes.readUInt32BE(16) };
  });

  await run('mathWithPatchedKaTeX', async (page) => {
    await page.goto(`${origin}/math`);
    const card = page.locator(readyCard);
    const exponent = card.locator('svg .katex msup');
    await exponent.waitFor({ state: 'attached' });
    assert.equal(await exponent.textContent(), 'x2');
    assert.match(await card.locator('svg .katex').textContent(), /x2\+1/);
    return true;
  });

  await run('diamondAndZenUml', async (page) => {
    const chunkRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/mermaid-chunks/')) chunkRequests.push(request.url());
    });
    await page.goto(`${origin}/expanded-compat`);
    const [diamond, zen] = [0, 1].map((index) => page.locator('.dsh-mmd').nth(index));
    await diamond.locator('svg .node polygon').waitFor();
    assert.match(await diamond.locator('svg').textContent(), /Check\(input\)\?/);
    const original = await download(page, diamond, '下载 .mmd');
    assert.equal(original.bytes.toString('utf8'), 'flowchart LR\nA{Check(input)?} --> B');
    assert.ok(!chunkRequests.some((url) => url.includes('/zenuml-definition-')));
    const firstDiagramChunks = chunkRequests.length;
    await zen.scrollIntoViewIfNeeded();
    const zenSvg = zen.locator('.dsh-mmd-pane > svg');
    await zenSvg.waitFor();
    assert.match(await zenSvg.textContent(), /Hello/);
    assert.ok(chunkRequests.some((url) => url.includes('/zenuml-definition-')));
    const png = await download(page, zen, '下载 PNG');
    assert.ok(png.bytes.readUInt32BE(16) > 0);
    return { firstDiagramChunks, zenUmlLoadedOnDemand: true };
  });

  await run('runtimeChunkRetry', async (page) => {
    const urls = [];
    await page.route(/\/mermaid-chunks\/flowDiagram-[^/]+\.js$/, (route) => {
      urls.push(route.request().url());
      return urls.length === 1 ? route.abort() : route.continue();
    });
    await page.goto(`${origin}/retry`);
    const card = page.locator('.dsh-mmd[data-state="error"]');
    await card.waitFor();
    assert.match(await card.textContent(), /无法下载 Mermaid 渲染器文件/);
    await card.getByRole('button', { name: '重试渲染' }).click();
    await page.locator(readyCard).waitFor();
    assert.equal(urls.length, 2);
    assert.match(urls[0], /\/0\/mermaid-chunks\//);
    assert.match(urls[1], /\/1\/mermaid-chunks\//);
    return true;
  });

  await run('touchCanvas', async (page) => {
    await page.goto(`${origin}/geometry`);
    const card = page.locator(readyCard).first();
    await card.waitFor();
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
    const center = async (locator) => {
      const bounds = await locator.boundingBox();
      return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
    };
    async function pinch(locator) {
      const { x, y } = await center(locator);
      const pair = (offset) => [{ x: x - offset, y, id: 0 }, { x: x + offset, y, id: 1 }];
      await touch('touchStart', ...pair(20));
      await touch('touchMove', ...pair(60));
      await touch('touchEnd');
    }
    const pane = card.locator('.dsh-mmd-pane');
    const inlineScale = () => pane.evaluate((node) => Number(node.style.getPropertyValue('--dsh-mmd-inline-scale')));
    const height = (await card.boundingBox()).height;
    await pinch(pane);
    assert.equal(await inlineScale(), 3);
    assert.equal((await card.boundingBox()).height, height);
    const point = await center(pane);
    for (let tap = 0; tap < 2; tap += 1) {
      await touch('touchStart', { ...point, id: 0 });
      await touch('touchEnd');
    }
    assert.equal(await inlineScale(), 1);
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    await pane.scrollIntoViewIfNeeded();
    const editorHeight = (await card.boundingBox()).height;
    await pinch(pane);
    assert.equal(await inlineScale(), 3);
    assert.equal((await card.boundingBox()).height, editorHeight);
    await card.getByRole('button', { name: '全屏', exact: true }).click();
    const viewport = page.locator('.dsh-mmd-viewer-viewport');
    const fullscreenScale = () => viewport.evaluate((node) => {
      const transform = getComputedStyle(node.querySelector('.dsh-mmd-viewer-stage')).transform;
      return new DOMMatrix(transform).a;
    });
    const before = await fullscreenScale();
    await pinch(viewport);
    assert.ok(await fullscreenScale() > before);
    return { fixedCardHeight: height, doubleTapReset: true, editorPinch: true, fullscreenPinch: true };
  });

  await run('runtimeRequestTimeout', async (page) => {
    await page.addInitScript(() => {
      const schedule = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 12_000 ? 300 : delay, ...args);
    });
    let pending;
    const requests = [];
    await page.route(moduleRoutes, (route) => {
      requests.push(route.request().url());
      if (requests.length === 1) {
        pending = route;
        return;
      }
      return route.continue();
    });
    await page.goto(`${origin}/retry`);
    const error = page.locator('.dsh-mmd[data-state="error"] .dsh-mmd-error');
    await error.waitFor();
    assert.match(await error.textContent(), /加载超时/);
    await page.getByRole('button', { name: '重试渲染' }).click();
    await page.locator(readyCard).waitFor();
    assert.match(requests[1], /\/1\/mermaid-runtime\.js$/);
    await pending.abort();
    assert.equal(await page.locator(readyCard).count(), 1);
    return true;
  });

  await run('legacyStreamAndErrorDetails', async (page) => {
    await page.goto(`${origin}/stream`);
    const card = page.locator('.dsh-mmd');
    await page.getByText(/源码可能尚未写完/).first().waitFor({ state: 'attached' });
    assert.equal(await card.getAttribute('data-view'), 'diagram');
    assert.equal(await card.getAttribute('data-state'), 'pending');
    await page.locator('pre > code').evaluate((code) => { code.textContent += 'B'; });
    await page.locator(readyCard).waitFor();
    assert.equal(await card.getAttribute('data-view'), 'diagram');
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    await card.locator('textarea').fill(`\n${unfinished}`);
    await page.locator('.dsh-mmd[data-state="error"]').waitFor();
    assert.match(await card.locator('.dsh-mmd-notice').textContent(), /第 3 行/);
    const details = card.locator('.dsh-mmd-error-details');
    assert.equal(await details.getAttribute('open'), null);
    await details.locator('summary').click();
    assert.equal(await details.locator('pre').isVisible(), true);
    assert.match(await details.locator('pre').textContent(), /Parse error/);
    return true;
  });

  await run('legacyIncompleteSettlesAndRecovers', async (page) => {
    await page.goto(origin + '/stream');
    const card = page.locator('.dsh-mmd');
    await page.locator('.dsh-mmd[data-state="error"]').waitFor({ timeout: 7000 });
    assert.match(await card.locator('.dsh-mmd-error').textContent(), /第 2 行/);
    await page.locator('pre > code').evaluate((code) => { code.textContent += 'B'; });
    await card.locator('svg').waitFor();
    assert.equal(await card.getAttribute('data-state'), 'ok');
    return true;
  });

  await run('nearViewportScheduling', async (page) => {
    await page.goto(`${origin}/offscreen`);
    const cards = page.locator('.dsh-mmd');
    await page.locator(readyCard).first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.dsh-mmd[data-state="pending"]').length >= 10);
    const initial = await page.locator(readyCard).count();
    const distant = cards.nth(9);
    assert.equal(await distant.getAttribute('data-state'), 'pending');
    await distant.scrollIntoViewIfNeeded();
    await distant.locator('svg').waitFor();
    assert.ok((await page.locator(readyCard).count()) < 15);
    return { initiallyRendered: initial, total: 15 };
  });

  await run('stalledQueueRecovery', async (page) => {
    await page.addInitScript(() => {
      const schedule = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 15_000 ? 250 : delay, ...args);
    });
    const requests = [];
    await page.route(moduleRoutes, (route) => {
      requests.push(route.request().url());
      if (requests.length > 1) return route.continue();
      return route.fulfill({ contentType: 'text/javascript', body: `
        export { default, isMermaidSourceError } from '/engine.js';
        export function renderMermaid(id, source, signal) {
          signal.addEventListener('abort', () => { window.stalledRenderAborted = true; });
          return new Promise(() => {});
        }` });
    });
    await page.goto(`${origin}/queue`);
    const cards = page.locator('.dsh-mmd');
    await cards.nth(1).locator('svg').waitFor();
    assert.equal(await cards.nth(0).getAttribute('data-state'), 'error');
    assert.match(await cards.nth(0).locator('.dsh-mmd-error').textContent(), /渲染超时/);
    assert.equal(await page.evaluate(() => window.stalledRenderAborted), true);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /\/1\/mermaid-runtime\.js$/);
    await cards.nth(0).getByRole('button', { name: '重试渲染' }).click();
    await cards.nth(0).locator('svg').waitFor();
    return true;
  });

  await run('disposingStalledCardReleasesQueue', async (page) => {
    const requests = [];
    await page.route(moduleRoutes, (route) => {
      requests.push(route.request().url());
      if (requests.length > 1) return route.continue();
      return route.fulfill({ contentType: 'text/javascript', body: `
        export { default } from '/engine.js';
        export async function renderMermaid(id, source, signal) {
          window.stalledCardStarted = true;
          signal.addEventListener('abort', () => { window.stalledCardDisposed = true; });
          return new Promise(() => {});
        }` });
    });
    await page.goto(origin + '/queue');
    await page.waitForFunction(() => window.stalledCardStarted);
    await page.locator('pre > code.language-mermaid').first().evaluate((code) => code.parentElement.remove());
    await page.locator(readyCard).locator('svg').waitFor({ timeout: 4000 });
    assert.equal(await page.evaluate(() => window.stalledCardDisposed), true);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /\/1\/mermaid-runtime\.js$/);
    return true;
  });

  for (const scenario of ['stableEditReplacesStalledDraw', 'legacyReplacementReleasesStalledDraw']) {
    await run(scenario, async (page) => {
      await page.route(moduleRoutes, (route) => /\/0\/mermaid-runtime\.js$/.test(route.request().url())
        ? route.fulfill({ contentType: 'text/javascript', body: `
          export { default, supersedeRender } from '/engine.js';
          export function renderMermaid(id, source, signal) {
            window.stalledEditStarted = true;
            signal.addEventListener('abort', () => { window.stalledEditAborted = true; });
            return new Promise(() => {});
          }` })
        : route.continue());
      await page.goto(origin + '/retry');
      await page.waitForFunction(() => window.stalledEditStarted);
      const card = page.locator('.dsh-mmd');
      const replacement = 'flowchart LR\nA[Replacement]-->B';
      if (scenario === 'stableEditReplacesStalledDraw') {
        await card.getByRole('button', { name: '编辑', exact: true }).click();
        await card.locator('textarea').fill(replacement);
      } else {
        await page.locator('pre > code.language-mermaid').evaluate((code, value) => { code.textContent = value; }, replacement);
      }
      await card.locator('svg').filter({ hasText: 'Replacement' }).waitFor({ timeout: 4000 });
      assert.equal(await page.evaluate(() => window.stalledEditAborted), true);
      return true;
    });
  }

  await run('renderingUsesOriginalPositionsAndTypes', async (page) => {
    await page.goto(origin + '/render-diagnostics');
    const cards = page.locator('.dsh-mmd[data-state="error"]');
    await cards.nth(2).waitFor();
    assert.match(await cards.nth(0).locator('.dsh-mmd-error').textContent(), /第 8 行/);
    assert.match(await cards.nth(1).locator('.dsh-mmd-error').textContent(), /第 5 行/);
    assert.match(await cards.nth(2).locator('.dsh-mmd-error').textContent(), /第 2 行/);
    assert.equal(await cards.nth(2).getByRole('button', { name: '重试渲染' }).count(), 0);
    return true;
  });

  await run('recoversComplexLabelsWithoutChangingSource', async (page) => {
    await page.goto(origin + '/complex-labels');
    const card = page.locator(readyCard);
    const svg = card.locator('svg');
    await svg.waitFor();
    const labels = await svg.textContent();
    for (const label of ['Wait (5s); then retry', 'f(g(x))', 'Target "ready" (x(y))?', 'Check(input)?', 'Review (confirm(x))']) {
      assert.ok(labels.includes(label), label);
    }
    const shapes = await svg.locator('.node').evaluateAll((nodes) => nodes.map((node) => [...node.children].find((child) => child.matches('rect, polygon, path'))?.localName));
    assert.deepEqual(shapes, ['rect', 'polygon', 'polygon', 'rect']);
    assert.equal(await svg.locator('.flowchart-link').count(), 3);
    assert.equal((await download(page, card, '下载 .mmd')).bytes.toString('utf8'), complexLabels);
    return true;
  });

  await run('emptyTreemapAndZeroValue', async (page) => {
    await page.goto(origin + '/treemap-contents');
    const cards = page.locator('.dsh-mmd');
    await cards.nth(1).locator('svg').waitFor();
    assert.equal(await cards.nth(0).getAttribute('data-state'), 'empty');
    assert.equal(await cards.nth(0).locator('svg').count(), 0);
    assert.match(await cards.nth(1).locator('svg').textContent(), /Category/);
    await cards.nth(2).scrollIntoViewIfNeeded();
    await cards.nth(2).locator('svg').waitFor();
    assert.match(await cards.nth(2).locator('svg').textContent(), /Item/);
    return true;
  });

  await run('untaggedDiagramLeavesOrdinaryCodeAlone', async (page) => {
    await page.goto(origin + '/untagged-diagrams');
    const cards = page.locator('.dsh-mmd');
    await cards.locator('svg').waitFor();
    assert.equal(await cards.count(), 1);
    assert.match(await cards.locator('svg').textContent(), /Item/);
    assert.equal(await page.locator('pre > code', { hasText: /^info$/ }).isVisible(), true);
    assert.equal(await page.locator('pre > code.language-text').isVisible(), true);
    return true;
  });

  await run('offCenterZoomKeepsSvgCoordinate', async (page) => {
    await page.goto(origin + '/anchored-zoom');
    const card = page.locator(readyCard);
    const pane = card.locator('.dsh-mmd-pane');
    const svg = pane.locator('svg');
    await svg.waitFor();
    for (const view of ['图形', '编辑']) {
      await card.getByRole('button', { name: view, exact: true }).click();
      const viewport = await pane.boundingBox();
      const before = await svg.boundingBox();
      const anchor = before.x + before.width * 0.28;
      assert.ok(anchor > viewport.x && anchor < viewport.x + viewport.width);
      await page.mouse.dblclick(anchor, before.y + before.height / 2);
      assert.equal(await pane.evaluate((element) => element.style.getPropertyValue('--dsh-mmd-inline-scale')), '2');
      const after = await svg.boundingBox();
      assert.ok(Math.abs(after.x + after.width * 0.28 - anchor) <= 1, view);
      assert.equal((await pane.boundingBox()).height, viewport.height);
      await card.getByRole('button', { name: '适应卡片', exact: true }).click();
    }
    return true;
  });

  await run('transientSettingsReadRecoversInPlace', async (page) => {
    let requests = 0;
    await page.route('**/dsh-mermaid/config.json', (route) => ++requests === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: normalizeRenderConfig({ theme: 'dark' }) }));
    await page.goto(origin + '/retry');
    const card = page.locator('.dsh-mmd');
    await card.locator('.dsh-mmd-config-warning').waitFor();
    await card.locator('svg').waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.dsh-mmd-pane')).backgroundColor === 'rgb(0, 0, 0)');
    assert.equal(await card.locator('.dsh-mmd-config-warning').isVisible(), false);
    assert.equal(requests, 2);
    return true;
  });

  await run('draftSurvivesRemountAndSettingsApply', async (page) => {
    let theme = 'default';
    await page.route('**/dsh-mermaid/config.json', (route) => route.fulfill({ json: normalizeRenderConfig({ theme }) }));
    await page.goto(origin + '/draft-navigation');
    const cards = page.locator('.dsh-mmd');
    const card = cards.first();
    await card.locator('svg').waitFor();
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const draft = 'flowchart LR\nA[Draft survives]-->B';
    await card.locator('textarea').fill(draft);
    await card.locator('svg').filter({ hasText: 'Draft survives' }).waitFor();
    theme = 'dark';
    await page.evaluate(() => window.dispatchEvent(new Event('dsh-mermaid:settings-saved')));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.dsh-mmd-pane')).backgroundColor === 'rgb(0, 0, 0)');
    assert.equal(await card.locator('textarea').inputValue(), draft);
    assert.equal(await card.getAttribute('data-view'), 'edit');
    await page.locator('[data-chat-flow-key]').evaluate((flow) => {
      const replacement = flow.cloneNode(true);
      replacement.querySelectorAll('.dsh-mmd').forEach((card) => card.remove());
      flow.replaceWith(replacement);
    });
    await card.locator('svg').filter({ hasText: 'Draft survives' }).waitFor();
    assert.equal(await cards.nth(1).locator('textarea').inputValue(), basic);

    // Desktop keeps the same address on navigation. The other session uses
    // the same host message key, fence ordinal, and original diagram.
    await page.locator('[data-conversation-session]').evaluate((conversation) => {
      const replacement = conversation.cloneNode(true);
      replacement.dataset.conversationSession = 'session-two';
      replacement.querySelectorAll('.dsh-mmd').forEach((card) => card.remove());
      conversation.replaceWith(replacement);
    });
    await card.locator('svg').waitFor();
    assert.equal(await card.locator('textarea').inputValue(), basic, 'the other session inherited this session’s draft');
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const secondDraft = 'flowchart LR\nA[Second session]-->B';
    await card.locator('textarea').fill(secondDraft);
    await card.locator('svg').filter({ hasText: 'Second session' }).waitFor();

    // The host can also reuse the conversation container and the same fence.
    const originalBlock = await page.locator('article pre > code.language-mermaid').first().elementHandle();
    await page.locator('[data-conversation-session]').evaluate((conversation) => {
      conversation.dataset.conversationSession = 'session-one';
    });
    await card.locator('svg').filter({ hasText: 'Draft survives' }).waitFor({ timeout: 4000 });
    assert.equal(await originalBlock.evaluate((element) => element.isConnected), true);
    assert.equal(await originalBlock.textContent(), basic);
    await card.getByRole('button', { name: '恢复原文', exact: true }).click();
    assert.equal(await card.locator('textarea').inputValue(), basic);
    await page.locator('[data-conversation-session]').evaluate((conversation) => {
      conversation.dataset.conversationSession = 'session-two';
    });
    await card.locator('svg').filter({ hasText: 'Second session' }).waitFor({ timeout: 4000 });
    assert.equal(await card.locator('textarea').inputValue(), secondDraft);
    return true;
  });

  await run('fullscreenRetainsZoomAndBoundsAtResize', async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(origin + '/geometry');
    const card = page.locator(readyCard).first();
    await card.locator('svg').waitFor();
    await card.locator('.dsh-mmd-fullscreen').click();
    const viewer = page.locator('.dsh-mmd-viewer');
    const stage = viewer.locator('.dsh-mmd-viewer-stage');
    const zoom = viewer.getByRole('button', { name: '放大', exact: true });
    for (let i = 0; i < 4; i++) await zoom.click();
    const scale = await stage.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).a);
    await page.setViewportSize({ width: 370, height: 570 });
    assert.equal(await stage.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).a), scale);
    for (let i = 0; i < 50; i++) await zoom.press('ArrowRight');
    const viewport = await viewer.locator('.dsh-mmd-viewer-viewport').boundingBox();
    const svg = await stage.locator('svg').boundingBox();
    assert.ok(svg.x + svg.width >= viewport.x + viewport.width - 1);
    assert.ok(viewport.y + viewport.height <= 570);
    await page.keyboard.press('Escape');
    assert.equal(await card.locator('.dsh-mmd-fullscreen').evaluate((node) => node === document.activeElement), true);
    return true;
  });

  await run('keyboardExportAndOptionalDiagnosticSource', async (page) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) { window.copied = text; } } });
    });
    await page.goto(origin + '/retry');
    const card = page.locator(readyCard);
    await card.locator('svg').waitFor();
    const exportButton = card.getByRole('button', { name: /^导出/ });
    await exportButton.press('Enter');
    const menu = card.locator('.dsh-mmd-export-list');
    await menu.waitFor();
    await page.keyboard.press('End');
    assert.equal(await menu.getByRole('button', { name: '下载 .mmd' }).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await exportButton.evaluate((node) => node === document.activeElement), true);
    const source = 'flowchart LR\nA[Unfinished';
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    await card.locator('textarea').fill(source);
    const failed = page.locator('.dsh-mmd[data-state="error"]');
    await failed.getByRole('button', { name: '复制诊断' }).click();
    assert.equal(await page.evaluate(() => JSON.parse(window.copied).source), undefined);
    await failed.getByRole('checkbox', { name: '包含源码' }).check();
    await failed.getByRole('button', { name: '复制诊断' }).click();
    assert.equal(await page.evaluate(() => JSON.parse(window.copied).source), source);
    assert.equal(await failed.getByRole('checkbox', { name: '包含源码' }).isChecked(), false);
    return true;
  });

  await run('zenUmlDarkPaletteAndExport', async (page) => {
    await page.addInitScript(() => {
      new MutationObserver((_changes, observer) => {
        if (document.body) {
          document.body.setAttribute('data-ds-dark-theme', '');
          observer.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(origin + '/dark-zenuml');
    const card = page.locator(readyCard);
    const label = card.locator('.participant-label').first();
    await label.waitFor();
    assert.equal(await label.evaluate((node) => getComputedStyle(node).fill), 'rgb(232, 237, 245)');
    const exported = await download(page, card, '下载 SVG');
    assert.match(exported.bytes.toString('utf8'), /fill:#e8edf5/);
    assert.ok((await download(page, card, '下载 PNG（主题背景）')).bytes.readUInt32BE(16) > 0);
    return true;
  });

  await run('edgeBudgetStopsDenseFlowchart', async (page) => {
    await page.goto(origin + '/edge-budget');
    const card = page.locator('.dsh-mmd[data-state="error"]');
    await card.waitFor({ timeout: 6000 });
    assert.equal(await card.locator('svg').count(), 0);
    assert.match(await card.locator('.dsh-mmd-error-details').textContent(), /edge.*limit/i);
    return true;
  });

  await run('embeddedImageExportsWithoutNetwork', async (page) => {
    await page.goto(origin + '/retry');
    const painted = await page.evaluate(async () => {
      const { rasterizeSvg, serializeSvg } = await import('/engine.js');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      const context = canvas.getContext('2d');
      context.fillStyle = '#44aa22';
      context.fillRect(0, 0, 4, 4);
      const resource = canvas.toDataURL();
      const svg = new DOMParser().parseFromString(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><image width="4" height="4" href="' + resource + '"/></svg>',
        'image/svg+xml'
      ).documentElement;
      const owned = document.importNode(svg, true);
      const xml = serializeSvg(owned);
      const image = await createImageBitmap(await rasterizeSvg(owned));
      canvas.width = canvas.height = image.width;
      context.drawImage(image, 0, 0);
      image.close();
      return { embedded: xml.includes(resource), pixel: [...context.getImageData(4, 4, 1, 1).data] };
    });
    assert.deepEqual(painted, { embedded: true, pixel: [68, 170, 34, 255] });
    return true;
  });

  await run('compoundRepairCanvasAndExports', async (page) => {
    await page.goto(`${origin}/canvas`);
    const card = page.locator('.dsh-mmd').first();
    const pane = card.locator('.dsh-mmd-pane');
    await pane.locator('svg').waitFor();
    assert.match(await pane.locator('svg').textContent(), /选中"节点"/);
    await page.waitForFunction(() => document.querySelector('link[href^="/dsh-mermaid/card.css"]')?.sheet
      && getComputedStyle(document.querySelector('.dsh-mmd-pane')).overflow === 'auto');
    for (const view of ['图形', '编辑']) {
      await card.getByRole('button', { name: view, exact: true }).click();
      const before = (await card.boundingBox()).height;
      await pane.dblclick();
      assert.equal(await pane.evaluate((element) => element.style.getPropertyValue('--dsh-mmd-inline-scale')), '2');
      assert.equal((await card.boundingBox()).height, before);
      await pane.dblclick();
      assert.equal(await pane.evaluate((element) => element.style.getPropertyValue('--dsh-mmd-inline-scale')), '1');
    }
    const source = await download(page, card, '下载 .mmd');
    assert.equal(source.bytes.toString('utf8'), mixed);
    const svg = await download(page, card, '下载 SVG');
    assert.equal(svg.name, source.name.replace('.mmd', '.svg'));
    const png = await download(page, card, '下载 PNG');
    const light = await download(page, card, '下载 PNG（主题背景）');
    const corner = (file) => page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const color = [...context.getImageData(0, 0, 1, 1).data];
      image.close();
      return color;
    }, file.bytes.toString('base64'));
    assert.equal((await corner(png))[3], 0);
    assert.deepEqual(await corner(light), [255, 255, 255, 255]);
    assert.equal(light.name, png.name.replace('.png', '-background.png'));
    const next = await download(page, page.locator('.dsh-mmd').nth(1), '下载 .mmd');
    assert.notEqual(next.name, source.name);
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
    await page.waitForFunction(() => document.querySelector('.dsh-mmd').dataset.state === 'ok');
    assert.deepEqual(await corner(await download(page, card, '下载 PNG（主题背景）')), [0, 0, 0, 255]);
    return true;
  });

  await run('geometryAndVisibility', async (page) => {
    await page.route(moduleRoutes, (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `import {renderMermaid as render} from '/engine.js';
        export { default } from '/engine.js';
        export * from '/engine.js';
        export async function renderMermaid(id, source, signal) {
          if (source.includes('Invisible')) return {svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g opacity="0"><rect width="90" height="90"/></g><rect width="0" height="0"/></svg>'};
          return render(id, source, signal);
        }`,
    }));
    await page.goto(`${origin}/geometry`);
    const cards = page.locator('.dsh-mmd');
    for (let index = 0; index < 5; index++) {
      await cards.nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => ['ok', 'empty'].includes(document.querySelectorAll('.dsh-mmd')[index]?.dataset.state), index);
    }
    assert.equal(await cards.nth(4).getAttribute('data-state'), 'empty');
    assert.equal(await cards.nth(5).getAttribute('data-state'), 'pending');
    await cards.nth(5).evaluate((card) => { card.parentElement.hidden = false; });
    await cards.nth(5).scrollIntoViewIfNeeded();
    await cards.nth(5).locator('svg').waitFor();
    assert.match(await cards.nth(2).locator('svg').textContent(), /Only a title/);
    assert.match(await cards.nth(3).locator('svg').textContent(), /a.*b.*c/);
    const canvas = cards.first().locator('.dsh-mmd-pane');
    const label = canvas.locator('.nodeLabel').first();
    const readable = (await label.boundingBox()).height;
    assert.ok(readable >= 10, `Initial label height was ${readable}`);
    const size = (await cards.first().boundingBox()).height;
    await cards.first().getByRole('button', { name: '适应卡片', exact: true }).click();
    assert.ok((await label.boundingBox()).height < readable);
    assert.equal((await cards.first().boundingBox()).height, size);
    const journeyDownload = await download(page, cards.nth(1), '下载 SVG');
    const fits = await page.evaluate((value) => {
      const svg = new DOMParser().parseFromString(value, 'image/svg+xml').documentElement;
      document.body.append(svg);
      const bounds = svg.getBBox();
      const view = svg.viewBox.baseVal;
      svg.remove();
      return bounds.x >= view.x - 0.1 && bounds.y >= view.y - 0.1 &&
        bounds.x + bounds.width <= view.x + view.width + 0.1 && bounds.y + bounds.height <= view.y + view.height + 0.1;
    }, journeyDownload.bytes.toString('utf8'));
    assert.equal(fits, true);
    return { initialWideLabelPx: Math.round(readable * 10) / 10, journeyExportFits: fits };
  });

  for (const [theme, darkHost, expected, common] of [
    ['default', true, '#fff'], ['neutral', true, '#fff'], ['forest', true, '#fff'], ['dark', false, '#000'],
    ['base', true, '#fff'], ['base', true, '#fff', { fontSize: '16px' }],
  ]) {
    await run(`palette-${theme}${common ? '-typography' : ''}`, async (page) => {
      const style = common ? { theme, themeVariables: { common } } : { theme };
      await page.route('**/dsh-mermaid/config.json', (route) => route.fulfill({ json: normalizeRenderConfig(style) }));
      if (darkHost) await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => document.body.setAttribute('data-ds-dark-theme', ''), { once: true });
      });
      await page.goto(`${origin}/palette`);
      const card = page.locator('.dsh-mmd').first();
      const pane = card.locator('.dsh-mmd-pane');
      await pane.locator('svg').waitFor();
      const flow = page.locator('.dsh-mmd').nth(1);
      await flow.locator('svg').waitFor();
      const colors = await pane.evaluate((element) => {
        const label = element.querySelector('text.messageText');
        const link = element.querySelector('.messageLine0');
        const background = getComputedStyle(element).backgroundColor;
        const node = document.querySelector('.dsh-mmd-pane g.node');
        return [
          [getComputedStyle(label).fill, background],
          [getComputedStyle(link).stroke, background],
          [getComputedStyle(node.querySelector('.nodeLabel')).color, getComputedStyle(node.querySelector('rect')).fill],
        ];
      });
      const contrast = colors.map(([first, second]) => contrastRatio(first, second));
      assert.ok(contrast[0] >= 4.5 && contrast[1] >= 3 && contrast[2] >= 4.5,
        `${theme} message, link and node contrast was ${contrast}`);
      const background = await pane.evaluate((element) => element.style.getPropertyValue('--dsh-mmd-diagram-background'));
      assert.equal(background, expected);
      await card.getByRole('button', { name: '全屏', exact: true }).click();
      const viewport = page.locator('.dsh-mmd-viewer-viewport');
      assert.equal(await viewport.evaluate((element) => element.style.getPropertyValue('--dsh-mmd-diagram-background')), expected);
      await page.keyboard.press('Escape');
      const graphic = await download(page, card, '下载 SVG');
      assert.match(graphic.bytes.toString('utf8'), expected === '#fff' ? /background-color: white|background-color: rgb\(255/ : /background-color: black|background-color: rgb\(0/);
      return { messageContrast: Math.round(contrast[0] * 100) / 100, linkContrast: Math.round(contrast[1] * 100) / 100,
        nodeContrast: Math.round(contrast[2] * 100) / 100, background };
    });
  }

  await run('palette-base-node-fill', async (page) => {
    let variables;
    await page.route('**/dsh-mermaid/config.json', (route) =>
      route.fulfill({ json: normalizeRenderConfig({ theme: 'base', themeVariables: { common: variables } }) }));
    await page.addInitScript(() => {
      const dark = new URLSearchParams(location.search).get('hostTheme') === 'dark';
      document.addEventListener('DOMContentLoaded', () => document.body.toggleAttribute('data-ds-dark-theme', dark), { once: true });
    });
    const cases = [
      { name: 'lightFillOnDarkHost', dark: true, variables: { mainBkg: '#e0e7ff' }, fill: 'rgb(224, 231, 255)', background: '#000' },
      { name: 'darkFillOnLightHost', dark: false, variables: { mainBkg: '#1e293b' }, fill: 'rgb(30, 41, 59)', background: '#fff' },
      { name: 'middleTone', dark: true, variables: { primaryColor: '#777' }, fill: 'rgb(119, 119, 119)', background: '#000' },
      { name: 'explicitTextAndDarkMode', dark: false, variables: { mainBkg: '#e0e7ff', primaryTextColor: '#0055aa', darkMode: true },
        fill: 'rgb(224, 231, 255)', text: 'rgb(0, 85, 170)', background: '#000' },
    ];
    const nodePaint = (pane) => pane.locator('svg').evaluate((element) => {
      const node = element.querySelector('g.node');
      return {
        fill: getComputedStyle(node.querySelector('rect')).fill,
        text: getComputedStyle(node.querySelector('.nodeLabel')).color,
        background: element.parentElement.style.getPropertyValue('--dsh-mmd-diagram-background'),
      };
    });
    const measurements = {};
    for (const sample of cases) {
      variables = sample.variables;
      await page.goto(`${origin}/retry?hostTheme=${sample.dark ? 'dark' : 'light'}`);
      const pane = page.locator(readyCard).locator('.dsh-mmd-pane');
      const paint = await nodePaint(pane);
      assert.equal(paint.fill, sample.fill);
      assert.equal(paint.background, sample.background);
      const contrast = contrastRatio(paint.fill, paint.text);
      if (sample.text) assert.equal(paint.text, sample.text);
      else assert.ok(contrast >= 4.5, `${sample.name} node contrast was ${contrast}`);
      measurements[sample.name] = Math.round(contrast * 100) / 100;
    }
    variables = { mainBkg: '#e0e7ff' };
    await page.goto(`${origin}/palette-node-text-override?hostTheme=dark`);
    const cards = page.locator(readyCard);
    await cards.nth(1).waitFor();
    assert.equal((await nodePaint(cards.first().locator('.dsh-mmd-pane'))).text, 'rgb(0, 85, 170)');
    assert.equal((await nodePaint(cards.nth(1).locator('.dsh-mmd-pane'))).text, 'rgb(51, 51, 51)');
    measurements.perDiagramOverridePreserved = true;
    return measurements;
  });

  await run('pngLimitsAndFailure', async (page) => {
    await page.goto(`${origin}/retry`);
    const card = page.locator(readyCard);
    await card.waitFor();
    const sizes = await page.evaluate(async () => {
      const { rasterizeSvg } = await import('/engine.js');
      const result = [];
      for (const [w, h] of [[20000, 10000], [30000, 1], [100, 50]]) {
        const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`, 'image/svg+xml').documentElement;
        const image = await createImageBitmap(await rasterizeSvg(document.importNode(svg, true)));
        result.push([image.width, image.height]);
        image.close();
      }
      return result;
    });
    assert.ok(sizes[0][0] * sizes[0][1] <= 16_000_000 && sizes[0][0] * sizes[0][1] > 15_900_000);
    assert.deepEqual(sizes[1], [8192, 1]);
    assert.deepEqual(sizes[2], [300, 150]);
    await page.evaluate(() => {
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        HTMLCanvasElement.prototype.toBlob = encode;
        callback(null);
      };
    });
    await card.getByRole('button', { name: /^导出/ }).click();
    await card.getByRole('button', { name: '下载 PNG', exact: true }).click();
    await card.locator('.dsh-mmd-export-error').waitFor();
    await download(page, card, '下载 PNG');
    const recovery = await page.evaluate(async () => {
      const { rasterizeSvg } = await import('/engine.js');
      const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1000"><rect width="2000" height="1000"/></svg>', 'image/svg+xml').documentElement;
      const original = HTMLCanvasElement.prototype.toBlob;
      const originalTimer = window.setTimeout;
      const samples = [];
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        samples.push(this.width);
        if (samples.length === 1) callback(null);
        else original.call(this, callback, ...args);
      };
      try {
        await rasterizeSvg(document.importNode(svg, true));
        HTMLCanvasElement.prototype.toBlob = () => {};
        window.setTimeout = (callback, delay, ...args) => originalTimer(callback, delay === 8000 ? 80 : delay, ...args);
        let timedOut = false;
        try { await rasterizeSvg(document.importNode(svg, true)); }
        catch (error) { timedOut = /timed out/.test(error.message); }
        return { samples, timedOut };
      } finally {
        HTMLCanvasElement.prototype.toBlob = original;
        window.setTimeout = originalTimer;
      }
    });
    assert.deepEqual(recovery.samples, [5656, 2828]);
    assert.equal(recovery.timedOut, true);
    return { sizes, recovery };
  });

  if (smokeCases) assert.deepEqual(new Set(Object.keys(report)), smokeCases);
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  for (const cleanup of cleanups.reverse()) cleanup?.();
}
