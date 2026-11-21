import { readFile } from 'node:fs/promises';
import { normalizeRenderConfig } from './render-config.js';
import z from '@deepseek-ai/schemastery';
import { isVolatile } from '@deepseek-ai/cosmokit';
import { RUNTIME_FILE, RUNTIME_PREFIX, RUNTIME_REVISION, runtimeUrl } from './runtime-url.js';

const inject = ['webServer'];
const RUNTIME_PATH = '/dsh-mermaid/mermaid-runtime.js';
const CONFIG_PATH = '/dsh-mermaid/config.json';
const SETTINGS_PATH = '/dsh-mermaid/settings-runtime.js';
const STYLE_PATH = '/dsh-mermaid/card.css';
const runtimeFiles = new Set(typeof __DSH_MERMAID_RUNTIME_FILES__ === 'undefined' ? [RUNTIME_FILE] : __DSH_MERMAID_RUNTIME_FILES__);
const settingsFile = new URL('./settings-runtime.js', import.meta.url);
const styleFile = new URL('./card.css', import.meta.url);
const activeServers = new WeakSet();
// The host owns this opaque JSON reference. The editor validates complete drafts
// with the shared validator; direct file edits retain the existing fallback policy.
const Config = z.any().volatile();

async function serveAsset(req, res, read, mediaType = 'text/javascript', cache = 'public, max-age=31536000, immutable') {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  try {
    const body = await read();
    res.writeHead(200, { 'content-type': `${mediaType}; charset=utf-8`, 'cache-control': cache });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

function registerAsset(server, path, file, mediaType) {
  return server.register({ kind: 'exact', path, handler: (req, res) => serveAsset(req, res, () => readFile(file), mediaType) });
}

function serveRuntime(req, res) {
  const prefix = `${RUNTIME_PREFIX}/${RUNTIME_REVISION}/`;
  const path = req.url?.split('?', 1)[0];
  // Attempts have independent imports. The settings preview also has its own
  // Mermaid instance, so an unsaved theme cannot reach conversation renders.
  const file = path?.startsWith(prefix) && /^(?:preview-)?\d+\/(.+)$/.exec(path.slice(prefix.length))?.[1];
  if (!runtimeFiles.has(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  return serveAsset(req, res, () => readFile(new URL(`./${file}`, import.meta.url)));
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
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: RUNTIME_PREFIX, handler: serveRuntime }), 'dsh-mermaid: runtime assets route');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: RUNTIME_PATH,
    handler: (req, res) => serveAsset(req, res, () => `export * from '${runtimeUrl()}';export {default} from '${runtimeUrl()}';`, 'text/javascript', 'no-cache'),
  }), 'dsh-mermaid: runtime entry route');
  ctx.effect(() => registerAsset(ctx.webServer, SETTINGS_PATH, settingsFile), 'dsh-mermaid: settings runtime route');
  ctx.effect(() => registerAsset(ctx.webServer, STYLE_PATH, styleFile, 'text/css'), 'dsh-mermaid: card styles route');
}

export { Config, CONFIG_PATH, RUNTIME_PATH, RUNTIME_PREFIX, SETTINGS_PATH, STYLE_PATH, apply, inject, runtimeUrl };
