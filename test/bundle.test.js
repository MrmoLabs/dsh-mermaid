import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

test('browser bundle registers dsh-mermaid with ModuleLoader', async () => {
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const bundle = await readFile('lib/client.js', 'utf8');
  const runtime = await readFile('lib/mermaid-runtime.js');
  const runtimeRevision = createHash('sha256').update(runtime).digest('hex').slice(0, 12);
  assert.ok(bundle.length < 20_000, `client bootstrap unexpectedly grew to ${bundle.length} bytes`);
  assert.ok(runtime.length > 1_000_000, 'the separately bundled Mermaid runtime is missing');
  assert.match(bundle, /\/dsh-mermaid\/mermaid-runtime\.js\?rev=/);
  assert.ok(bundle.includes(runtimeRevision), 'client bootstrap has a stale runtime revision');

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
