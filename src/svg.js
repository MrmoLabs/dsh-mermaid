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

const GRAPHICS = 'circle, ellipse, foreignObject, image, line, path, polygon, polyline, rect, text, use';
const GEOMETRY_ATTRIBUTES = new Set([
  'viewBox', 'transform', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'dx', 'dy',
  'refX', 'refY', 'markerWidth', 'markerHeight', 'pathLength',
]);

function hasFiniteSvgGeometry(svg) {
  return ![svg, ...svg.querySelectorAll('*')].some((element) =>
    element.namespaceURI === svg.namespaceURI && [...element.attributes].some(({ name, value }) =>
      GEOMETRY_ATTRIBUTES.has(name) && /NaN|Infinity/.test(value)));
}

function isContentGraphic(element, type) {
  // Mermaid always draws the pie outline and journey timeline, even when
  // the source has no slices or steps. A visible title still counts.
  if (type === 'pie' && element.classList.contains('pieOuterCircle')) return false;
  if (type === 'journey' && element.localName === 'line' && element.parentElement.localName === 'svg' &&
      element.getAttribute('marker-end') === `url(#${element.parentElement.id}-arrowhead)`) return false;
  return !element.closest('defs, marker, clipPath, mask, pattern, symbol') &&
    (element.localName !== 'text' || Boolean(element.textContent.trim()));
}

function hasSvgContent(svg, type) {
  return Array.from(svg.querySelectorAll(GRAPHICS)).some((element) => isContentGraphic(element, type));
}

function isVisibleGraphic(element, svg, window, type) {
  if (!isContentGraphic(element, type)) return false;
  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || style.opacity === '0') return false;
  for (let parent = element.parentElement; parent && parent !== svg; parent = parent.parentElement) {
    const container = window.getComputedStyle(parent);
    if (container.display === 'none' || container.opacity === '0') return false;
  }
  const { width, height } = element.getBBox();
  const hasArea = width > 0 && height > 0;
  if (['foreignObject', 'image', 'use'].includes(element.localName)) return hasArea;
  const hasStroke = style.stroke !== 'none' && style.strokeOpacity !== '0' && Number.parseFloat(style.strokeWidth) !== 0;
  const hasFill = style.fill !== 'none' && style.fillOpacity !== '0';
  if (hasArea) return hasStroke || hasFill;
  return (width > 0 || height > 0) && ['line', 'path', 'polyline'].includes(element.localName) &&
    (hasStroke || [style.markerStart, style.markerMid, style.markerEnd].some((marker) => marker && marker !== 'none'));
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

function applyDiagramPalette(svg, type, background) {
  if (type !== 'zenuml' || background !== '#000' || !svg.id) return;
  const style = svg.ownerDocument.createElementNS(svg.namespaceURI, 'style');
  const scope = '#' + cssEscape(svg.id);
  style.textContent = [
    ['.frame-border-inner,.frame-header-bg,.participant-box,.group-title-bg', 'fill:#20242b'],
    ['.occurrence,.fragment-header', 'fill:#3b4656'],
    ['.frame-border-outer', 'fill:#78869a'],
    ['.participant-box,.participant-icon [fill="currentColor"]:not([stroke]),.frame-header-line,.fragment-border,.fragment-separator,.group-outline,.occurrence,.lifeline', 'stroke:#9aa8ba'],
    ['.frame-title,.participant-label,.message-label,.return-label,.return-icon,.fragment-label,.fragment-condition,.fragment-section-label,.group-title-text,.seq-number,.comment-text', 'fill:#e8edf5'],
    ['.participant-icon', 'color:#e8edf5'],
    ['.message-line,.return-line,.return-arrow,.arrow-head', 'stroke:#bdcce0'],
    ['.arrow-head:not(.arrow-open)', 'fill:#bdcce0'],
  ].map(([selectors, declarations]) => selectors.split(',').map((selector) => scope + ' ' + selector).join(',') + '{' + declarations + '}').join('\n');
  svg.append(style);
}

function cssEscape(identifier) {
  return identifier.replace(/[^\w-]/g, (character) => '\\' + character.codePointAt(0).toString(16) + ' ');
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

function measureSvgPreview(svg, type) {
  const view = svg.viewBox?.baseVal;
  if (!svg.getClientRects().length) return null;
  if (!view) return true;
  if (svg.hasAttribute('viewBox') && (view.width === 0 || view.height === 0)) {
    const dimensions = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
    if (dimensions.length === 4 && dimensions.every(Number.isFinite) &&
        (dimensions[2] === 0 || dimensions[3] === 0)) return false;
  }
  if (view.width <= 0 || view.height <= 0) return true;
  try {
    const { x, y, width, height } = svg.getBBox({ fill: true, stroke: true, markers: true });
    if (![x, y, width, height].every(Number.isFinite)) return true;
    if (!width && !height) return false;
    const window = svg.ownerDocument.defaultView;
    // Mermaid draws its empty root as an unnamed leaf. A real leaf may hide
    // its label when the cell is too small, so include the cell itself.
    const treemap = type === 'treemap' || type === 'treemap-beta';
    const graphics = treemap ? 'text, .treemapLeafGroup > rect.treemapLeaf' : GRAPHICS;
    const visible = [...svg.querySelectorAll(graphics)].some((element) => {
      if (treemap && element.localName === 'rect' && !element.parentElement.querySelector('.treemapLabel')?.textContent.trim()) return false;
      return isVisibleGraphic(element, svg, window, type);
    });
    if (!visible) return false;
    const margin = Math.min(8, Math.max(2, Math.min(view.width, view.height) * 0.02));
    const left = x < view.x ? x - margin : view.x;
    const top = y < view.y ? y - margin : view.y;
    const right = x + width > view.x + view.width ? x + width + margin : view.x + view.width;
    const bottom = y + height > view.y + view.height ? y + height + margin : view.y + view.height;
    if (left !== view.x || top !== view.y || right !== view.x + view.width || bottom !== view.y + view.height) {
      svg.setAttribute('viewBox', `${left} ${top} ${right - left} ${bottom - top}`);
    }
  } catch {
    // SVG geometry can be unavailable while the host is hiding the card.
  }
  return true;
}

function prepareSvgPreview(svg, type) {
  const measured = measureSvgPreview(svg, type);
  if (measured !== null || !svg.parentNode) return measured;

  // Code view hides the preview, but an explicit retry can still export it.
  const document = svg.ownerDocument;
  const parent = svg.parentNode;
  const next = svg.nextSibling;
  const staging = document.createElement('div');
  staging.setAttribute('aria-hidden', 'true');
  staging.style.cssText = 'position:fixed;inset:0 0 auto;height:0;overflow:hidden;opacity:0;pointer-events:none';
  document.body.append(staging);
  try {
    staging.append(svg);
    return measureSvgPreview(svg, type);
  } finally {
    parent.insertBefore(svg, next);
    staging.remove();
  }
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
  applyDiagramPalette,
  ensureSvgAccessibility,
  hasFiniteSvgGeometry,
  hasSvgContent,
  localizeGeneratedSvgTitle,
  prepareSvgPreview,
  rewriteSvgIds,
  serializeSvg,
  svgDimensions,
};
