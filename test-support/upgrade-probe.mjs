// Optional package-manager upgrade acceptance. Never uses the active DSH_HOME.
// node test-support/upgrade-probe.mjs <host-executable> <dsh-cli> <playwright-module> <browser> <old.tgz> <candidate.tgz>
// Baseline: a published 0.4.5 or 0.5.0 archive. The candidate must have a different
// version and contain the current checkout's built client (run npm run build).
// Supply local DSH, Playwright Core and Chromium-compatible browser paths.
// Reports and downloads stay under the ignored .runtime directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arguments_ = process.argv.slice(2);
assert.equal(arguments_.length, 6, 'Pass the host, CLI, browser tools and both package archives.');
const [executable, cli, playwrightModule, browserExecutable, oldArchive, candidateArchive] = arguments_.map((value) => resolve(value));
const directory = resolve('.runtime', `upgrade-acceptance-${Date.now()}`);
const home = join(directory, 'home');
const profile = join(home, 'profiles', 'web');
const installed = join(profile, 'node_modules', 'dsh-mermaid');
const environment = { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1' };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const redact = (value) => value.replace(/token=[^\s]+/g, 'token=REDACTED');
const report = { directory, platform: process.platform, hostExecutable: executable, oldArchive, candidateArchive, checks: {} };
let child;
let browser;
let output = '';
let base;
let url;

async function packageCommand(label, ...args) {
  const command = spawn(executable, ['--expose-internals', cli, 'plugin', '--profile', 'web', ...args], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  command.stdout.on('data', (chunk) => { text += chunk; });
  command.stderr.on('data', (chunk) => { text += chunk; });
  const timer = setTimeout(() => command.kill(), 120000);
  const code = await new Promise((done, reject) => { command.once('error', reject); command.once('exit', done); });
  clearTimeout(timer);
  await writeFile(join(directory, `${label}.log`), redact(text), 'utf8');
  assert.equal(code, 0, `${label}: ${redact(text)}`);
}
async function start(label) {
  output = '';
  child = spawn(executable, ['--expose-internals', cli, '--profile', 'web', '--no-open', '--port', '0'], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const deadline = Date.now() + 30000;
  while (true) {
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/);
    if (match) { url = match[1]; base = new URL(url).origin; return; }
    assert.ok(!spawnError && child.exitCode === null && Date.now() < deadline, `${label}: ${redact(spawnError?.message || output)}`);
    await wait(100);
  }
}
async function stop(label) {
  if (!child) return;
  const current = child;
  child = undefined;
  if (current.pid && current.exitCode === null && current.signalCode === null) {
    const stopped = new Promise((done) => current.once('exit', done));
    current.kill();
    await stopped;
  }
  await writeFile(join(directory, `${label}-host.log`), redact(output), 'utf8');
}
async function fixture(name, { modern = false, expectedFill } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/upgrade-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head></head><body></body></html>' }));
  await page.goto(`${base}/upgrade-fixture`);
  await page.evaluate(() => { window.__ModuleLoader__ = { load(registration) { registration.factory(() => { throw new Error('unexpected require'); }).apply({ effect(callback) { window.disposePlugin = callback(); } }); } }; });
  await page.addScriptTag({ content: await readFile(join(installed, 'lib', 'client.js'), 'utf8') });
  await page.evaluate(() => { const pre = document.createElement('pre'); const code = document.createElement('code'); code.className = 'language-mermaid'; code.textContent = 'flowchart LR\nA[Upgrade retained]-->B[Diagram ready]'; pre.append(code); document.body.append(pre); });
  await page.locator('.dsh-mmd[data-state="ok"] svg').waitFor();
  const card = page.locator('.dsh-mmd');
  if (expectedFill) {
    const fills = await card.locator('svg rect, svg path, svg polygon').evaluateAll((nodes) => nodes.flatMap((node) => [getComputedStyle(node).fill, getComputedStyle(node).stroke]));
    assert.ok(fills.includes(expectedFill), `${name}: missing ${expectedFill}`);
  }
  await card.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await page.locator('.dsh-mmd-viewer-stage svg').waitFor();
  await page.getByRole('button', { name: 'Close fullscreen viewer' }).click();
  const exportButton = card.getByRole('button', { name: /^Export/ });
  if (await exportButton.isVisible()) await exportButton.click();
  const downloaded = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const download = await downloaded;
  const file = join(directory, `${name}.svg`);
  await download.saveAs(file);
  assert.equal(await page.evaluate((xml) => new DOMParser().parseFromString(xml, 'image/svg+xml').querySelector('parsererror')?.textContent || '', await readFile(file, 'utf8')), '');
  if (modern) {
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = card.locator('textarea');
    await editor.fill('flowchart LR\nA[Edited after upgrade]-->B');
    await page.waitForFunction(() => document.querySelector('.dsh-mmd[data-state="ok"] svg')?.textContent.includes('Edited after upgrade'));
    await editor.fill('flowchart LR\nA-->');
    await page.locator('.dsh-mmd[data-state="error"]').waitFor();
    if (await exportButton.isVisible()) await exportButton.click();
    assert.equal(await card.getByRole('button', { name: 'Download SVG', exact: true }).isDisabled(), true);
    if (await exportButton.isVisible()) await page.keyboard.press('Escape');
    await card.getByRole('button', { name: /^(Reset|Restore original)$/ }).click();
    await page.locator('.dsh-mmd[data-state="ok"]').waitFor();
  }
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
  return { render: true, fullscreen: true, svgExport: true, editorAndStaleExportGuard: modern ? 'passed' : 'not available in the baseline', errors };
}

async function checkStylePreview() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  try {
    await page.goto(url);
    const plugins = page.getByRole('button', { name: '插件', exact: true }).first();
    await plugins.waitFor();
    await page.waitForTimeout(500);
    const continueButton = page.getByRole('button', { name: '继续', exact: true });
    if (await continueButton.count()) {
      await continueButton.click();
      await page.getByText('开始使用', { exact: true }).waitFor();
    }
    await page.keyboard.press('Escape');
    await plugins.click();
    await page.getByText('dsh-mermaid', { exact: true }).first().click();
    const preview = page.getByRole('region', { name: '效果预览' });
    const checkFill = async (label, color) => {
      await preview.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction((fill) => {
        const canvas = document.querySelector('.dsh-mmd-settings-preview-canvas');
        return canvas && [...canvas.querySelectorAll('svg g.node rect, svg g.node path, svg g.node polygon')]
          .some((shape) => getComputedStyle(shape).fill === fill);
      }, color);
    };
    await checkFill('浅色', 'rgb(221, 238, 255)');
    await checkFill('深色', 'rgb(34, 51, 68)');
  } finally {
    await page.close();
  }
}

await mkdir(profile, { recursive: true });
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'mermaid-upgrade-acceptance', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }, null, 2), 'utf8');
await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8');
// A separate local package proves that the package operation retains other dependencies.
const neighbor = join(directory, 'neighbor');
await mkdir(neighbor);
await writeFile(join(neighbor, 'package.json'), JSON.stringify({ name: 'mermaid-acceptance-neighbor', version: '1.0.0', main: 'index.js' }), 'utf8');
await writeFile(join(neighbor, 'index.js'), 'module.exports = "unrelated package retained";\n', 'utf8');
const style = { theme: 'base', look: 'classic', themeVariables: { common: { fontSize: '16px' }, light: { mainBkg: '#ddeeff', primaryTextColor: '#223344' }, dark: { mainBkg: '#223344', primaryTextColor: '#ddeeff' } } };
const patch = `# User-owned style and unrelated override survive package replacement.\n- id: ui-mermaid\n  config: ${JSON.stringify(style)}\n- id: session-title\n  config: { fallbackMaxWords: 7, fallbackMaxBytes: 48, maxTitleBytes: 90 }\n`;
const patchPath = join(profile, 'cordis.patch.yml');
try {
  await packageCommand('install-old', 'add', '-w', oldArchive, neighbor, '--ignore-scripts');
  const before = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.ok(['0.4.5', '0.5.0'].includes(before.version), 'Expected the published 0.4.5 or 0.5.0 baseline');
  const modernBaseline = before.version === '0.5.0';
  if (modernBaseline) await writeFile(patchPath, patch, 'utf8');
  const oldClient = hash(await readFile(join(installed, 'lib', 'client.js')));
  const { chromium } = await import(pathToFileURL(playwrightModule).href);
  browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  report.browser = browser.version();
  await start('old');
  const baselineConfig = await fetch(`${base}/dsh-mermaid/config.json`);
  assert.equal(baselineConfig.status, modernBaseline ? 200 : 404);
  if (modernBaseline) assert.deepEqual((await baselineConfig.json()).style, style);
  report.checks.oldRelease = await fixture('old-release', { modern: modernBaseline, expectedFill: modernBaseline ? 'rgb(221, 238, 255)' : undefined });
  await stop('old');
  if (!modernBaseline) await writeFile(patchPath, patch, 'utf8');
  const sentinel = join(home, 'acceptance-user-data.txt');
  await writeFile(sentinel, 'user-data-marker\n', 'utf8');
  const manifestBefore = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  await packageCommand('upgrade', 'add', '-w', candidateArchive, '--ignore-scripts');
  const after = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.notEqual(after.version, before.version);
  assert.equal(hash(await readFile(join(installed, 'lib', 'client.js'))), hash(await readFile('lib/client.js')));
  assert.notEqual(hash(await readFile(join(installed, 'lib', 'client.js'))), oldClient);
  assert.equal(await readFile(patchPath, 'utf8'), patch);
  assert.equal(await readFile(sentinel, 'utf8'), 'user-data-marker\n');
  const manifestAfter = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  assert.equal(manifestAfter.dependencies['mermaid-acceptance-neighbor'], manifestBefore.dependencies['mermaid-acceptance-neighbor']);
  assert.equal(manifestAfter.dsh.profile.bundles.filter((name) => name === 'dsh-mermaid').length, 1);
  assert.equal((await readFile(patchPath)).subarray(0, 3).equals(Buffer.from([239, 187, 191])), false);
  await start('candidate');
  const protocol = await (await fetch(`${base}/dsh-mermaid/config.json`)).json();
  assert.equal(protocol.status, 'ready');
  assert.deepEqual(protocol.style, style);
  report.checks.upgraded = await fixture('upgraded', { modern: true, expectedFill: 'rgb(221, 238, 255)' });
  await checkStylePreview();
  report.checks.previewUsesPreservedStyle = true;
  await stop('candidate');
  await start('restart');
  assert.deepEqual((await (await fetch(`${base}/dsh-mermaid/config.json`)).json()).style, style);
  await stop('restart');
  // An untouched profile must acquire the original default behavior after upgrading.
  await writeFile(patchPath, '[]\n', 'utf8');
  await start('defaults');
  const defaults = await (await fetch(`${base}/dsh-mermaid/config.json`)).json();
  assert.equal(defaults.status, 'ready');
  assert.equal(defaults.style.theme, 'auto');
  assert.equal(defaults.style.look, 'classic');
  report.checks.noConfiguration = await fixture('upgraded-defaults', { modern: true });
  await stop('defaults');
  await writeFile(patchPath, patch, 'utf8');
  report.from = before.version;
  report.to = after.version;
  Object.assign(report.checks, { packageManagerReplacement: true, sourceBundleHashMatches: true, userPatchBytePreserved: true, unrelatedDependencyPreserved: true, singleBundleRegistration: true, userDataMarkerPreserved: true, restartPersistence: true, unconfiguredDefaults: true });
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stop('final');
}
