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

function isContentGraphic(element) {
  return !element.closest('defs, marker, clipPath, mask, pattern, symbol') &&
    (element.localName !== 'text' || Boolean(element.textContent.trim()));
}

function hasSvgContent(svg) {
  return Array.from(svg.querySelectorAll(GRAPHICS)).some(isContentGraphic);
}

function isVisibleGraphic(element, svg, window) {
  if (!isContentGraphic(element)) return false;
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
    const { x, y, width, height } = svg.getBBox();
    if (![x, y, width, height].every(Number.isFinite)) return true;
    if (!width && !height) return false;
    const window = svg.ownerDocument.defaultView;
    if (!Array.from(svg.querySelectorAll(GRAPHICS)).some((element) => isVisibleGraphic(element, svg, window))) return false;
    if (type !== 'gantt' && type !== 'journey') return true;
    const left = Math.min(view.x, x);
    const top = Math.min(view.y, y);
    const right = Math.max(view.x + view.width, x + width);
    const bottom = Math.max(view.y + view.height, y + height);
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
  ensureSvgAccessibility,
  hasSvgContent,
  localizeGeneratedSvgTitle,
  prepareSvgPreview,
  rewriteSvgIds,
  serializeSvg,
  svgDimensions,
};
