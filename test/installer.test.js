import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveLocale } from '../bin/locale.mjs';

const installer = resolve('bin/dsh-mermaid.mjs');

function cliEnv(overrides = {}, path = process.env.PATH || '') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'));
  return { ...env, PATH: path, ...overrides };
}

test('installer language uses explicit settings, skips neutral locales, and falls back to English', () => {
  assert.equal(resolveLocale({ DSH_MERMAID_LANG: 'en', LC_ALL: 'zh_CN.UTF-8' }, 'zh-CN'), 'en');
  assert.equal(resolveLocale({ DSH_LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US' }, 'en-US'), 'zh-CN');
  assert.equal(resolveLocale({ LC_ALL: 'C.UTF-8', LANG: 'POSIX' }, 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale({ DSH_MERMAID_LANG: 'fr-FR' }, 'zh-CN'), 'en');
});

test('installer help and argument errors follow the selected language', () => {
  for (const [language, help, error] of [
    ['en', 'Usage:', '--profile requires a value'],
    ['zh-CN', '用法：', '--profile 需要一个值'],
  ]) {
    const env = cliEnv({ DSH_MERMAID_LANG: language });
    const helpResult = spawnSync(process.execPath, [installer, '--help'], { encoding: 'utf8', env });
    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, new RegExp(help));

    const errorResult = spawnSync(process.execPath, [installer, 'install', '--profile'], { encoding: 'utf8', env });
    assert.equal(errorResult.status, 1);
    assert.ok(errorResult.stderr.includes(error), errorResult.stderr);
  }
});

test('installer reports a missing DSH command in the selected language', () => {
  for (const [language, expected] of [
    ['en', 'Cannot find dsh.'],
    ['zh-CN', '找不到 dsh'],
  ]) {
    const result = spawnSync(process.execPath, [installer, 'install'], {
      encoding: 'utf8',
      env: cliEnv({ DSH_MERMAID_LANG: language }, ''),
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(expected), result.stderr);
    assert.doesNotMatch(result.stderr, /not recognized as an internal or external command/i);
  }
});

test('GitHub installer forwards a safe exact add command to DSH', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mermaid-installer-'));
  const output = join(directory, 'args.txt');
  const windows = process.platform === 'win32';
  const executable = join(directory, windows ? 'dsh.cmd' : 'dsh');
  const body = windows
    ? `@echo off\r\n> "${output}" echo %*\r\n`
    : `#!/bin/sh\nprintf '%s' "$*" > '${output}'\n`;

  try {
    await writeFile(executable, body, 'utf8');
    if (!windows) await chmod(executable, 0o755);
    const result = spawnSync(process.execPath, [installer, 'install'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cliEnv({}, `${directory}${delimiter}${process.env.PATH || ''}`),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      (await readFile(output, 'utf8')).trim(),
      'plugin --profile web add -w --save-exact github:MrmoLabs/dsh-mermaid',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Desktop install and uninstall success messages follow the selected language', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mermaid-desktop-'));
  const windows = process.platform === 'win32';
  const executable = join(directory, windows ? 'dsh.cmd' : 'dsh');
  const body = windows ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n';

  try {
    await writeFile(executable, body, 'utf8');
    if (!windows) await chmod(executable, 0o755);
    for (const [language, command, expected] of [
      ['en', 'install', 'Restart DSH Desktop'],
      ['zh-CN', 'install', '请重启 DSH Desktop'],
      ['en', 'uninstall', 'Restart DSH Desktop'],
      ['zh-CN', 'uninstall', '请重启 DSH Desktop'],
    ]) {
      const result = spawnSync(process.execPath, [installer, command, '--profile', 'desktop'], {
        encoding: 'utf8',
        env: cliEnv({ DSH_MERMAID_LANG: language }, `${directory}${delimiter}${process.env.PATH || ''}`),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(expected), result.stdout);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
