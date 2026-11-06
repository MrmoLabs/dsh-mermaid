import mermaid from 'mermaid';
export { createTooltipPositioner } from './tooltip.js';
export { preserveViewPosition } from './scroll.js';

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/;
const FRONTMATTER = /^([ \t]*)---[ \t]*(?:\r\n?|\n)[\s\S]*?(?:\r\n?|\n)\1---[ \t]*(?=\r|\n)/;
const LEADING_COMMENTS = /^(?:\s*%%(?!\{)[^\r\n]*(?:\r\n?|\n))*/;
// Skip existing strings, comments and node metadata. Capture simple edge and rectangle labels.
const FLOWCHART_TOKEN = /"[^"]*"|%%[^\r\n]*|@\{(?:[^"{}]|"[^"]*")*\}|(?:-->|---|==>|-\.->)[ \t]*\|([^"|\r\n]*)\||(?<=[\w\p{L}-])\[([^"[\]\r\n]*)\]/gu;
const PLAIN_PARENTHESIZED_LABEL = /^(?:[^()]*\([^()]*\))+[^()]*$/;

function quoteFlowchartLabels(source) {
  return source.replace(FLOWCHART_TOKEN, (match, edgeLabel, nodeLabel) => {
    const label = edgeLabel ?? nodeLabel;
    if (!label || /["`[\]{}<>|;\\]/.test(label) || !PLAIN_PARENTHESIZED_LABEL.test(label)) return match;
    // These prefixes also occur in non-rectangular node syntax.
    if (nodeLabel && /^[ \t]*[(/]/.test(label)) return match;
    return `${match.slice(0, -label.length - 1)}"${label}"${match.at(-1)}`;
  });
}

async function renderMermaid(id, source) {
  try {
    return await mermaid.render(id, source);
  } catch (error) {
    if (error?.hash?.token !== 'PS' || error.hash.text !== '(') throw error;
    const body = source.replace(FRONTMATTER, '').replace(LEADING_COMMENTS, '').trimStart();
    if (!FLOWCHART_HEADER.test(body)) throw error;
    // Retry once with quoted labels. The caller keeps the original code for display and copying.
    const quotedBody = quoteFlowchartLabels(body);
    if (quotedBody === body) throw error;
    const prefix = source.slice(0, source.length - body.length);
    const normalized = prefix + quotedBody;
    if (normalized.length > mermaid.mermaidAPI.getConfig().maxTextSize) throw error;
    try {
      return await mermaid.render(id, normalized);
    } catch {
      throw error;
    }
  }
}

export { renderMermaid };
export default mermaid;
