const RUNTIME_PREFIX = '/dsh-mermaid/runtime';
const RUNTIME_FILE = 'mermaid-runtime.js';
const RUNTIME_REVISION = typeof __DSH_MERMAID_RUNTIME_REV__ === 'undefined'
  ? 'development'
  : __DSH_MERMAID_RUNTIME_REV__;

function runtimeUrl(attempt = 0) {
  return `${RUNTIME_PREFIX}/${RUNTIME_REVISION}/${attempt}/${RUNTIME_FILE}`;
}

export { RUNTIME_FILE, RUNTIME_PREFIX, RUNTIME_REVISION, runtimeUrl };
