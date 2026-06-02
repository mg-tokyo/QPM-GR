// Utility helpers for working with sprite canvases

export interface CanvasToImageOptions {
  size?: number;
  pixelated?: boolean;
  alt?: string;
  className?: string;
}

// Cache data URLs per canvas instance to avoid repeating expensive conversions
const dataUrlCache = new WeakMap<HTMLCanvasElement, string>();

export function canvasToDataUrl(canvas: HTMLCanvasElement | null | undefined): string {
  if (!canvas) {
    return '';
  }

  const cached = dataUrlCache.get(canvas);
  if (cached) {
    return cached;
  }

  try {
    const dataUrl = canvas.toDataURL('image/png');
    dataUrlCache.set(canvas, dataUrl);
    return dataUrl;
  } catch (error) {
    console.error('[Canvas Helpers] Failed to convert canvas to data URL', error);
    return '';
  }
}

export function canvasToImage(canvas: HTMLCanvasElement | null | undefined, options: CanvasToImageOptions = {}): HTMLImageElement | null {
  if (!canvas) {
    return null;
  }

  const img = new Image();
  const size = options.size;

  if (typeof size === 'number' && Number.isFinite(size)) {
    img.width = size;
    img.height = size;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
  }

  if (options.pixelated) {
    img.style.imageRendering = 'pixelated';
  }

  if (options.className) {
    img.className = options.className;
  }

  img.alt = options.alt ?? '';
  img.src = canvasToDataUrl(canvas);

  return img;
}
