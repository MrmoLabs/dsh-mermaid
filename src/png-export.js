import { serializeSvg, svgDimensions } from './svg.js';

const MAX_EDGE = 8192;
const MAX_PIXELS = 16_000_000;
const PNG_TIMEOUT_MS = 8_000;
class CanvasCapacityError extends Error {}

async function encodePng(svg, background, width, height) {
  const clone = svg.cloneNode(true);
  for (const property of ['width', 'height', 'max-width', 'max-height']) clone.style.removeProperty(property);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const document = svg.ownerDocument;
  const image = new document.defaultView.Image();
  const canvas = document.createElement('canvas');
  let timer;
  let expired = false;
  const deadline = new Promise((_, reject) => {
    timer = document.defaultView.setTimeout(() => {
      expired = true;
      reject(new Error('PNG encoding timed out'));
    }, PNG_TIMEOUT_MS);
  });
  const encode = async () => {
    // Chromium can taint a canvas when a foreignObject is loaded from a Blob URL.
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serializeSvg(clone));
    await image.decode();
    if (expired) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new CanvasCapacityError('PNG canvas is unavailable');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new CanvasCapacityError('PNG encoding returned no data')), 'image/png');
    });
  };
  try {
    return await Promise.race([encode(), deadline]);
  } finally {
    document.defaultView.clearTimeout(timer);
    image.removeAttribute('src');
    canvas.width = 0;
  }
}

async function rasterizeSvg(svg, background) {
  const { width, height } = svgDimensions(svg);
  const scale = Math.min(3, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / width / height));
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  try {
    return await encodePng(svg, background, w, h);
  } catch (error) {
    if (!(error instanceof CanvasCapacityError) || (w * h <= 4_000_000 && Math.max(w, h) <= 4096)) throw error;
    return encodePng(svg, background, Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  }
}

export { rasterizeSvg };
