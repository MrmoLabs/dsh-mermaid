// Build first, then run with Playwright's Chromium or a supplied executable.
// npm run check:browser -- [--smoke] [playwright-module] [browser-executable]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply } from '../lib/index.js';
import { normalizeRenderConfig } from '../src/render-config.js';

const args = process.argv.slice(2);
const smokeCases = args[0] === '--smoke' ? new Set([
  'issue1InvalidSource', 'issues4And7Titlebar', 'issue6TooltipOverflow', 'issues8And10ExportAndDraft',
  'issue9Original', 'issue12Original', 'codeRetryExport', 'palette-base-typography', 'palette-base-node-fill',
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
const issueFixture = async (number) => (await readFile(new URL(`./fixtures/issue-${number}.mmd`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const [issue8, issue9, issue12] = await Promise.all([8, 9, 12].map(issueFixture));
const issue1 = 'this is not a diagram';
const wide = `flowchart LR\n${Array.from({ length: 18 }, (_, n) => `N${n}[Node ${n + 1}]`).join(' --> ')}`;
const journey = 'journey\n title A long project title\n section Plan\n First step: 5: Alex\n Second step: 3: Alex';
const codeBlock = (source) => `<pre><code class="language-mermaid">${source.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</code></pre>`;
const fixtures = {
  '/retry': codeBlock(basic),
  '/issue-1': codeBlock(issue1),
  '/issue-6': '<style>html,body{height:100%;margin:0}article{height:100%;overflow:auto}</style>' + codeBlock(basic),
  '/issue-8': codeBlock(issue8),
  '/issue-9': codeBlock(issue9),
  '/issue-12': codeBlock(issue12),
  '/code-retry-export': codeBlock(journey.replace('A long project title', 'A very long title '.repeat(10).trimEnd())),
  '/stream': codeBlock(unfinished),
  '/canvas': codeBlock(mixed) + codeBlock(basic),
  '/queue': codeBlock('flowchart LR\nA[STALL]-->B') + codeBlock(basic),
  '/offscreen': Array.from({ length: 15 }, (_, index) => codeBlock(`flowchart LR\nA[Node ${index}]-->B`) + '<div style="height:450px"></div>').join(''),
  '/geometry': `<div style="width:480px">${[wide, journey, '---\ntitle: Only a title\n---\nflowchart LR', 'xychart-beta\n x-axis [a,b,c]\n y-axis 0 --> 10\n bar [1,3,5]'].map(codeBlock).join('')}${codeBlock('flowchart LR\nInvisible --> B')}<div hidden>${codeBlock('flowchart LR\nWasHidden --> B')}</div></div>`,
  '/palette': codeBlock('sequenceDiagram\n Alice->>Bob: Message') + codeBlock(basic),
  '/palette-node-text-override': codeBlock('---\nconfig:\n  theme: base\n  themeVariables:\n    primaryTextColor: "#0055aa"\n---\n' + basic) + codeBlock(basic),
  '/math': codeBlock('flowchart LR\nA["$$x^2+1$$"]-->B'),
};
const client = await readFile('lib/client.js');
const runtime = await readFile('lib/mermaid-runtime.js');
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const route = routes.get(pathname);
  if (route) return void route.handler(request, response);
  if (pathname === '/client.js' || pathname === '/engine.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(pathname === '/client.js' ? client : runtime);
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
const moduleRoutes = '**/dsh-mermaid/mermaid-runtime.js?*';
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
      assert.equal(new URL(urls[1]).searchParams.get('retry'), '1');
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
    assert.equal(new URL(requests[1]).searchParams.get('retry'), '1');
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
    assert.equal(new URL(requests[1]).searchParams.get('retry'), '1');
    await cards.nth(0).getByRole('button', { name: '重试渲染' }).click();
    await cards.nth(0).locator('svg').waitFor();
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
        export {default,isMermaidSourceError,rasterizeSvg,createInlinePreview} from '/engine.js';
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
      for (const [w, h] of [[20000, 10000], [30000, 1]]) {
        const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`, 'image/svg+xml').documentElement;
        const image = await createImageBitmap(await rasterizeSvg(document.importNode(svg, true)));
        result.push([image.width, image.height]);
        image.close();
      }
      return result;
    });
    assert.ok(sizes[0][0] * sizes[0][1] <= 16_000_000 && sizes[0][0] * sizes[0][1] > 15_900_000);
    assert.deepEqual(sizes[1], [8192, 1]);
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
    return sizes;
  });

  if (smokeCases) assert.deepEqual(new Set(Object.keys(report)), smokeCases);
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  for (const cleanup of cleanups.reverse()) cleanup?.();
}
