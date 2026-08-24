import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await mkdir('lib', { recursive: true });

await build({
  entryPoints: ['src/mermaid-runtime.js'],
  outfile: 'lib/mermaid-runtime.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  legalComments: 'external',
});

const runtimeBundle = await readFile('lib/mermaid-runtime.js');
const runtimeRevision = createHash('sha256').update(runtimeBundle).digest('hex').slice(0, 12);

await build({
  entryPoints: ['src/client.js'],
  outfile: 'lib/client.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'cjs',
  target: ['chrome120'],
  legalComments: 'external',
  define: {
    __DSH_MERMAID_RUNTIME_REV__: JSON.stringify(runtimeRevision),
  },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-mermaid",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: {
    js: 'return module.exports;}});',
  },
});

const clientBundle = await readFile('lib/client.js', 'utf8');
if (!clientBundle.startsWith('window.__ModuleLoader__.load({id:"dsh-mermaid",')) {
  throw new Error('The client bundle does not register the dsh-mermaid ModuleLoader ID.');
}

await copyFile('src/index.js', 'lib/index.js');
