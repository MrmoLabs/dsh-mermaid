import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';

await mkdir('lib', { recursive: true });

await build({
  entryPoints: ['src/client.js'],
  outfile: 'lib/client.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'cjs',
  target: ['chrome120'],
  legalComments: 'external',
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
