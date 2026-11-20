// Run against the CLI bundled in DSH Desktop with a disposable profile and local model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [executable, cli, playwrightModule, executablePath] = process.argv.slice(2);
assert.ok(executable && cli && playwrightModule, 'Pass the Desktop executable, DSH CLI, Playwright module and optional browser executable.');
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const home = resolve('.runtime', `native-fence-${Date.now()}`, 'home');
const profile = join(home, 'profiles', 'web');
const install = join(profile, 'node_modules', 'dsh-mermaid');
await mkdir(install, { recursive: true });
for (const name of ['package.json', 'cordis.patch.yml', 'lib']) {
  await cp(name, join(install, name), { recursive: true });
}
await writeFile(join(profile, 'package.json'), JSON.stringify({
  name: 'native-fence-check', private: true, dependencies: { 'dsh-mermaid': 'file:.' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-mermaid'] } },
}), 'utf8');
await writeFile(join(profile, 'cordis.patch.yml'), [
  '- id: ui-settings-general',
  '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
  '  config: {welcomeNoticeVersion: "2026-09-28.1"}',
].join('\n'), 'utf8');

const fence = String.fromCharCode(96).repeat(3);
const cases = {
  pause: { first: `${fence}mermaid\nflowchart LR\nPauseFixture -->`, last: `Continued\n${fence}` },
  progressive: {
    first: `${fence}mermaid\nflowchart LR\nProgressiveFixture --> FirstPreview\n`,
    continuations: [['progressive-invalid', 'FirstPreview -->'], ['progressive-finish', `FinalFixture\n${fence}`]],
  },
  cancel: { first: `${fence}mermaidjs\nflowchart LR\nCancelFixture -->`, last: `ShouldNeverAppear\n${fence}` },
  limit: { first: `${fence}mmd\nflowchart LR\nLimitFixture -->`, stop: 'max_tokens' },
  replay: {
    first: [
      `${fence}\nflowchart LR\nUntaggedFixture --> Done\n${fence}`,
      `${fence}mermaid\nflowchart LR\nCrashFixture --> NeverRendered\n${fence}`,
      `${fence}mermaidjs\nflowchart LR\nAdjacentFixture --> Done\n${fence}`,
      `${fence}mmd\nflowchart LR\nAliasFixture --> Done\n${fence}`,
      `${fence}\nordinary untagged example\n${fence}`,
    ].join('\n\n'),
  },
};
const gates = new Map();
const modelScenarios = new Set();
const openGate = (scenario) => {
  for (const release of gates.get(scenario) || []) release();
  gates.delete(scenario);
};
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const lastUserMessage = input.messages?.findLast(({ role }) => role === 'user');
    const scenario = JSON.stringify(lastUserMessage || {}).match(/mermaid-acceptance-(pause|progressive|cancel|limit|replay)/)?.[1];
    modelScenarios.add(scenario);
    const sample = cases[scenario] || { first: 'Local fixture' };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const delta = (value) => event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: value } });
    event('message_start', { message: { id: `msg_local_${scenario}`, type: 'message', role: 'assistant', model: input.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    delta(sample.first);
    for (const [name, text] of sample.continuations || (sample.last ? [[scenario, sample.last]] : [])) {
      await new Promise((done) => {
        if (!gates.has(name)) gates.set(name, new Set());
        gates.get(name).add(done);
        res.once('close', done);
      });
      if (res.destroyed) return;
      delta(text);
    }
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: sample.stop || 'end_turn', stop_sequence: null }, usage: { input_tokens: 120, output_tokens: 50 } });
    event('message_stop', {});
    res.end();
  } catch (error) { res.destroy(error); }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const modelUrl = `http://127.0.0.1:${server.address().port}/anthropic`;
const host = spawn(executable, ['--expose-internals', cli, '--profile', 'web', '--no-open', '--port', '0'], {
  windowsHide: true,
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'local-synthetic-key', DEEPSEEK_BASE_URL: modelUrl },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
host.stdout.on('data', (data) => { output += data; });
host.stderr.on('data', (data) => { output += data; });
let browser;
try {
  const deadline = Date.now() + 20_000;
  let url;
  while (!(url = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\S*)/)?.[1])) {
    assert.ok(Date.now() < deadline && host.exitCode === null, 'Isolated DSH failed to start');
    await new Promise((done) => setTimeout(done, 60));
  }
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(15_000);
  const origin = new URL(url).origin;
  await page.route('**/*', (route) => {
    const target = new URL(route.request().url());
    return target.origin === origin || ['data:', 'blob:'].includes(target.protocol) ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes) {
      if (this.classList.contains('dsh-mmd-native-seat') &&
          nodes.some((node) => node.querySelector?.('textarea')?.value.includes('CrashFixture'))) {
        window.injectedMermaidCardError = true;
        throw new Error('Synthetic failure in one Mermaid card');
      }
      return append.apply(this, nodes);
    };
  });
  await page.goto(url);
  const composer = page.locator('[contenteditable="true"]:visible,textarea:visible').last();
  for (const control of [/^(继续|Continue)$/, /^(开始使用|Get started)$/i]) {
    const button = page.getByRole('button', { name: control }).first();
    await page.waitForTimeout(300);
    if (await button.isVisible()) await button.dispatchEvent('click');
  }
  await page.keyboard.press('Escape');
  const send = page.getByRole('button', { name: /发送消息|Send message/i }).first();
  async function prompt(scenario) {
    await composer.fill(`mermaid-acceptance-${scenario}`);
    await send.click();
  }
  const source = (value) => page.locator('pre code').filter({ hasText: value }).first();
  const card = (value) => page.locator('.dsh-mmd-native-seat .dsh-mmd').filter({ hasText: value }).first();
  async function rendered(value) {
    const match = value === 'UntaggedFixture' ? page.locator('.dsh-mmd').filter({ hasText: value }).first() : card(value);
    await match.scrollIntoViewIfNeeded();
    await match.locator('svg').waitFor();
    assert.equal(await match.getAttribute('data-state'), 'ok');
  }

  await prompt('pause');
  await source('PauseFixture').waitFor();
  await page.waitForTimeout(1250);
  assert.equal(await card('PauseFixture').locator('svg').count(), 0);
  assert.ok(await source('PauseFixture').isVisible());
  assert.notEqual(await card('PauseFixture').getAttribute('data-state'), 'error');
  openGate('pause');
  await rendered('Continued');

  await prompt('progressive');
  const liveCard = card('ProgressiveFixture');
  const liveSvg = liveCard.locator('svg');
  await liveSvg.waitFor();
  assert.equal(await liveCard.getAttribute('data-streaming'), '');
  assert.match(await liveSvg.textContent(), /FirstPreview/);
  assert.ok(await liveCard.getByRole('button', { name: /^(编辑|Edit)$/ }).isDisabled());
  openGate('progressive-invalid');
  await page.waitForFunction(() => [...document.querySelectorAll('.dsh-mmd')].some((node) =>
    node.querySelector('svg')?.textContent.includes('ProgressiveFixture') && node.dataset.state === 'pending'));
  assert.match(await liveSvg.textContent(), /FirstPreview/);
  openGate('progressive-finish');
  await rendered('FinalFixture');
  assert.equal(await liveCard.getAttribute('data-streaming'), null);
  assert.match(await liveSvg.textContent(), /FinalFixture/);

  await prompt('cancel');
  await source('CancelFixture').waitFor();
  assert.equal(await card('CancelFixture').locator('svg').count(), 0);
  await page.getByRole('button', { name: /停止|Stop/i }).last().click();
  await send.waitFor();
  assert.equal(await page.getByText('ShouldNeverAppear', { exact: false }).count(), 0);
  await page.waitForFunction(() => [...document.querySelectorAll('.dsh-mmd')].some((node) =>
    node.textContent.includes('CancelFixture') && node.dataset.state === 'error'));

  await prompt('limit');
  await card('LimitFixture').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.dsh-mmd')].some((node) =>
    node.textContent.includes('LimitFixture') && node.dataset.state === 'error'));

  await prompt('replay');
  async function checkReplay() {
    try {
      await source('UntaggedFixture').waitFor({ state: 'attached' });
      await rendered('UntaggedFixture');
    } catch (error) {
      const observations = await page.locator('[data-slot="conversation.chat.markdown.fence"]').evaluateAll((fences) =>
        fences.filter((item) => /UntaggedFixture|AdjacentFixture|CrashFixture/.test(item.textContent)).map((item) => ({
          source: item.querySelector('code')?.textContent,
          className: item.querySelector('code')?.className,
          native: Boolean(item.querySelector('.dsh-mmd-native-fence')),
          cards: item.querySelectorAll('.dsh-mmd').length,
        })));
      const untagged = await page.evaluate(() => [...document.querySelectorAll('pre,code,p')]
        .filter((item) => /UntaggedFixture|ordinary untagged/.test(item.textContent))
        .slice(0, 6).map((item) => item.outerHTML.slice(0, 250)));
      throw new Error(`Native replay observations: ${JSON.stringify({ observations, untagged })}, model scenarios: ${[...modelScenarios]}`, { cause: error });
    }
    await source('CrashFixture').waitFor();
    assert.ok(await page.evaluate(() => window.injectedMermaidCardError));
    assert.equal(await card('CrashFixture').count(), 0);
    await rendered('AdjacentFixture');
    await rendered('AliasFixture');
    for (const marker of ['UntaggedFixture', 'AdjacentFixture', 'AliasFixture']) {
      assert.equal(await page.locator('.dsh-mmd').filter({ hasText: marker }).count(), 1);
    }
    await source('ordinary untagged').waitFor();
    assert.equal(await card('ordinary untagged').count(), 0);
  }
  await checkReplay();
  await page.reload();
  await checkReplay();
  console.log(JSON.stringify({ host: 'DSH Desktop bundled host', pauseMs: 1250, progressive: true, retainedPreview: true, stopped: true, truncated: true, replayed: true, untagged: true, componentFallback: true }));
} finally {
  for (const scenario of gates.keys()) openGate(scenario);
  await browser?.close();
  if (host.exitCode === null) {
    const stopped = new Promise((done) => host.once('exit', done));
    host.kill();
    await stopped;
  }
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
