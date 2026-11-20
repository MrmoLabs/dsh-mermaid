import mermaid from 'mermaid';
import zenuml from '@mermaid-js/mermaid-zenuml';
import { diagramBodyOffset } from './detection.js';
export { createTooltipPositioner } from './tooltip.js';
export { preserveViewPosition } from './scroll.js';
export { createFullscreenViewer } from './viewer.js';
export { createInlinePreview } from './inline-preview.js';
export { rasterizeSvg } from './png-export.js';

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/;
// Skip existing strings, comments and node metadata. Capture edge, rectangle and diamond labels.
const FLOWCHART_TOKEN = /"[^"]*"|%%[^\r\n]*|@\{(?:[^"{}]|"[^"]*")*\}|(?:-->|---|==>|-\.->)[ \t]*\|((?:[^"|\r\n]|"[^"]*")*)\||(?<=[\w\p{L}-])\[((?:[^"[\]]|"[^"\r\n]*")*)\](?!\])|(?<=[\w\p{L}-])\{((?:[^"{}\r\n]|"[^"\r\n]*")*)\}(?!\})/gu;
const PLAIN_PARENTHESIZED_LABEL = /^(?:[^()]*\([^()]*\))+[^()]*$/;

await mermaid.registerExternalDiagrams([zenuml], { lazyLoad: true });

class MermaidSourceError extends Error {
  constructor(error, diagnostic = error) {
    super(diagnostic?.message || String(diagnostic), { cause: error });
    this.hash = error?.hash;
    const hash = diagnostic?.hash;
    const parserError = diagnostic?.result?.parserErrors?.[0];
    const token = hash?.token ?? parserError?.token?.tokenType?.name;
    this.incomplete = token === 'EOF' || token === 1;
    this.reason = this.incomplete ? 'syntaxIncomplete'
      : token === 'STR' ? 'syntaxQuote' : token === 'PS' && hash?.text === '(' ? 'syntaxParenthesis' : 'syntaxInvalid';
    const line = hash?.loc?.first_line ?? parserError?.token?.startLine
      ?? Number(this.message.match(/\b(?:parse error on )?line (\d+)\b/i)?.[1]);
    if (Number.isSafeInteger(line) && line > 0) this.line = line;
  }
}

function isMermaidSourceError(error) {
  return error instanceof MermaidSourceError;
}

function isParserError(error) {
  return Boolean(error?.hash || error?.result?.lexerErrors?.length || error?.result?.parserErrors?.length)
    || error?.name === 'UnknownDiagramError' || error?.name === 'YAMLException';
}

async function isSourceFailure(error, source) {
  if (isParserError(error)) return true;
  if (error?.name !== 'Error') return false;
  try {
    await mermaid.parse(source);
  } catch (parseError) {
    // Some diagrams reject invalid values with a plain Error during parsing.
    return isParserError(parseError) || (parseError?.name === 'Error' && parseError.message === error.message);
  }
  return false;
}

function normalizeFlowchartLabels(source, token) {
  return source.replace(FLOWCHART_TOKEN, (match, edgeLabel, rectangleLabel, diamondLabel) => {
    const label = edgeLabel ?? rectangleLabel ?? diamondLabel;
    // Ignore plain line-break tags when checking the label, keeping the original markup.
    if (!label || /[`[\]{}<>|;\\]/.test(label.replace(/<br[ \t]*\/?>/gi, ''))) return match;
    // These prefixes also occur in non-rectangular node syntax.
    if (rectangleLabel && /^\s*[(/]/.test(label)) return match;

    if (token === 'STR') {
      // A leading quote already delimits a Mermaid label. Escape only embedded pairs.
      if (!rectangleLabel || /^\s*"/.test(label) || label.includes('%')) return match;
      return match.replaceAll('"', '#quot;');
    }
    if (/^\s*"/.test(label) || /[\r\n]/.test(label) || !PLAIN_PARENTHESIZED_LABEL.test(label)) return match;
    return `${match.slice(0, -label.length - 1)}"${label.replaceAll('"', '#quot;')}"${match.at(-1)}`;
  });
}

function recoverFlowchartSource(source, error) {
  const hash = error?.hash;
  const parentheses = hash?.token === 'PS' && hash.text === '(';
  const embeddedQuotes = hash?.token === 'STR' && hash.expected?.includes("'SQE'");
  if (!parentheses && !embeddedQuotes) return null;
  const offset = diagramBodyOffset(source);
  if (offset < 0) return null;
  const body = source.slice(offset);
  if (!FLOWCHART_HEADER.test(body)) return null;
  // The retry only affects rendering. The caller keeps the original source.
  const normalizedBody = normalizeFlowchartLabels(body, hash.token);
  if (normalizedBody === body) return null;
  const normalized = source.slice(0, offset) + normalizedBody;
  return normalized.length <= mermaid.mermaidAPI.getConfig().maxTextSize ? normalized : null;
}

async function renderInContainer(id, source, signal) {
  signal?.throwIfAborted();
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = 'position:absolute;inset:0 auto auto 0;width:100%;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.append(container);
  const cleanup = () => container.remove();
  signal?.addEventListener('abort', cleanup, { once: true });
  try {
    return await mermaid.render(id, source, container);
  } finally {
    signal?.removeEventListener('abort', cleanup);
    cleanup();
  }
}

async function renderMermaid(id, source, signal) {
  let input = source;
  let firstError;
  const applied = new Set();
  while (true) {
    try {
      const result = await renderInContainer(id, input, signal);
      const { theme, themeVariables } = mermaid.mermaidAPI.getConfig();
      const dark = theme === 'dark' || (theme === 'base' && themeVariables?.darkMode === true);
      return { ...result, background: dark ? '#000' : '#fff' };
    } catch (error) {
      signal?.throwIfAborted();
      const token = error?.hash?.token;
      const normalized = !applied.has(token) && recoverFlowchartSource(input, error);
      if (normalized) {
        firstError ||= error;
        applied.add(token);
        input = normalized;
        continue;
      }
      if (await isSourceFailure(error, input)) throw new MermaidSourceError(firstError || error, error);
      throw error;
    }
  }
}

export { isMermaidSourceError, renderMermaid };
export default mermaid;
