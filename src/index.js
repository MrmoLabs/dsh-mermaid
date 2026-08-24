import { readFile } from 'node:fs/promises';

const inject = ['webServer'];
const RUNTIME_PATH = '/dsh-mermaid/mermaid-runtime.js';
const runtimeFile = new URL('./mermaid-runtime.js', import.meta.url);

function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RUNTIME_PATH,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      try {
        const body = await readFile(runtimeFile);
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'public, max-age=31536000, immutable',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    },
  }), 'dsh-mermaid: runtime route');
}

export { RUNTIME_PATH, apply, inject };
