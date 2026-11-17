import mermaid from 'mermaid';
import { diagramBodyOffset } from './detection.js';
export { createTooltipPositioner } from './tooltip.js';
export { preserveViewPosition } from './scroll.js';

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/;
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
    const offset = diagramBodyOffset(source);
    if (offset < 0) throw error;
    const body = source.slice(offset);
    if (!FLOWCHART_HEADER.test(body)) throw error;
    // Retry once with quoted labels. The caller keeps the original code for display and copying.
    const quotedBody = quoteFlowchartLabels(body);
    if (quotedBody === body) throw error;
    const prefix = source.slice(0, offset);
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
