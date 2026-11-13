const LANG_RE = /^language-(?:mermaid|mermaidjs|mmd)$/i;
const DIAGRAM_TYPE_RE = /^\s*([A-Za-z][\w-]*)/;

const MERMAID_TYPES = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'journey', 'timeline',
  'mindmap', 'gitGraph', 'quadrantChart', 'requirementDiagram', 'c4Context',
  'c4Container', 'c4Component', 'c4Dynamic', 'c4Deployment', 'block',
  'packet', 'architecture-beta', 'sankey-beta', 'xychart-beta', 'zenuml',
]);

function diagramType(source) {
  let text = String(source || '').replace(/^\uFEFF/, '');
  if (/^---\s*\n/.test(text)) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) text = text.slice(end + 4);
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    const match = DIAGRAM_TYPE_RE.exec(trimmed);
    return match ? match[1] : '';
  }
  return '';
}

function hasMermaidLanguage(classNames) {
  return Array.from(classNames || []).some((name) => LANG_RE.test(name));
}

function hasExplicitLanguage(classNames) {
  return Array.from(classNames || []).some((name) => /^language-/i.test(name));
}

function isMermaidSource(source) {
  return MERMAID_TYPES.has(diagramType(source));
}

export { diagramType, hasExplicitLanguage, hasMermaidLanguage, isMermaidSource };
