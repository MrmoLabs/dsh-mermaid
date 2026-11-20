import { readFile } from 'node:fs/promises';
import { normalizeRenderConfig } from './render-config.js';
import z from '@deepseek-ai/schemastery';
import { isVolatile } from '@deepseek-ai/cosmokit';

const inject = ['webServer'];
const RUNTIME_PATH = '/dsh-mermaid/mermaid-runtime.js';
const CONFIG_PATH = '/dsh-mermaid/config.json';
const SETTINGS_PATH = '/dsh-mermaid/settings-runtime.js';
const STYLE_PATH = '/dsh-mermaid/card.css';
const runtimeFile = new URL('./mermaid-runtime.js', import.meta.url);
const settingsFile = new URL('./settings-runtime.js', import.meta.url);
const styleFile = new URL('./card.css', import.meta.url);
const activeServers = new WeakSet();
// The host owns this opaque JSON reference. The editor validates complete drafts
// with the shared validator; direct file edits retain the existing fallback policy.
const Config = z.any().volatile();

function registerAsset(server, path, file, mediaType = 'text/javascript') {
  return server.register({
    kind: 'exact', path,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': `${mediaType}; charset=utf-8`, 'cache-control': 'public, max-age=31536000, immutable' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    },
  });
}

function apply(ctx, config) {
  const initial = isVolatile(config) ? null : normalizeRenderConfig(config);
  const readProtocol = initial ? () => initial : () => normalizeRenderConfig(config.get());
  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (child) => {
      if (typeof child.settings.configure === 'function') {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-mermaid: settings presentation');
      }
    });
  }
  ctx.effect(() => {
    const server = ctx.webServer;
    if (activeServers.has(server)) throw new Error('dsh-mermaid: duplicate instance');
    activeServers.add(server);
    let unregister;
    try {
      unregister = server.register({
        kind: 'exact', path: CONFIG_PATH,
        handler(req, res) {
          const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { ...headers, allow: 'GET, HEAD' });
            res.end();
            return;
          }
          try {
            const body = JSON.stringify(readProtocol());
            res.writeHead(200, headers);
            res.end(req.method === 'HEAD' ? undefined : body);
          } catch {
            res.writeHead(500, headers);
            res.end();
          }
        },
      });
    } catch (error) { activeServers.delete(server); throw error; }
    return () => { try { unregister?.(); } finally { activeServers.delete(server); } };
  }, 'dsh-mermaid: config route');
  ctx.effect(() => registerAsset(ctx.webServer, RUNTIME_PATH, runtimeFile), 'dsh-mermaid: runtime route');
  ctx.effect(() => registerAsset(ctx.webServer, SETTINGS_PATH, settingsFile), 'dsh-mermaid: settings runtime route');
  ctx.effect(() => registerAsset(ctx.webServer, STYLE_PATH, styleFile, 'text/css'), 'dsh-mermaid: card styles route');
}

export { Config, CONFIG_PATH, RUNTIME_PATH, SETTINGS_PATH, STYLE_PATH, apply, inject };
