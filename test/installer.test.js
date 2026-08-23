import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
    const result = spawnSync(process.execPath, [resolve('bin/dsh-mermaid.mjs'), 'install'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH || ''}` },
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
