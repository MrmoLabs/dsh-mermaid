import mermaid from 'mermaid';
import zenuml from '@mermaid-js/mermaid-zenuml';
import { diagramBodyOffset } from './detection.js';
export { createTooltipPositioner } from './tooltip.js';
export { preserveViewPosition } from './scroll.js';
export { createFullscreenViewer } from './viewer.js';
export { createInlinePreview } from './inline-preview.js';
export { rasterizeSvg } from './png-export.js';
export { supersedeRender } from './render-scheduling.js';
export { applyDiagramPalette, ensureSvgAccessibility, hasSvgContent, localizeGeneratedSvgTitle, prepareSvgPreview, serializeSvg } from './svg.js';

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/;
// Recognize label positions without treating comments, metadata or existing
// strings as node definitions.
const FLOWCHART_TOKEN = /"[^"]*"|%%[^\r\n]*|@\{(?:[^"{}]|"[^"]*")*\}|\bsubgraph\b[^\r\n]*|(?:-->|---|==>|-\.->)[ \t]*(\|)|(?<=[\w\p{L}-])(\(\(\(|\(\(|\(\[|\[\[|\{\{|\(|\[|\{)/gu;
const LABEL_CLOSE = { '|': '|', '(((': ')))', '((': '))', '([': '])', '[[': ']]', '{{': '}}', '(': ')', '[': ']', '{': '}' };

function readLabel(source, start, open) {
  const close = LABEL_CLOSE[open];
  let parentheses = 0;
  let quoted = false;
  for (let i = start; i < source.length; i++) {
    const character = source[i];
    if (character === '"') quoted = !quoted;
    if (/[\r\n]/.test(character) && (open !== '[' || quoted)) return null;
    if (quoted) continue;
    if (parentheses === 0 && source.startsWith(close, i)) return { end: i, close };
    if (character === '(') parentheses++;
    else if (character === ')') {
      if (!parentheses) return null;
      parentheses--;
    } else if ('[]{}|'.includes(character)) return null;
  }
  return null;
}

function sourceLine(source, parserLine) {
  const original = source.replace(/\r\n?/g, '\n');
  let text = original;
  const offsets = Array.from({ length: original.length + 1 }, (_, i) => i);
  // Track original offsets through the pinned engine's preprocessing stages,
  // which remove frontmatter, directives, comments and leading whitespace.
  const patterns = [
    /^([^\S\n]*)---\s*\n(.*?)\n\1---\s*\n+/gs,
    /%%\{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%%)[\s\S])*))?\s*(?:}%%)?/gi,
    /^\s*%%(?!\{)[^\n]+\n?/gm,
    /^\s+/g,
  ];
  for (const pattern of patterns) {
    for (const match of [...text.matchAll(pattern)].reverse()) offsets.splice(match.index, match[0].length);
    text = text.replace(pattern, '');
  }
  let start = 0;
  for (let line = 1; line < parserLine; line++) {
    start = text.indexOf('\n', start) + 1;
    if (!start) return undefined;
  }
  return original.slice(0, offsets[start]).split('\n').length;
}

await mermaid.registerExternalDiagrams([zenuml], { lazyLoad: true });

class MermaidSourceError extends Error {
  constructor(error, source, originalError = error) {
    super(error?.message || String(error), { cause: error });
    this.hash = originalError?.hash;
    const hash = error?.hash;
    const parserError = error?.result?.parserErrors?.[0] ?? error?.result?.lexerErrors?.[0];
    const token = hash?.token ?? parserError?.token?.tokenType?.name;
    this.incomplete = token === 'EOF' || token === 1;
    this.reason = this.incomplete ? 'syntaxIncomplete'
      : token === 'STR' ? 'syntaxQuote' : token === 'PS' && hash?.text === '(' ? 'syntaxParenthesis' : 'syntaxInvalid';
    // Mermaid appends a synthetic newline before parsing. At EOF the last
    // real token locates the unfinished statement on the user's source line.
    const line = !this.incomplete && Number.isSafeInteger(hash?.line) ? hash.line + 1
      : parserError?.token?.startLine ?? parserError?.line ?? hash?.loc?.first_line
        ?? Number(this.message.match(/\bparse error on line (\d+)\b/i)?.[1]);
    if (error?.name === 'YAMLException' && Number.isSafeInteger(error.mark?.line)) this.line = error.mark.line + 2;
    else if (Number.isSafeInteger(line) && line > 0) this.line = sourceLine(source, line);
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
  const tokens = new RegExp(FLOWCHART_TOKEN);
  let output = '';
  let cursor = 0;
  for (let match; (match = tokens.exec(source));) {
    const open = match[1] ?? match[2];
    if (!open) continue;
    const start = tokens.lastIndex;
    const boundary = readLabel(source, start, open);
    if (!boundary) continue;
    tokens.lastIndex = boundary.end + boundary.close.length;
    const label = source.slice(start, boundary.end);
    if (/^\s*"|%%|[`[\]{}|\\]/.test(label) || /[<>]/.test(label.replace(/<br[ \t]*\/?>/gi, ''))) continue;
    if (open === '[' && /^[ \t]*[(/]/.test(label)) continue;
    const quoteOnly = token === 'STR';
    if (quoteOnly ? !label.includes('"') : !label.includes('(') || /[\r\n]/.test(label)) continue;
    const escaped = label.replaceAll('"', '#quot;');
    // Preserve the line breaks of legacy multiline rectangle labels.
    output += source.slice(cursor, start) + (quoteOnly && open === '[' ? escaped : '"' + escaped + '"');
    cursor = boundary.end;
  }
  return output + source.slice(cursor);
}

function recoverFlowchartSource(source, error) {
  const hash = error?.hash;
  const parentheses = hash?.token === 'PS' && hash.text === '(';
  const embeddedQuotes = hash?.token === 'STR';
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

async function renderMermaid(id, source, signal, streaming = false) {
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
      // Incomplete drafts get another render when they advance or finish.
      // The live path uses the engine's own parse pass and skips repairs.
      if (streaming) throw error;
      const token = error?.hash?.token;
      const normalized = !applied.has(token) && recoverFlowchartSource(input, error);
      if (normalized) {
        firstError ||= error;
        applied.add(token);
        input = normalized;
        continue;
      }
      if (await isSourceFailure(error, input)) throw new MermaidSourceError(error, input, firstError);
      throw error;
    }
  }
}

export { isMermaidSourceError, renderMermaid };
export default mermaid;
