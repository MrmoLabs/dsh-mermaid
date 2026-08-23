const LANG_RE = /^language-(?:mermaid|mermaidjs|mmd)$/i;
const DIAGRAM_TYPE_RE = /^\s*([A-Za-z][\w-]*)/;

const MERMAID_TYPES = new Set([
  'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'journey', 'timeline',
  'mindmap', 'gitGraph', 'quadrantChart', 'requirementDiagram', 'c4Context',
  'c4Container', 'c4Component', 'c4Dynamic', 'c4Deployment', 'block',
  'packet', 'architecture-beta', 'sankey-beta', 'xychart-beta', 'zenuml',
]);

function diagramType(source) {
  const match = DIAGRAM_TYPE_RE.exec(source);
  return match ? match[1] : '';
}

function hasMermaidLanguage(classNames) {
  return Array.from(classNames || []).some((name) => LANG_RE.test(name));
}

function isMermaidSource(source) {
  return MERMAID_TYPES.has(diagramType(source));
}

export { diagramType, hasMermaidLanguage, isMermaidSource };
