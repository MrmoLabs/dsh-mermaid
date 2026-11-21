import { effectiveStyle, initializeMermaid, styleKey } from './render-config.js';
import { runtimeUrl } from './runtime-url.js';

const PREVIEW_DELAY = 200;
const PREVIEW_TIMEOUT = 12_000;
const THEME_ATTRIBUTE = 'data-ds-dark-theme';

let previewQueue = Promise.resolve();
let previewAttempt = 0;
let previewId = 0;

function renderExample(config, source, cancelled) {
  const result = previewQueue.then(async () => {
    if (cancelled.aborted) return;
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Mermaid settings preview timed out'));
      }, PREVIEW_TIMEOUT);
    });
    const render = async () => {
      const runtime = await import(runtimeUrl(`preview-${previewAttempt}`));
      controller.signal.throwIfAborted();
      if (cancelled.aborted) return;
      initializeMermaid(runtime.default, JSON.parse(config));
      return runtime.renderMermaid(`dsh-mmd-settings-example-${++previewId}`, source, controller.signal);
    };
    try {
      return await Promise.race([render(), deadline]);
    } catch (error) {
      previewAttempt++;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
  previewQueue = result.catch(() => {});
  return result;
}

const PREVIEW_CSS = `
.dsh-mmd-settings-intro {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
  align-items: start;
  gap: 16px;
  margin-bottom: 16px;
}
.dsh-mmd-settings-preview { min-width: 0; }
.dsh-mmd-settings-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.dsh-mmd-settings-preview h4 { margin: 0; font-size: 14px; font-weight: 600; }
.dsh-mmd-settings-preview-modes { display: flex; gap: 6px; }
.dsh-mmd-settings-preview-modes button[aria-pressed=true] {
  outline: 2px solid var(--dsw-alias-button-primary-fill, #4c6ef5);
  outline-offset: 1px;
}
.dsh-mmd-settings-preview-canvas {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  box-sizing: border-box;
  min-height: 152px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1, #888);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.dsh-mmd-settings-preview-canvas > svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: 140px;
}
.dsh-mmd-settings .dsh-mmd-settings-preview > p { margin: 6px 0 0; }
`;

function createSettingsPreview(React, Button) {
  const h = React.createElement;
  const readHostDark = () => document.body.hasAttribute(THEME_ATTRIBUTE);
  return function SettingsPreview({ draftStyle, canCompare, mode, setMode, t }) {
    const [hostDark, setHostDark] = React.useState(readHostDark);
    const [status, setStatus] = React.useState('loading');
    const [retry, setRetry] = React.useState(0);
    const canvas = React.useRef(null);
    const dark = mode === null ? hostDark : mode === 'dark';
    const config = draftStyle && styleKey(effectiveStyle(draftStyle, dark));
    const source = t('previewSource');
    const description = t('previewDiagram');
    const title = React.useId();

    React.useEffect(() => {
      const observer = new MutationObserver(() => setHostDark(readHostDark()));
      observer.observe(document.body, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
      setHostDark(readHostDark());
      return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
      if (!config) return;
      const target = canvas.current;
      const controller = new AbortController();
      const timer = setTimeout(async () => {
        setStatus('loading');
        try {
          const result = await renderExample(config, source, controller.signal);
          if (controller.signal.aborted) return;
          const markup = document.createElement('template');
          markup.innerHTML = result.svg;
          const svg = markup.content.querySelector('svg');
          if (!svg) throw new Error('Missing Mermaid settings preview SVG');
          svg.setAttribute('role', 'img');
          svg.removeAttribute('aria-labelledby');
          svg.setAttribute('aria-label', description);
          target.replaceChildren(svg);
          target.style.backgroundColor = result.background;
          setStatus('ready');
        } catch {
          if (!controller.signal.aborted) setStatus('failed');
        }
      }, PREVIEW_DELAY);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }, [config, description, retry, source]);

    const button = (key, onClick, props = {}) => h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick, ...props }, t(key));
    const message = !config ? t('previewInvalid') : status === 'loading' ? t('previewLoading') : status === 'failed' ? t('previewFailed') : '';
    return h('section', { className: 'dsh-mmd-settings-preview', 'aria-labelledby': title },
      h('header', null, h('h4', { id: title }, t('previewTitle')),
        canCompare ? h('div', { className: 'dsh-mmd-settings-preview-modes', role: 'group', 'aria-label': t('previewMode') },
          button('light', () => setMode('light'), { 'aria-pressed': !dark }),
          button('dark', () => setMode('dark'), { 'aria-pressed': dark })) : null),
      h('div', { className: 'dsh-mmd-settings-preview-canvas', ref: canvas, 'aria-busy': Boolean(config) && status === 'loading' }),
      h('p', { role: 'status', hidden: !message }, message),
      config && status === 'failed' ? button('previewRetry', () => setRetry((count) => count + 1)) : null);
  };
}

export { PREVIEW_CSS, createSettingsPreview };
