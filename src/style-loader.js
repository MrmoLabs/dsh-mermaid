import { DEFAULT_STYLE, DIAGNOSTIC_CODES, deepFreeze, isPlainObject, normalizeRenderConfig } from './render-config.js';

const CONFIG_URL = '/dsh-mermaid/config.json';
const MAX_RESPONSE_BYTES = 131072;

function validateProtocol(value) {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !['ready', 'fallback'].includes(value.status)) throw new Error('protocol');
  if (!Object.hasOwn(value, 'style') || !Array.isArray(value.diagnostics) || value.diagnostics.length > 20) throw new Error('protocol');
  if (!isPlainObject(value.style) || !['theme', 'look', 'themeVariables'].every((key) => Object.hasOwn(value.style, key))
    || !isPlainObject(value.style.themeVariables) || !['common', 'light', 'dark'].every((key) => Object.hasOwn(value.style.themeVariables, key))) throw new Error('protocol');
  const normalized = normalizeRenderConfig(value.style);
  if (normalized.status !== 'ready') throw new Error('protocol');
  const diagnostics = value.diagnostics.map((item) => {
    if (!isPlainObject(item) || !DIAGNOSTIC_CODES.has(item.code) || typeof item.path !== 'string' || item.path.length > 160
      || (item.path && !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(item.path))
      || item.path.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('protocol');
    return { code: item.code, path: item.path };
  });
  if (value.status === 'ready' && diagnostics.length) throw new Error('protocol');
  if (value.status === 'fallback' && (!diagnostics.length || JSON.stringify(normalized.style) !== JSON.stringify(DEFAULT_STYLE))) throw new Error('protocol');
  return deepFreeze({ ...normalized, status: value.status, diagnostics, warning: value.status === 'fallback' ? 'configInvalid' : null });
}

// One loader per mount, one lazy request; errors settle to a permanent snapshot.
function createStyleLoader({ fetch: fetcher = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  let promise;
  let disposed = false;
  let rejectAbort;
  const fallback = deepFreeze({ ...normalizeRenderConfig(), status: 'fallback', warning: 'configReadFailed' });
  function load() {
    if (promise) return promise;
    if (disposed) return Promise.resolve(fallback);
    promise = (async () => {
      let reader;
      let timer;
      const stop = new Promise((_, reject) => {
        rejectAbort = reject;
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      });
      const request = (async () => {
        const response = await fetcher(CONFIG_URL, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
        if (controller.signal.aborted) throw new Error('aborted');
        if (!response.ok || !/application\/json\b/i.test(response.headers.get('content-type') || '')) throw new Error('http');
        if (!response.body?.getReader) throw new Error('stream');
        reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new Error('aborted');
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new Error('size');
          chunks.push(value);
        }
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        return validateProtocol(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
      })();
      try { return await Promise.race([request, stop]); }
      catch { controller.abort(); void reader?.cancel().catch(() => {}); return fallback; }
      finally { clearTimeout(timer); rejectAbort = null; }
    })();
    return promise;
  }
  function dispose() {
    disposed = true;
    controller.abort();
    rejectAbort?.(new Error('disposed'));
  }
  return { load, dispose };
}

export { CONFIG_URL, MAX_RESPONSE_BYTES, createStyleLoader, validateProtocol };
