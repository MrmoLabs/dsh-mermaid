// Shared by the Node host and browser; deliberately independent of Mermaid and DOM.
const THEMES = ['auto', 'default', 'dark', 'neutral', 'forest', 'base'];
const LOOKS = ['classic', 'handDrawn'];
const GROUPS = ['common', 'light', 'dark'];
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const DIAGNOSTIC_CODES = new Set(['INVALID_CONFIG', 'UNKNOWN_FIELD', 'INVALID_THEME', 'INVALID_LOOK', 'INVALID_VARIABLES', 'INVALID_VALUE', 'UNSAFE_KEY', 'MAX_DEPTH', 'MAX_ITEMS', 'MAX_STRING', 'MAX_BYTES', 'TRUNCATED']);
const DEFAULT_STYLE = deepFreeze({ theme: 'auto', look: 'classic', themeVariables: { common: {}, light: {}, dark: {} } });

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function safePath(parent, key) {
  const path = parent ? `${parent}.${key}` : key;
  return !FORBIDDEN.has(key) && /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && path.length <= 160 ? path : parent;
}

function normalizeRenderConfig(input) {
  const diagnostics = [];
  let failed = false;
  let items = 0;
  let stopped = false;
  const ancestors = new Set();
  function fail(code, path) {
    failed = true;
    if (diagnostics.length < 20) diagnostics.push({ code, path });
    else diagnostics[19] = { code: 'TRUNCATED', path: '' };
  }
  function record(value, path) {
    if (!isPlainObject(value)) { fail('INVALID_VARIABLES', path); return false; }
    return true;
  }
  function fields(value, allowed, path) {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowed.includes(key)) fail(FORBIDDEN.has(key) ? 'UNSAFE_KEY' : 'UNKNOWN_FIELD', typeof key === 'string' ? safePath(path, key) : path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('INVALID_VALUE', path);
    }
  }
  function tree(value, depth, path) {
    if (stopped) return undefined;
    if (depth > 8) { fail('MAX_DEPTH', path); return undefined; }
    if (typeof value === 'string') {
      if (value.length > 8192) fail('MAX_STRING', path);
      return value;
    }
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value) ? Object.getPrototypeOf(value) !== Array.prototype : !isPlainObject(value)) { fail('INVALID_VALUE', path); return undefined; }
    if (ancestors.has(value)) { fail('INVALID_VALUE', path); return undefined; }
    ancestors.add(value);
    const result = Array.isArray(value) ? [] : {};
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (++items > 2048) { fail('MAX_ITEMS', path); stopped = true; break; }
      const childPath = typeof key === 'string' ? safePath(path, key) : path;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || FORBIDDEN.has(key)) { fail('UNSAFE_KEY', path); continue; }
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))) {
        fail('INVALID_VALUE', childPath); continue;
      }
      result[key] = tree(descriptor.value, depth + 1, childPath);
    }
    if (Array.isArray(value) && result.length !== value.length) fail('INVALID_VALUE', path);
    ancestors.delete(value);
    return result;
  }
  let style = { theme: 'auto', look: 'classic', themeVariables: { common: {}, light: {}, dark: {} } };
  try {
    if (input !== undefined) {
      if (!isPlainObject(input)) fail('INVALID_CONFIG', '');
      else {
        fields(input, ['theme', 'look', 'themeVariables'], '');
        // Never invoke accessors in a supplied configuration object.
        const data = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.value;
        if (Object.hasOwn(input, 'theme')) {
          if (!THEMES.includes(data(input, 'theme'))) fail('INVALID_THEME', 'theme');
          else style.theme = data(input, 'theme');
        }
        if (Object.hasOwn(input, 'look')) {
          if (!LOOKS.includes(data(input, 'look'))) fail('INVALID_LOOK', 'look');
          else style.look = data(input, 'look');
        }
        if (Object.hasOwn(input, 'themeVariables')) {
          const variables = data(input, 'themeVariables');
          if (record(variables, 'themeVariables')) {
            fields(variables, GROUPS, 'themeVariables');
            for (const group of GROUPS) {
              if (!Object.hasOwn(variables, group)) continue;
              const path = `themeVariables.${group}`;
              const value = data(variables, group);
              if (record(value, path)) style.themeVariables[group] = tree(value, 1, path);
            }
          }
        }
      }
    }
    if (!failed && new TextEncoder().encode(JSON.stringify(style)).byteLength > 65536) fail('MAX_BYTES', '');
  } catch {
    fail('INVALID_CONFIG', '');
  }
  if (failed) style = DEFAULT_STYLE;
  return deepFreeze({ schemaVersion: 1, status: failed ? 'fallback' : 'ready', style, diagnostics });
}

function mergeVariables(common, branch) {
  const result = {};
  for (const key of new Set([...Object.keys(common), ...Object.keys(branch)])) {
    const value = Object.hasOwn(branch, key) ? branch[key] : common[key];
    result[key] = isPlainObject(value)
      ? mergeVariables(isPlainObject(common[key]) ? common[key] : {}, value)
      : Array.isArray(value) ? value.map(cloneValue) : value;
  }
  return result;
}
function cloneValue(value) {
  return isPlainObject(value) ? mergeVariables({}, value) : Array.isArray(value) ? value.map(cloneValue) : value;
}
function effectiveStyle(style, dark) {
  const result = { theme: style.theme === 'auto' ? (dark ? 'dark' : 'default') : style.theme, look: style.look };
  if (style.theme === 'base') {
    result.themeVariables = mergeVariables(style.themeVariables.common, style.themeVariables[dark ? 'dark' : 'light']);
    // Mermaid's stock base fills are light, including when darkMode is enabled.
    if (!Object.hasOwn(result.themeVariables, 'darkMode')) {
      result.themeVariables.darkMode = dark && Object.keys(result.themeVariables).length > 0;
    }
  }
  return deepFreeze(result);
}
function styleKey(value) {
  if (Array.isArray(value)) return `[${value.map(styleKey).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${styleKey(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export { DEFAULT_STYLE, DIAGNOSTIC_CODES, deepFreeze, effectiveStyle, isPlainObject, mergeVariables, normalizeRenderConfig, styleKey };
