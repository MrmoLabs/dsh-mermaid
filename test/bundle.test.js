import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

test('browser bundle registers dsh-mermaid with ModuleLoader', async () => {
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const bundle = await readFile('lib/client.js', 'utf8');
  let registration;
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value;
        },
      },
    },
  };

  vm.runInNewContext(bundle, context, { filename: 'lib/client.js' });
  assert.equal(registration?.id, 'dsh-mermaid');
  assert.equal(typeof registration?.factory, 'function');
});
