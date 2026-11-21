const LANG_RE = /^language-(?:mermaid|mermaidjs|mmd)$/i;
const DIAGRAM_TYPE_RE = /^\s*([A-Za-z][\w-]*)/;

const MERMAID_TYPES = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'journey', 'timeline',
  'mindmap', 'gitGraph', 'quadrantChart', 'requirementDiagram', 'c4Context',
  'c4Container', 'c4Component', 'c4Dynamic', 'c4Deployment', 'C4Context',
  'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
  'block', 'block-beta', 'packet', 'packet-beta', 'architecture-beta', 'sankey-beta', 'xychart-beta', 'zenuml',
  'kanban', 'radar-beta', 'treemap-beta', 'swimlane-beta', 'eventmodeling', 'treeView-beta',
  'ishikawa-beta', 'venn-beta', 'wardley-beta', 'cynefin-beta',
  'railroad-beta', 'railroad-ebnf-beta', 'railroad-abnf-beta', 'railroad-peg-beta',
]);

function diagramBodyOffset(source) {
  // Bounded lexical scan only: never inspect YAML values for diagram keywords.
  const text = String(source || '');
  if (text.length > 50_000) return -1;
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)];
  let index = 0;
  while (index < lines.length && !lines[index][0].trim()) index++;
  if (lines[index]?.[0].trim() === '---') {
    index++;
    while (index < lines.length && lines[index][0].trim() !== '---') index++;
    if (index === lines.length) return -1;
    index++;
  }
  for (; index < lines.length; index++) {
    const line = lines[index][0].trim();
    if (!line) continue;
    if (line.startsWith('%%{')) {
      while (!lines[index][0].includes('}%%') && ++index < lines.length) { /* Skip the complete directive. */ }
      if (index === lines.length) return -1;
      const closing = lines[index][0];
      const suffix = closing.slice(closing.indexOf('}%%') + 3).trimStart();
      if (suffix) return MERMAID_TYPES.has(DIAGRAM_TYPE_RE.exec(suffix)?.[1])
        ? lines[index].index + closing.length - suffix.length : -1;
      continue;
    }
    if (line.startsWith('%%')) continue;
    return lines[index].index + lines[index][0].search(/\S/);
  }
  return -1;
}

function diagramType(source) {
  const text = String(source || '');
  const offset = diagramBodyOffset(text);
  const match = offset < 0 ? null : DIAGRAM_TYPE_RE.exec(text.slice(offset));
  return match ? match[1] : '';
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

export { diagramBodyOffset, diagramType, hasExplicitLanguage, hasMermaidLanguage, isMermaidSource };
