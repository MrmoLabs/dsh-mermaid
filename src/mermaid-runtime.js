import mermaid from 'mermaid';
import zenuml from '@mermaid-js/mermaid-zenuml';
import { diagramBodyOffset, diagramType } from './detection.js';
import { flowchartQuoteMarker, normalizeFlowchartLabels, restoreFlowchartQuotes } from './flowchart-labels.js';
export { createTooltipPositioner } from './tooltip.js';
export { preserveViewPosition } from './scroll.js';
export { createFullscreenViewer } from './viewer.js';
export { createInlinePreview } from './inline-preview.js';
export { rasterizeSvg } from './png-export.js';
export { supersedeRender } from './render-scheduling.js';
export { applyDiagramPalette, ensureSvgAccessibility, hasFiniteSvgGeometry, hasSvgContent, localizeGeneratedSvgTitle, prepareSvgPreview, serializeSvg } from './svg.js';

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/;

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

function semanticErrorLine(source, message) {
  const type = diagramType(source);
  const range = (type === 'packet' || type === 'packet-beta') &&
    /^Packet block (\d+) - (\d+) is (?:invalid|not contiguous)\b/.exec(message);
  const root = type === 'mindmap' &&
    /^There can be only one root\. No parent could be found for \("(.*)"\)$/.exec(message);
  if (!range && !root) return undefined;

  const offset = diagramBodyOffset(source);
  const firstLine = source.slice(0, offset).split(/\r\n?|\n/).length;
  const lines = source.slice(offset).split(/\r\n?|\n/);
  let match;
  for (const [index, line] of lines.entries()) {
    const field = range && /^\s*(\d+)\s*-\s*(\d+)\s*:/.exec(line);
    const matches = range
      ? field && Number(field[1]) === Number(range[1]) && Number(field[2]) === Number(range[2])
      : line.trim() === root[1];
    if (!matches) continue;
    // The engine provides no location for these errors. Only report a line
    // when the offending range or node text identifies a single statement.
    if (match !== undefined) return undefined;
    match = firstLine + index;
  }
  return match;
}

await mermaid.registerExternalDiagrams([zenuml], { lazyLoad: true });

class MermaidSourceError extends Error {
  constructor(error, source, originalError = error) {
    super(error?.message || String(error), { cause: error });
    this.hash = originalError?.hash;
    const hash = error?.hash;
    const parserError = error?.result?.parserErrors?.[0] ?? error?.result?.lexerErrors?.[0];
    const token = hash?.token ?? parserError?.token?.tokenType?.name;
    this.incomplete = token === 'EOF' || token === 'EOF_IN_STRUCT' || token === 1;
    this.reason = this.incomplete ? 'syntaxIncomplete'
      : token === 'STR' ? 'syntaxQuote' : token === 'PS' && hash?.text === '(' ? 'syntaxParenthesis' : 'syntaxInvalid';
    // Mermaid appends a synthetic newline before parsing. At EOF the last
    // real token locates the unfinished statement on the user's source line.
    if (error?.name === 'YAMLException' && Number.isSafeInteger(error.mark?.line)) this.line = error.mark.line + 2;
    else {
      // Jison's hash.line is not consistently zero-based across diagram
      // parsers. Prefer the reported line or one-based token locations.
      const reported = Number(this.message.match(/^(?:parse|lexical) error on line (\d+)\b/i)?.[1]);
      const candidates = this.incomplete
        ? [hash?.loc?.first_line, reported, hash?.line]
        : [parserError?.token?.startLine, parserError?.line, reported, hash?.loc?.first_line];
      for (const line of candidates) {
        if (!Number.isSafeInteger(line) || line < 1) continue;
        this.line = sourceLine(source, line);
        if (this.line) break;
      }
      this.line ??= semanticErrorLine(source, this.message);
    }
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

async function isMissingXySeries(error, source) {
  if (error?.name !== 'TypeError' || !['xychart', 'xychart-beta'].includes(diagramType(source))) return false;
  try {
    // Mermaid 11.17 reads plots[0].data before its own empty-series check.
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    return diagram.type === 'xychart' && diagram.db.getXYChartData?.()?.plots?.length === 0;
  } catch {
    return false;
  }
}

function recoverFlowchartSource(source, error, originalSource) {
  const hash = error?.hash;
  const parentheses = hash?.token === 'PS' && hash.text === '(';
  if (!parentheses && !['STR', 'PE', 'CYLINDEREND'].includes(hash?.token)) return null;
  const offset = diagramBodyOffset(source);
  if (offset < 0) return null;
  const body = source.slice(offset);
  if (!FLOWCHART_HEADER.test(body)) return null;

  // Pure SVG labels render Mermaid's quote entity as literal text. Use a
  // marker only in that mode, then restore the generated label text.
  const config = mermaid.mermaidAPI.getConfig();
  const marker = config.htmlLabels === false ? flowchartQuoteMarker(originalSource) : null;
  // The retry only affects rendering. The caller keeps the original source.
  const normalizedBody = normalizeFlowchartLabels(body, hash.token, marker ?? '#quot;');
  if (normalizedBody === body) return null;
  const normalized = source.slice(0, offset) + normalizedBody;
  return normalized.length <= config.maxTextSize ? { source: normalized, marker } : null;
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
  let quoteMarker;
  const gantt = source.includes('gantt') && diagramType(source) === 'gantt';
  const applied = new Set();
  while (true) {
    try {
      if (gantt) {
        const { ganttTaskLine, invalidGanttTaskEnd } = await import('./gantt-validation.js');
        signal?.throwIfAborted();
        const { db } = await mermaid.mermaidAPI.getDiagramFromText(input);
        const invalidTask = invalidGanttTaskEnd(db);
        if (invalidTask) {
          const error = new MermaidSourceError(new Error('Invalid Gantt task end date or duration.'), input);
          error.reason = 'syntaxGanttEnd';
          error.line = ganttTaskLine(input, invalidTask);
          throw error;
        }
      }
      const result = await renderInContainer(id, input, signal);
      const { theme, themeVariables } = mermaid.mermaidAPI.getConfig();
      const dark = theme === 'dark' || (theme === 'base' && themeVariables?.darkMode === true);
      return { ...result, svg: restoreFlowchartQuotes(result.svg, quoteMarker), background: dark ? '#000' : '#fff' };
    } catch (error) {
      signal?.throwIfAborted();
      if (isMermaidSourceError(error)) throw error;
      // Incomplete drafts get another render when they advance or finish.
      // The live path uses the engine's own parse pass and skips repairs.
      if (streaming) throw error;
      const token = error?.hash?.token;
      const recovery = !applied.has(token) && recoverFlowchartSource(input, error, source);
      if (recovery) {
        firstError ||= error;
        applied.add(token);
        input = recovery.source;
        quoteMarker ||= recovery.marker;
        continue;
      }
      if (await isMissingXySeries(error, input)) {
        const missingSeries = new MermaidSourceError(error, input, firstError);
        missingSeries.reason = 'syntaxMissingSeries';
        throw missingSeries;
      }
      if (await isSourceFailure(error, input)) throw new MermaidSourceError(error, input, firstError);
      throw error;
    }
  }
}

export { isMermaidSourceError, renderMermaid };
export default mermaid;
