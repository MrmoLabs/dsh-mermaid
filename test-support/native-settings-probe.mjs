// Real DSH settings UI, isolated from the active user's profile.
// Same four arguments as host-style-probe.mjs; --inspect prints the initial page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [executable, cli, playwrightModule, browserExecutable, mode] = process.argv.slice(2);
const directory = resolve('.runtime', `native-settings-${Date.now()}`);
const home = join(directory, 'home');
const profile = join(home, 'profiles', 'web');
const installed = join(profile, 'node_modules', 'dsh-mermaid');
await mkdir(installed, { recursive: true });
for (const name of ['package.json', 'cordis.patch.yml']) await cp(name, join(installed, name));
await cp('lib', join(installed, 'lib'), { recursive: true });
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'mermaid-native-acceptance', private: true, dependencies: { 'dsh-mermaid': 'file:.' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-mermaid'] } } }), 'utf8');
await writeFile(join(profile, 'cordis.patch.yml'), '- id: ui-mermaid\n  config: { theme: forest }\n', 'utf8');
const child = spawn(executable, ['--expose-internals', cli, '--profile', 'web', '--no-open', '--port', '0'], {
  windowsHide: true, env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (data) => { output += data; });
child.stderr.on('data', (data) => { output += data; });
let browser;
try {
  const deadline = Date.now() + 20000;
  while (!/dsh web: http:\/\/127\.0\.0\.1:\d+\//.test(output)) {
    assert.ok(child.exitCode === null && Date.now() < deadline, output.replace(/token=[^\s]+/g, 'token=REDACTED'));
    await new Promise((done) => setTimeout(done, 50));
  }
  const url = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/)[1];
  const base = new URL(url).origin;
  const config = await (await fetch(`${base}/dsh-mermaid/config.json`)).json();
  assert.equal(config.style.theme, 'forest');
  const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
  browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  let settingsRequests = 0;
  let diagramRuntimeRequests = 0;
  let previewRuntimeRequests = 0;
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/dsh-mermaid/settings-runtime.js') settingsRequests++;
    if (/\/preview-\d+\/mermaid-runtime\.js$/.test(pathname)) previewRuntimeRequests++;
    else if (pathname.endsWith('/mermaid-runtime.js')) diagramRuntimeRequests++;
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(directory, 'initial.png') });
  async function dismissWelcome() {
    await page.getByRole('button', { name: '插件', exact: true }).first().waitFor();
    await page.waitForTimeout(500);
    const continueButton = page.getByRole('button', { name: '继续', exact: true });
    if (await continueButton.count()) {
      await continueButton.click();
      await page.getByText('开始使用', { exact: true }).waitFor();
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  async function openSettings() {
    await dismissWelcome();
    await page.getByRole('button', { name: '插件', exact: true }).first().click();
    await page.getByText('dsh-mermaid', { exact: true }).first().click();
    await page.getByRole('region', { name: '渲染风格' }).waitFor();
  }
  const initial = await page.locator('body').innerText();
  if (mode?.startsWith('--inspect')) {
    const continueButton = page.getByRole('button', { name: '继续', exact: true });
    if (await continueButton.count()) await continueButton.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (mode === '--inspect-onboarding') {
      console.log(JSON.stringify({ directory, onboarding: await page.locator('body').innerText(), buttons: await page.getByRole('button').evaluateAll((buttons) => buttons.map((button) => ({ text: button.textContent, aria: button.getAttribute('aria-label'), title: button.title }))), errors }, null, 2));
      process.exitCode = 0;
    } else {
    await page.getByText('插件', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const list = await page.locator('body').innerText();
    const mermaid = page.getByText('dsh-mermaid', { exact: true }).first();
    if (await mermaid.count()) await mermaid.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(directory, 'settings.png'), fullPage: true });
    console.log(JSON.stringify({ directory, list: list.slice(0, 3000), page: (await page.locator('body').innerText()).slice(0, 6000), errors }, null, 2));
    }
  } else {
    assert.equal(settingsRequests, 0, 'settings runtime must stay lazy until the bundle page opens');
    assert.equal(previewRuntimeRequests, 0, 'the example runtime must stay lazy until the settings page opens');
    await page.route('**/preview-0/mermaid-runtime.js', (route) => route.fulfill({
      contentType: 'text/javascript', body: 'throw new Error("Preview module unavailable");',
    }), { times: 1 });
    await openSettings();
    const editor = page.getByRole('region', { name: '渲染风格' });
    const preview = editor.getByRole('region', { name: '效果预览' });
    const sample = preview.getByRole('img', { name: '审核流程示例图' });
    const waitForFill = (fill) => page.waitForFunction((color) => {
      const svg = document.querySelector('.dsh-mmd-settings-preview-canvas svg');
      return svg && [...svg.querySelectorAll('rect, polygon, path')].some((node) => {
        const paint = getComputedStyle(node);
        return paint.fill === color || paint.stroke === color;
      });
    }, fill);
    assert.equal(await editor.getByLabel('配色主题', { exact: true }).inputValue(), 'forest');
    assert.equal(await preview.getByRole('group', { name: '预览明暗模式' }).count(), 0, 'fixed themes use a single palette');
    await preview.getByRole('button', { name: '重试预览' }).click();
    await sample.waitFor();
    assert.equal(previewRuntimeRequests, 2, 'a failed module is retried with its own new URL');
    await editor.getByLabel('配色主题', { exact: true }).selectOption('base');
    await editor.getByLabel('配色主题', { exact: true }).selectOption('forest');
    assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true, 'returning to the saved theme must be clean');
    await editor.getByRole('button', { name: '载入 Indigo / Slate 示例', exact: true }).click();
    await preview.getByRole('button', { name: '浅色', exact: true }).click();
    await waitForFill('rgb(238, 242, 255)');
    const classicPaths = await sample.locator('path').count();
    await preview.getByRole('button', { name: '深色', exact: true }).click();
    await waitForFill('rgb(30, 41, 59)');
    await editor.getByLabel('绘图风格', { exact: true }).selectOption('handDrawn');
    await page.waitForFunction((count) => document.querySelectorAll('.dsh-mmd-settings-preview-canvas svg path').length > count, classicPaths);
    assert.equal((await (await fetch(`${base}/dsh-mermaid/config.json`)).json()).style.theme, 'forest', 'preset must only stage a draft');
    await editor.getByRole('tab', { name: '浅色', exact: true }).click();
    assert.equal(await preview.getByRole('button', { name: '浅色', exact: true }).getAttribute('aria-pressed'), 'true');
    await waitForFill('rgb(238, 242, 255)');
    await editor.getByLabel('基础主色', { exact: true }).fill('#ff0000');
    assert.equal(await editor.getByLabel('节点填充', { exact: true }).inputValue(), '#eef2ff');
    assert.equal(await editor.getByText(/节点填充由 mainBkg 单独指定/).isVisible(), true);
    await editor.locator('summary').filter({ hasText: '高级变量' }).click();
    const json = editor.getByLabel('浅色 JSON', { exact: true });
    const lastExample = await sample.getAttribute('id');
    await json.fill('{"primaryColor":');
    assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    assert.match(await editor.getByRole('alert').innerText(), /JSON/);
    await preview.getByText('修正配置错误后即可更新预览。', { exact: true }).waitFor();
    assert.equal(await sample.getAttribute('id'), lastExample, 'an invalid draft must retain the last rendered example');
    await editor.getByRole('tab', { name: '深色', exact: true }).click();
    await editor.getByRole('tab', { name: '浅色', exact: true }).click();
    assert.equal(await json.inputValue(), '{"primaryColor":');
    await json.fill('{"primaryColor":"#ddeeff","primaryTextColor":"#223344","xyChart":{"plotColorPalette":"#ddeeff,#123456"}}');
    assert.equal(await json.isVisible(), true, 'fixing JSON must not collapse the active editor');
    await editor.getByLabel('节点填充', { exact: true }).fill('#e0e7ff');
    await waitForFill('rgb(224, 231, 255)');
    assert.equal(JSON.parse(await json.inputValue()).xyChart.plotColorPalette, '#ddeeff,#123456');
    await editor.getByRole('tab', { name: '公共', exact: true }).click();
    await editor.getByLabel('字号', { exact: true }).fill('16px');
    await page.waitForFunction(() => {
      const svg = document.querySelector('.dsh-mmd-settings-preview-canvas svg');
      return svg && [...svg.querySelectorAll('foreignObject p, text')]
        .some((label) => label.textContent.trim() === '提交' && getComputedStyle(label).fontSize === '16px');
    });
    // Native panel navigation must not erase this editor's uncommitted input.
    await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
    await openSettings();
    assert.equal(settingsRequests, 1, 'panel navigation must reuse the loaded settings editor');
    assert.equal(await editor.getByLabel('配色主题', { exact: true }).inputValue(), 'base');
    assert.equal(await editor.getByLabel('绘图风格', { exact: true }).inputValue(), 'handDrawn');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.getByText('已保存，已打开的图表会自动更新。', { exact: true }).waitFor();
    const saved = await (await fetch(`${base}/dsh-mermaid/config.json`)).json();
    assert.equal(saved.style.theme, 'base');
    assert.equal(saved.style.look, 'handDrawn');
    assert.equal(saved.style.themeVariables.common.fontSize, '16px');
    assert.equal(saved.style.themeVariables.light.primaryColor, '#ddeeff');
    assert.equal(saved.style.themeVariables.light.mainBkg, '#e0e7ff');
    assert.equal(saved.style.themeVariables.light.xyChart.plotColorPalette, '#ddeeff,#123456');
    const patchBytes = await readFile(join(profile, 'cordis.patch.yml'));
    assert.equal(patchBytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), false);
    assert.equal((patchBytes.toString().match(/id: ui-mermaid/g) || []).length, 1);
    await editor.getByRole('tab', { name: '浅色', exact: true }).click();
    await editor.locator('summary').filter({ hasText: '高级变量' }).click();
    await page.screenshot({ path: join(directory, 'custom-light.png'), fullPage: true });
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
    await page.waitForFunction(() => {
      const svg = document.querySelector('.dsh-mmd-settings-preview-canvas svg');
      return svg && [...svg.querySelectorAll('foreignObject p, text')]
        .some((label) => label.textContent.trim() === '提交' && getComputedStyle(label).color === 'rgb(34, 51, 68)');
    });
    await page.screenshot({ path: join(directory, 'custom-dark.png'), fullPage: true });
    const collapseSidebar = page.getByRole('button', { name: '收起侧边栏', exact: true });
    if (await collapseSidebar.isVisible()) await collapseSidebar.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.getByLabel('配色主题', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, 'custom-mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'native form overflows the narrow page');
    const formBounds = await editor.boundingBox();
    assert.ok(formBounds.x >= -1 && formBounds.x + formBounds.width <= 391, 'native settings must fit inside the visible mobile viewport');
    await editor.getByLabel('浅色 JSON', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, 'custom-mobile-json.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await openSettings();
    assert.equal(await editor.getByLabel('配色主题', { exact: true }).inputValue(), 'base');
    assert.equal(await editor.getByLabel('绘图风格', { exact: true }).inputValue(), 'handDrawn');
    await editor.getByLabel('绘图风格', { exact: true }).selectOption('classic');
    await writeFile(join(profile, 'cordis.patch.yml'), '- id: ui-mermaid\n  config: { theme: neutral, look: handDrawn }\n', 'utf8');
    await editor.getByText(/编辑期间宿主配置发生了变化/).waitFor();
    assert.equal(await editor.getByLabel('绘图风格', { exact: true }).inputValue(), 'classic');
    assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    await editor.getByRole('button', { name: '放弃更改', exact: true }).click();
    assert.equal(await editor.getByLabel('配色主题', { exact: true }).inputValue(), 'neutral');
    await writeFile(join(profile, 'cordis.patch.yml'), `- id: ui-mermaid\n  config: ${JSON.stringify({ ...saved.style, theme: 'bas' })}\n`, 'utf8');
    await editor.getByText(/已保存的配置无效，原有字段与变量已保留/).waitFor();
    assert.equal(await editor.getByLabel('配色主题', { exact: true }).inputValue(), '__invalid__');
    await editor.getByLabel('配色主题', { exact: true }).selectOption('base');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.getByText('已保存，已打开的图表会自动更新。', { exact: true }).waitFor();
    const repaired = await (await fetch(`${base}/dsh-mermaid/config.json`)).json();
    assert.deepEqual(repaired.style.themeVariables, saved.style.themeVariables, 'repairing a theme typo must preserve every saved variable');
    await writeFile(join(profile, 'cordis.patch.yml'), '- id: ui-mermaid\n  config: null\n', 'utf8');
    await page.waitForFunction(async () => (await (await fetch('/dsh-mermaid/config.json')).json()).status === 'fallback');
    await editor.getByLabel('已保存的原始配置（只读）', { exact: true }).waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="已保存的原始配置（只读）"]')?.value === 'null');
    assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    await editor.getByRole('button', { name: '恢复默认', exact: true }).click();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.getByText('已保存，已打开的图表会自动更新。', { exact: true }).waitFor();
    await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', 'utf8');
    await page.reload();
    await openSettings();
    assert.equal(await editor.getByLabel('配色主题', { exact: true }).inputValue(), 'auto');
    assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    assert.equal(diagramRuntimeRequests, 0, 'the preview must not import the conversation Mermaid instance');
    const report = { directory, browser: browser.version(), nativeSlot: true, stagedPreset: true, invalidJsonBlocked: true, tabsPreserveDraft: true, navigationPreservesDraft: true, atomicSaveReadback: true, advancedVariablesPreserved: true, reloadPersistence: true, externalConflictPreservesDraft: true, mobileNoHorizontalOverflow: true, lazySettings: true, isolatedPreviewRuntime: true, previewRetry: true, liveLightAndDarkPreview: true, invalidDraftKeepsPreview: true, revertedEditsAreClean: true, nodeFillMatchesActualSvg: true, themeRepairPreservesVariables: true, explicitNullDiagnosed: true, unconfiguredNativeFormWorks: true, errors };
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  }
  await writeFile(join(directory, 'host.log'), output.replace(/token=[^\s]+/g, 'token=REDACTED'), 'utf8');
} finally {
  await browser?.close();
  if (child.exitCode === null) { const stopped = new Promise((done) => child.once('exit', done)); child.kill(); await stopped; }
}
