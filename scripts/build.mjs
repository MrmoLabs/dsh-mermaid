import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

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

await copyFile('src/index.js', 'lib/index.js');
