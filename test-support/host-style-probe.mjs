// Optional real-host/browser acceptance. Uses only a fresh, disposable DSH_HOME.
// node test-support/host-style-probe.mjs <node-or-electron> <dsh-cli.js> <playwright-module> [browser-executable]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [executable, cli, playwrightModule, browserExecutable] = process.argv.slice(2);
assert.ok(executable && cli && playwrightModule, 'Pass the host executable, DSH CLI and Playwright module paths.');
const directory = resolve('.runtime', `style-acceptance-${Date.now()}`);
const home = join(directory, 'home');
const profile = join(home, 'profiles', 'web');
const installed = join(profile, 'node_modules', 'dsh-mermaid');
await mkdir(installed, { recursive: true });
for (const name of ['package.json', 'cordis.patch.yml']) await cp(name, join(installed, name));
await cp('lib', join(installed, 'lib'), { recursive: true });
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'mermaid-acceptance', private: true, dependencies: { 'dsh-mermaid': 'file:.' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-mermaid'] } } }), 'utf8');
const patchPath = join(profile, 'cordis.patch.yml');
const patch = (style) => `- id: ui-mermaid\n  config: ${JSON.stringify(style)}\n`;
await writeFile(patchPath, patch({ theme: 'forest', look: 'handDrawn' }), 'utf8');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let child;
let browser;
let output = '';
let base;
const report = { host: {}, browser: {} };
async function start() {
  output = '';
  child = spawn(executable, ['--expose-internals', cli, '--profile', 'web', '--no-open', '--port', '0'], {
    windowsHide: true,
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const deadline = Date.now() + 20000;
  while (true) {
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { base = match[1]; return; }
    assert.ok(child.exitCode === null && Date.now() < deadline, output.replace(/token=[^\s]+/g, 'token=REDACTED'));
    await wait(50);
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((done) => child.once('exit', done));
  child.kill();
  await stopped;
}
async function config() { return (await fetch(`${base}/dsh-mermaid/config.json`)).json(); }
async function expectTheme(theme) {
  const deadline = Date.now() + 15000;
  while ((await config()).style.theme !== theme) { assert.ok(Date.now() < deadline, 'profile reload timed out'); await wait(100); }
}

try {
  await start();
  assert.equal((await config()).style.theme, 'forest');
  assert.equal((await config()).style.look, 'handDrawn');
  for (const [method, expected] of [['GET', 200], ['HEAD', 200], ['POST', 405]]) {
    const response = await fetch(`${base}/dsh-mermaid/config.json`, { method });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (method === 'POST') assert.equal(response.headers.get('allow'), 'GET, HEAD');
    if (method !== 'GET') assert.equal(await response.text(), '');
  }
  report.host.config = 'apply values, GET/HEAD/405, no-store passed';
  report.host.anonymousStatus = (await fetch(`${base}/dsh-mermaid/config.json`)).status;
  report.host.crossOriginStatus = (await fetch(`${base}/dsh-mermaid/config.json`, { headers: { Origin: 'https://example.invalid' } })).status;
  report.host.foreignHostStatus = (await fetch(`${base}/dsh-mermaid/config.json`, { headers: { Host: 'example.invalid' } })).status;
  report.host.cors = (await fetch(`${base}/dsh-mermaid/config.json`, { headers: { Origin: 'https://example.invalid' } })).headers.get('access-control-allow-origin');
  await writeFile(patchPath, patch({ theme: 'dark' }), 'utf8');
  await expectTheme('dark');
  report.host.hotReload = true;
  await stop();
  await start();
  await expectTheme('dark');
  report.host.restartPersistence = true;
  // Replacing the installed bundle must leave the profile-owned patch intact.
  await cp('cordis.patch.yml', join(installed, 'cordis.patch.yml'));
  assert.match(await readFile(patchPath, 'utf8'), /dark/);
  report.host.bundleReplacementPersistence = true;

  const branch = (color, dark) => ({ primaryColor: color, primaryTextColor: dark ? '#e0e7ff' : '#312e81', primaryBorderColor: '#818cf8', lineColor: dark ? '#94a3b8' : '#64748b', secondaryColor: '#818cf8', tertiaryColor: '#94a3b8', mainBkg: color, actorBkg: color, stateBkg: color, stateLabelColor: dark ? '#e0e7ff' : '#312e81', taskBkgColor: color, pie1: color, pie2: '#818cf8', quadrant1Fill: color, xyChart: { plotColorPalette: color, backgroundColor: dark ? '#181818' : '#ffffff', xAxisLabelColor: dark ? '#e0e7ff' : '#312e81', yAxisLabelColor: dark ? '#e0e7ff' : '#312e81' } });
  const style = { theme: 'base', look: 'classic', themeVariables: { common: { fontFamily: 'system-ui, sans-serif', fontSize: '15px' }, light: branch('#e0e7ff', false), dark: branch('#312e81', true) } };
  await writeFile(patchPath, patch(style), 'utf8');
  await expectTheme('base');
  const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
  browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
  report.browser.version = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/issue5-acceptance', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head></head><body><style>body{background:white}body[data-ds-dark-theme]{background:#121212}</style></body></html>' }));
  await page.goto(`${base}/issue5-acceptance`);
  await page.evaluate(() => { window.__ModuleLoader__ = { load(registration) {
    window.plugin = registration.factory(() => { throw new Error('unexpected require'); });
    window.plugin.apply({ effect(callback) { window.disposePlugin = callback(); } });
  } }; });
  await page.addScriptTag({ content: await readFile('lib/client.js', 'utf8') });
  const sources = [
    'flowchart LR\nA[Start]-->B[End]',
    'sequenceDiagram\nAlice->>Bob: Hello',
    'classDiagram\nclass Animal\nAnimal <|-- Dog',
    'stateDiagram-v2\n[*]-->Ready\nReady-->Done',
    'gantt\ndateFormat YYYY-MM-DD\nsection Work\nTask :a, 2026-11-16, 2d',
    'pie\n"A": 60\n"B": 40',
    'quadrantChart\nx-axis Low --> High\ny-axis Low --> High\nA: [0.2,0.7]',
    'xychart-beta\nx-axis [a,b,c]\ny-axis 0 --> 10\nbar [2,5,8]',
  ];
  await page.evaluate((values) => { for (const source of values) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.className = 'language-mermaid'; code.textContent = source; pre.append(code); document.body.append(pre); } }, sources);
  await page.waitForFunction(() => document.querySelectorAll('.dsh-mmd[data-state="ok"]').length === 8, { timeout: 30000 });
  async function colors() {
    return page.locator('.dsh-mmd-pane svg').evaluateAll((svgs) => svgs.map((svg) => [...svg.querySelectorAll('*')].map((node) => getComputedStyle(node).fill).filter(Boolean)));
  }
  const light = await colors();
  report.browser.stateLabelMetrics = await page.locator('.dsh-mmd-pane svg').nth(3).evaluate((svg) => [...svg.querySelectorAll('foreignObject, .nodeLabel, text')].map((element) => ({ tag: element.tagName, text: element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, color: getComputedStyle(element).color })));
  assert.ok(light.every((fills) => fills.includes('rgb(224, 231, 255)')), 'each diagram must show the light branch color');
  await page.screenshot({ path: join(directory, 'light.png'), fullPage: true });
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
  await page.waitForFunction(() => document.querySelectorAll('.dsh-mmd[data-state="ok"]').length === 8 && !document.querySelector('.dsh-mmd[data-state="rendering"]'));
  // Wait for the style mutation observer and debounce, not only the old ok DOM.
  await page.waitForTimeout(800);
  const dark = await colors();
  assert.ok(dark.every((fills) => fills.includes('rgb(49, 46, 129)')), 'each diagram must show the dark branch color');
  await page.screenshot({ path: join(directory, 'dark.png'), fullPage: true });
  const actualSvgs = await page.locator('.dsh-mmd-pane svg').evaluateAll((svgs) => svgs.map((svg) => svg.outerHTML));
  for (let i = 0; i < actualSvgs.length; i++) await writeFile(join(directory, `diagram-${i}.svg`), actualSvgs[i], 'utf8');
  report.browser.types = ['flowchart', 'sequence', 'class', 'state', 'gantt', 'pie', 'quadrant', 'xyChart'];
  report.browser.lightAndDarkVisibleFills = true;
  const first = page.locator('.dsh-mmd').first();
  await first.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const transform = await page.locator('.dsh-mmd-viewer-stage').evaluate((element) => element.style.transform);
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
  await page.locator('.dsh-mmd-viewer-status').waitFor({ state: 'visible' });
  await page.locator('.dsh-mmd-viewer-status').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.dsh-mmd-viewer-stage').evaluate((element) => element.style.transform), transform);
  assert.ok((await page.locator('.dsh-mmd-viewer-stage svg').evaluate((element) => element.outerHTML)).includes('#e0e7ff'));
  await page.getByRole('button', { name: 'Close fullscreen viewer' }).click();
  const downloadEvent = page.waitForEvent('download');
  await first.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const download = await downloadEvent;
  const exported = join(directory, download.suggestedFilename());
  await download.saveAs(exported);
  const xml = await readFile(exported, 'utf8');
  assert.ok(xml.includes('#e0e7ff'));
  assert.equal((await page.evaluate((text) => new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror')?.textContent || '', xml)), '');
  report.browser.fullscreenAndDownload = true;
  // Real native per-diagram overrides, reset isolation and secure resource limits.
  report.browser.overrides = await page.evaluate(async () => {
    const { default: runtime } = await import('/dsh-mermaid/mermaid-runtime.js');
    const secure = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges'];
    const initialize = () => runtime.initialize({ theme: 'forest', look: 'classic', securityLevel: 'strict', startOnLoad: false, maxTextSize: 50000, maxEdges: 2000, suppressErrorRendering: true });
    const results = [];
    for (const prefix of ['---\nconfig:\n  theme: base\n  look: handDrawn\n  themeVariables:\n    primaryColor: "#e0e7ff"\n  securityLevel: loose\n  maxEdges: 9000\n---\n', '%%{init: {"theme":"base","look":"handDrawn","themeVariables":{"primaryColor":"#e0e7ff"},"securityLevel":"loose","maxEdges":9000}}%%\n']) {
      initialize();
      await runtime.parse(prefix + 'flowchart LR\nA-->B');
      const config = runtime.mermaidAPI.getConfig();
      if (config.theme !== 'base' || config.look !== 'handDrawn' || config.securityLevel !== 'strict' || config.maxEdges !== 2000 || !secure.every((key) => config.secure.includes(key))) throw new Error('override isolation/security failure');
      initialize(); await runtime.parse('flowchart LR\nA-->B');
      if (runtime.mermaidAPI.getConfig().theme !== 'forest') throw new Error('global restore failure');
      results.push('passed');
    }
    const samples = {};
    for (const type of ['flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'gantt', 'pie', 'quadrantChart', 'xychart-beta']) {
      const sources = { flowchart: 'flowchart LR\nA-->B', sequenceDiagram: 'sequenceDiagram\nA->>B: Hello', classDiagram: 'classDiagram\nA <|-- B', 'stateDiagram-v2': 'stateDiagram-v2\nA-->B', gantt: 'gantt\ndateFormat YYYY-MM-DD\nTask :a, 2026-11-16, 1d', pie: 'pie\n"A": 1', quadrantChart: 'quadrantChart\nA: [0.2,0.7]', 'xychart-beta': 'xychart-beta\nx-axis [a,b]\nbar [1,2]' };
      const counts = [];
      for (const look of ['classic', 'handDrawn']) {
        runtime.initialize({ theme: 'base', look, handDrawnSeed: 42, securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true });
        const { svg } = await runtime.render(`look-${type}-${look}`, sources[type]);
        counts.push(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('path').length);
      }
      samples[type] = counts;
    }
    return { frontmatterAndInit: results, secure, classicAndHandDrawnPathCounts: samples };
  });
  // Exercise both self-check fixes through actual cards and the fullscreen UI.
  const recoverySources = [
    '%%{init: {"theme":"base"}}%%\nflowchart LR\nA[Task(test)] --> B',
    '%%{init: {\n"theme":"base"\n}}%%\nflowchart LR\nA[Task(test)] --> B',
    '---\nconfig:\n  theme: base\n  look: neo\n---\nflowchart LR\nA[Start] --> B[Done]',
  ];
  const recoveryOffset = await page.locator('.dsh-mmd').count();
  await page.evaluate((values) => {
    for (const source of values) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid'; code.textContent = source;
      pre.append(code); document.body.append(pre);
    }
  }, recoverySources);
  await page.waitForFunction((total) => document.querySelectorAll('.dsh-mmd[data-state="ok"]').length === total, recoveryOffset + 3);
  for (let index = 0; index < 2; index++) {
    assert.ok((await page.locator('.dsh-mmd').nth(recoveryOffset + index).locator('.dsh-mmd-pane svg').textContent()).includes('Task(test)'));
  }
  report.browser.initWithParenthesizedLabels = true;
  const neoCard = page.locator('.dsh-mmd').nth(recoveryOffset + 2);
  const originalGradient = await neoCard.locator('linearGradient').first().getAttribute('id');
  const originalNeoSvg = await neoCard.locator('.dsh-mmd-pane svg').evaluate((svg) => svg.outerHTML);
  await neoCard.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  const gradientCheck = await page.locator('.dsh-mmd-viewer-stage svg').evaluate((svg) => {
    const ids = new Set([svg, ...svg.querySelectorAll('[id]')].map((node) => node.id));
    const references = [...svg.querySelectorAll('style')].flatMap((node) => [...node.textContent.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)].map((match) => match[1]));
    const gradient = svg.querySelector('linearGradient')?.id;
    return { references, gradient, resolved: references.every((id) => ids.has(id)), painted: [...svg.querySelectorAll('rect,polygon,path')].some((node) => getComputedStyle(node).stroke.includes(`#${gradient}`)) };
  });
  assert.ok(gradientCheck.references.length > 0 && gradientCheck.resolved && gradientCheck.painted);
  assert.notEqual(gradientCheck.gradient, originalGradient);
  report.browser.fullscreenGradientReferences = gradientCheck;
  await writeFile(join(directory, 'neo-original.svg'), originalNeoSvg, 'utf8');
  await writeFile(join(directory, 'neo-fullscreen.svg'), await page.locator('.dsh-mmd-viewer-stage svg').evaluate((svg) => svg.outerHTML), 'utf8');
  await page.screenshot({ path: join(directory, 'neo-fullscreen.png') });
  await page.getByRole('button', { name: 'Close fullscreen viewer' }).click();
  assert.deepEqual(await page.locator('pre code').evaluateAll((nodes) => nodes.slice(-3).map((node) => node.textContent)), recoverySources, 'recovery must preserve the original source');
  assert.deepEqual(errors, []);
  report.browser.errors = errors;
  // A second row cannot replace an existing config route; host or plugin rejects it.
  await writeFile(patchPath, patch(style) + '- insert:\n    - id: ui-mermaid-duplicate\n      name: dsh-mermaid\n      config: {theme: dark}\n', 'utf8');
  await wait(2000);
  assert.equal((await config()).style.theme, 'base');
  report.host.duplicatePreservedOriginal = true;
  report.host.duplicateDiagnostic = /duplicate|already.*registered|already.*apply|already.*plugin/i.test(output);
  await writeFile(join(directory, 'host.log'), output.replace(/token=[^\s]+/g, 'token=REDACTED'), 'utf8');
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ directory, report }, null, 2));
} finally {
  await browser?.close();
  await stop();
}
