import { serializeSvg, svgDimensions } from './svg.js';

const MAX_EDGE = 8192;
const MAX_PIXELS = 16_000_000;

async function rasterizeSvg(svg, background) {
  const { width, height } = svgDimensions(svg);
  const scale = Math.min(2, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / width / height));
  const pixelWidth = Math.max(1, Math.floor(width * scale));
  const pixelHeight = Math.max(1, Math.floor(height * scale));
  const clone = svg.cloneNode(true);
  for (const property of ['width', 'height', 'max-width', 'max-height']) clone.style.removeProperty(property);
  clone.setAttribute('width', String(pixelWidth));
  clone.setAttribute('height', String(pixelHeight));

  const document = svg.ownerDocument;
  const image = new document.defaultView.Image();
  // Chromium can taint a canvas when an SVG with foreignObject is loaded via Blob URL.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializeSvg(clone))}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG canvas is unavailable');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, pixelWidth, pixelHeight);
    }
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
    });
  } finally {
    canvas.width = 0;
  }
}

export { rasterizeSvg };
