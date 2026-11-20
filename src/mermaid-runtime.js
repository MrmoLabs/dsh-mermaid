import mermaid from 'mermaid';
import { diagramBodyOffset } from './detection.js';
export { createTooltipPositioner } from './tooltip.js';
export { preserveViewPosition } from './scroll.js';

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/;
// Skip existing strings, comments and node metadata. Capture simple edge and rectangle labels.
const FLOWCHART_TOKEN = /"[^"]*"|%%[^\r\n]*|@\{(?:[^"{}]|"[^"]*")*\}|(?:-->|---|==>|-\.->)[ \t]*\|((?:[^"|\r\n]|"[^"]*")*)\||(?<=[\w\p{L}-])\[((?:[^"[\]]|"[^"\r\n]*")*)\](?!\])/gu;
const PLAIN_PARENTHESIZED_LABEL = /^(?:[^()]*\([^()]*\))+[^()]*$/;

class MermaidSourceError extends Error {
  constructor(error) {
    super(error?.message || String(error), { cause: error });
    this.hash = error?.hash;
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
  return source.replace(FLOWCHART_TOKEN, (match, edgeLabel, nodeLabel) => {
    const label = edgeLabel ?? nodeLabel;
    if (!label || /[`[\]{}<>|;\\]/.test(label)) return match;
    // These prefixes also occur in non-rectangular node syntax.
    if (nodeLabel && /^\s*[(/]/.test(label)) return match;

    if (token === 'STR') {
      // A leading quote already delimits a Mermaid label. Escape only embedded pairs.
      if (!nodeLabel || /^\s*"/.test(label) || label.includes('%')) return match;
      return match.replaceAll('"', '#quot;');
    }
    if (/["\r\n]/.test(label) || !PLAIN_PARENTHESIZED_LABEL.test(label)) return match;
    return `${match.slice(0, -label.length - 1)}"${label}"${match.at(-1)}`;
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

async function renderMermaid(id, source) {
  try {
    return await mermaid.render(id, source);
  } catch (error) {
    const normalized = recoverFlowchartSource(source, error);
    if (normalized) {
      try {
        return await mermaid.render(id, normalized);
      } catch (retryError) {
        // Keep the original syntax diagnostic unless the repaired input failed to draw.
        if (!await isSourceFailure(retryError, normalized)) throw retryError;
      }
    }
    if (await isSourceFailure(error, source)) throw new MermaidSourceError(error);
    throw error;
  }
}

export { isMermaidSourceError, renderMermaid };
export default mermaid;
