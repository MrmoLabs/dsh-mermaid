let accessibleTitleUid = 0;
let viewerCloneUid = 0;

// Skip comments and strings. Only map complete fragment URLs or selector IDs,
// never a shorter ID prefix or a hexadecimal color in a declaration.
const CSS_REFERENCE = /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)|#((?:\\[0-9a-fA-F]{1,6}[ \t\r\n\f]?|\\[^\r\n\f]|[\w\u0080-\uFFFF-])+)|([{};])/g;

function cssIdentifier(value) {
  return value.replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?|\\([^\r\n\f])/g, (_match, hex, character) => {
    if (!hex) return character;
    const code = Number.parseInt(hex, 16);
    return code && code <= 0x10FFFF && (code < 0xD800 || code > 0xDFFF) ? String.fromCodePoint(code) : '\uFFFD';
  });
}

function rewriteCssIds(css, idMap) {
  const tokens = [...css.matchAll(CSS_REFERENCE)];
  let boundary;
  // The next delimiter distinguishes selector preludes from declarations.
  // Tokens inside comments/strings cannot change that boundary.
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    const [, quote, urlId, selectorId, delimiter] = token;
    if (delimiter) boundary = delimiter;
    else if (urlId !== undefined && idMap.has(urlId)) token.replacement = `url(${quote}#${idMap.get(urlId)}${quote})`;
    else if (selectorId !== undefined && boundary === '{') {
      const replacement = idMap.get(cssIdentifier(selectorId));
      if (replacement) token.replacement = `#${replacement}`;
    }
  }
  let offset = 0;
  return tokens.map((token) => {
    const piece = css.slice(offset, token.index) + (token.replacement ?? token[0]);
    offset = token.index + token[0].length;
    return piece;
  }).join('') + css.slice(offset);
}

function serializeSvg(svg) {
  const xml = new window.XMLSerializer().serializeToString(svg);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

function ensureSvgAccessibility(svg, titleText) {
  if (!svg) return;
  svg.setAttribute('role', 'img');
  if (svg.hasAttribute('aria-label') || svg.hasAttribute('aria-labelledby')) return;

  let title = [...svg.children].find((child) => child.localName === 'title');
  if (!title) {
    title = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.dataset.dshMmdTitle = 'true';
    title.textContent = titleText;
    svg.prepend(title);
  }
  if (!title.id) title.id = `dsh-mmd-title-${++accessibleTitleUid}`;
  svg.setAttribute('aria-labelledby', title.id);
}

function localizeGeneratedSvgTitle(svg, titleText) {
  const generatedTitle = svg?.querySelector('title[data-dsh-mmd-title]');
  if (generatedTitle) generatedTitle.textContent = titleText;
}

function svgDimensions(svg) {
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  return {
    width: Number.parseFloat(svg.getAttribute('width')) || 800,
    height: Number.parseFloat(svg.getAttribute('height')) || 600,
  };
}

function rewriteSvgIds(svg) {
  const elements = [svg, ...svg.querySelectorAll('*')];
  const idMap = new Map();
  const prefix = `dsh-mmd-view-${++viewerCloneUid}-`;

  for (const element of elements) {
    if (!element.id) continue;
    const replacement = `${prefix}${idMap.size + 1}`;
    idMap.set(element.id, replacement);
    element.id = replacement;
  }

  if (!idMap.size) return;
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id') continue;
      let value = attribute.value.replace(
        /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
        (match, quote, id) => idMap.has(id) ? `url(${quote}#${idMap.get(id)}${quote})` : match,
      );
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) {
        const replacement = idMap.get(value.slice(1));
        if (replacement) value = `#${replacement}`;
      }
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        value = value.split(/\s+/).map((id) => idMap.get(id) || id).join(' ');
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }

  for (const style of svg.querySelectorAll('style')) {
    style.textContent = rewriteCssIds(style.textContent || '', idMap);
  }
}

export {
  ensureSvgAccessibility,
  localizeGeneratedSvgTitle,
  rewriteSvgIds,
  serializeSvg,
  svgDimensions,
};
