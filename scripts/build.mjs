import { build } from 'esbuild';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS } from '../src/styles.js';

await mkdir('lib', { recursive: true });
await writeFile('lib/card.css', CSS);
const styleRevision = createHash('sha256').update(CSS).digest('hex').slice(0, 12);

const runtimeBuild = await build({
  entryPoints: ['src/mermaid-runtime.js'],
  outdir: 'lib',
  bundle: true,
  splitting: true,
  chunkNames: 'mermaid-chunks/[name]-[hash]',
  metafile: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  legalComments: 'external',
  // Source builds also run inside pnpm profiles where dependency overrides are root-only.
  alias: { katex: fileURLToPath(import.meta.resolve('katex')) },
});

const runtimeOutputs = Object.keys(runtimeBuild.metafile.outputs)
  .map((path) => relative(resolve('lib'), resolve(path)).replaceAll('\\', '/'));
const runtimeFiles = runtimeOutputs.filter((path) => path.endsWith('.js'));
for (const file of await readdir('lib/mermaid-chunks')) {
  const path = `mermaid-chunks/${file}`;
  if (/^[\w-]+-[A-Z0-9]{8}\.js(?:\.LEGAL\.txt)?$/.test(file) && !runtimeOutputs.includes(path)) {
    await unlink(`lib/${path}`);
  }
}
if (!runtimeOutputs.includes('mermaid-runtime.js.LEGAL.txt')) {
  await unlink('lib/mermaid-runtime.js.LEGAL.txt').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
const runtimeBundle = await readFile('lib/mermaid-runtime.js');
const runtimeRevision = createHash('sha256').update(runtimeBundle).digest('hex').slice(0, 12);
const mermaidVersion = JSON.parse(await readFile('node_modules/mermaid/package.json', 'utf8')).version;

await build({
  entryPoints: ['src/settings-runtime.js'], outfile: 'lib/settings-runtime.js',
  bundle: true, minify: true, platform: 'browser', format: 'esm', target: ['chrome120'],
  define: { __DSH_MERMAID_RUNTIME_REV__: JSON.stringify(runtimeRevision) },
});
const settingsRevision = createHash('sha256').update(await readFile('lib/settings-runtime.js')).digest('hex').slice(0, 12);

await build({
  stdin: {
    contents: "export { apply, inject } from './src/client.js';",
    resolveDir: process.cwd(),
    sourcefile: 'client-entry.js',
  },
  outfile: 'lib/client.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'cjs',
  target: ['chrome120'],
  legalComments: 'external',
  define: {
    __DSH_MERMAID_RUNTIME_REV__: JSON.stringify(runtimeRevision),
    __DSH_MERMAID_VERSION__: JSON.stringify(mermaidVersion),
    __DSH_MERMAID_SETTINGS_REV__: JSON.stringify(settingsRevision),
    __DSH_MERMAID_STYLE_REV__: JSON.stringify(styleRevision),
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

await build({
  entryPoints: ['src/index.js'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  define: {
    __DSH_MERMAID_RUNTIME_REV__: JSON.stringify(runtimeRevision),
    __DSH_MERMAID_RUNTIME_FILES__: JSON.stringify(runtimeFiles),
  },
});
