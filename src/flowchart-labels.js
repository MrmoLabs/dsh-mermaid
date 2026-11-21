// Match label openers, skipping constructs in which brackets are not labels.
// Longer node delimiters and whole edge operators must win over single tokens.
const LABEL_TOKEN = new RegExp([
  /"[^"]*"|%%[^\r\n]*|@\{(?:[^"{}]|"[^"]*")*\}/.source,
  /(?<![^\r\n;])[ \t]*(?:classDef|style|linkStyle|click|accTitle|accDescr)\b[^;\r\n]*/.source,
  /(?:-{2,}[>xo]?|={2,}>|-\.+-[>xo]?|~{3,})(?:[ \t]*(\|))?/.source,
  /\bsubgraph[ \t]+[\w\p{L}-]+[ \t]+(\[)/.source,
  /(?<=[\w\p{L}-])(\(\(\(|\(\[|\(\(|\[\[|\[\(|\[\/|\[\\|\{\{|(?<!-)>|[([{])/.source,
].join('|'), 'gu');
const NODE_END = {
  '|': /^\|/, '(((': /^\)\)\)/, '((': /^\)\)/, '([': /^\]\)/,
  '[[': /^\]\]/, '[(': /^\)\]/, '[/': /^[\\\/]\]/, '[\\': /^[\\\/]\]/,
  '{{': /^\}\}/, '(': /^\)/, '[': /^\]/, '{': /^\}/, '>': /^\]/,
};
const INNER_END = { '(': ')', '[': ']', '{': '}' };
const NEXT_STATEMENT = /^[ \t]*(?:$|[\r\n;&]|:::|<?[-=~]|[xo]-)/;

function readLabel(source, start, open, budget, multiline, literalQuotes = false) {
  const endPattern = NODE_END[open];
  const ends = [];
  let quoted = false;
  for (let index = start; index < source.length && budget.remaining > 0; index++) {
    budget.remaining--;
    const character = source[index];
    if ((character === '\r' || character === '\n') && (!multiline || quoted)) return null;
    if (!literalQuotes && character === '"') quoted = !quoted;
    if (quoted) continue;
    if (ends.length === 0) {
      // The longest outer delimiter is three characters.
      const close = endPattern.exec(source.slice(index, index + 3))?.[0];
      if (close) return { end: index, after: index + close.length };
    }
    if (Object.hasOwn(INNER_END, character)) ends.push(INNER_END[character]);
    else if (')]}'.includes(character) && character !== ends.pop()) return null;
  }
  return null;
}

function findLabel(source, start, open, token, budget) {
  const boundary = readLabel(source, start, open, budget, open === '[');
  if (boundary) return { ...boundary, start, open };

  // A dangling quote inside a rectangle can hide its closing bracket from
  // the quote-aware scan. Accept it only with an obvious same-line boundary.
  if (token === 'STR' && open === '[') {
    const literal = readLabel(source, start, open, budget, false, true);
    if (literal && NEXT_STATEMENT.test(source.slice(literal.after)) &&
      source.slice(start, literal.end).match(/"/g)?.length % 2 === 1) {
      return { ...literal, start, open };
    }
    return null;
  }

  // In a single square-bracket label, the closing bracket can still be
  // unambiguous even when one parenthesis is literal.
  if (open !== '[' && open !== '[(') return null;
  const rectangleStart = open === '[(' ? start - 1 : start;
  const rectangle = /^[^[\]\r\n]+(?=\])/.exec(source.slice(rectangleStart));
  if (!rectangle) return null;
  const label = rectangle[0];
  const end = rectangleStart + label.length;
  if (!NEXT_STATEMENT.test(source.slice(end + 1))) return null;
  const loneParenthesis = open === '[' && label.match(/[()]/g)?.length === 1 &&
    (token === 'PS' && label.includes('(') || token === 'CYLINDEREND' && label.endsWith(')'));
  const leadingParentheses = open === '[(' && token === 'PE' && /^\([^()]+\)[ \t]+\S/.test(label);
  return loneParenthesis || leadingParentheses
    ? { start: rectangleStart, end, after: end + 1, open: '[', literalParentheses: true }
    : null;
}

function isPlainLabel(label, open) {
  if (/^\s*"|%%\s*\{/.test(label)) return false;
  let plain = label.replace(/<br[ \t]*\/?>/gi, '');
  if (open !== '[') return !/%%|[<>|\x60\\]/.test(plain);
  // Only admit literal comparisons here. Tag syntax and start-of-line
  // directives are left to the parser and its sanitization rules.
  plain = plain.replace(/(?<=[ \t])<(?=[ \t]+[+-]?\d)/g, '');
  return !/[<>]|(?:^|[\r\n])[ \t]*%%|\\(?![\w])|^\s*\x60/.test(plain) &&
    !plain.replace(/\x60[^\x60\r\n]+\x60/g, '').includes('\x60');
}

function normalizeFlowchartLabels(source, token, quoteEscape) {
  const tokens = new RegExp(LABEL_TOKEN);
  // Bound rescans when several unclosed labels overlap in malformed input.
  const budget = { remaining: source.length * 4 };
  const quoteOnly = token === 'STR';
  let output = '';
  let cursor = 0;
  for (let match; budget.remaining > 0 && (match = tokens.exec(source));) {
    const open = match[1] ?? match[2] ?? match[3];
    if (!open) continue;
    const boundary = findLabel(source, tokens.lastIndex, open, token, budget);
    if (!boundary) continue;
    tokens.lastIndex = boundary.after;
    const label = source.slice(boundary.start, boundary.end);
    if (!isPlainLabel(label, boundary.open)) continue;
    if (quoteOnly ? !label.includes('"') : !boundary.literalParentheses && (token !== 'PS' || !label.includes('('))) continue;
    const escaped = label.replaceAll('"', quoteEscape);
    // Preserve the line breaks of legacy multiline rectangle labels.
    output += source.slice(cursor, boundary.start) + (quoteOnly && boundary.open === '[' ? escaped : '"' + escaped + '"');
    cursor = boundary.end;
  }
  return output + source.slice(cursor);
}

function flowchartQuoteMarker(source) {
  // This glyph occupies similar space to a double quote during layout.
  const prefix = '\u2033\u2060';
  let marker = prefix;
  for (let suffix = 1; source.includes(marker); suffix++) marker = prefix + suffix + prefix;
  return marker;
}

function restoreFlowchartQuotes(svg, marker) {
  if (!marker || !svg?.includes(marker)) return svg;
  const markup = document.createElement('template');
  markup.innerHTML = svg;
  const walker = document.createTreeWalker(markup.content, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (node.data.includes(marker) && node.parentElement?.closest('svg text, svg .nodeLabel, svg .edgeLabel, svg .cluster-label')) {
      node.data = node.data.replaceAll(marker, '"');
    }
  }
  return markup.innerHTML;
}

export { flowchartQuoteMarker, normalizeFlowchartLabels, restoreFlowchartQuotes };
