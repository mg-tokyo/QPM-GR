// src/utils/weatherDetection.ts
// Shared weather canvas detection helpers used across features.

import { getGameHudRoot } from '../dom/dom';

export const WEATHER_CANVAS_SELECTORS: readonly string[] = [
  // NEW - Graphics engine 2025-12-13
  '#App > div.McFlex.css-1k630i1 > div.McFlex.css-neeqas > div.McFlex.css-1mq3gde > div.McGrid.css-9guy2q > div.McFlex.css-13izacw > div.css-79elbk',
  '#App > div.McFlex.css-neeqas div.css-79elbk',
  '#App [data-tm-hud-root] div.css-79elbk',
  '#App .QuinoaUI .css-79elbk',
  '#App .css-79elbk',
  // Legacy selectors (keep these too for compatibility)
  '#App > div.McFlex.css-1k630i1 > div.McFlex.css-neeqas > div.McFlex.css-1mq3gde > div.McGrid.css-9guy2q > div.McFlex.css-13izacw > div.css-vmnhaw',
  '#App > div.McFlex.css-neeqas div.css-vmnhaw',
  '#App [data-tm-hud-root] div.css-vmnhaw',
  '#App .QuinoaUI .css-vmnhaw',
  '#App .css-vmnhaw',
];

export type WeatherEventCategory = 'base' | 'weather' | 'lunar';

export interface WeatherEventDefinition {
  id: string;
  label: string;
  normalized: string;
  kind: DetailedWeather;
  category: WeatherEventCategory;
  durationMs: number | null;
  rawState: 'weather' | 'noweather';
  aliases: string[];
}

export const WEATHER_EVENT_DEFINITIONS: readonly WeatherEventDefinition[] = [
  {
    id: 'Weather:Sunny',
    label: 'Sunny',
    normalized: 'sunny',
    kind: 'sunny',
    category: 'base',
    durationMs: null,
    rawState: 'noweather',
    aliases: [],
  },
  {
    id: 'Weather:Rain',
    label: 'Rain',
    normalized: 'rain',
    kind: 'rain',
    category: 'weather',
    durationMs: 5 * 60 * 1000,
    rawState: 'weather',
    aliases: [],
  },
  {
    id: 'Weather:Frost',
    label: 'Frost',
    normalized: 'frost',
    kind: 'snow',
    category: 'weather',
    durationMs: 5 * 60 * 1000,
    rawState: 'weather',
    aliases: ['snow'],
  },
  {
    id: 'Weather:Dawn',
    label: 'Dawn',
    normalized: 'dawn',
    kind: 'dawn',
    category: 'lunar',
    durationMs: 10 * 60 * 1000,
    rawState: 'weather',
    aliases: ['sunrise'],
  },
  {
    id: 'Weather:AmberMoon',
    label: 'Amber Moon',
    normalized: 'ambermoon',
    kind: 'amber',
    category: 'lunar',
    durationMs: 10 * 60 * 1000,
    rawState: 'weather',
    aliases: ['harvestmoon', 'amber_moon'],
  },
];

const WEATHER_LOOKUP = new Map<string, WeatherEventDefinition>();
for (const def of WEATHER_EVENT_DEFINITIONS) {
  const aliases = new Set([def.label, def.normalized, ...def.aliases]);
  aliases.forEach((alias) => {
    const key = normalizeWeatherLabel(alias);
    if (key) {
      WEATHER_LOOKUP.set(key, def);
    }
  });
}

export function normalizeWeatherLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function getWeatherDefinitionFromLabel(value: string | null | undefined): WeatherEventDefinition | null {
  if (value == null) return WEATHER_LOOKUP.get('sunny') ?? null;
  const normalized = normalizeWeatherLabel(value);
  if (!normalized) return WEATHER_LOOKUP.get('sunny') ?? null;
  return WEATHER_LOOKUP.get(normalized) ?? null;
}

export function classifyWeatherFromLabel(value: string | null | undefined): DetailedWeather {
  const def = getWeatherDefinitionFromLabel(value);
  return def?.kind ?? (value ? 'unknown' : 'sunny');
}

function pickWeatherCanvasFrom(root: ParentNode): HTMLCanvasElement | null {
  const canvases = Array.from(root.querySelectorAll('canvas')) as HTMLCanvasElement[];
  return (
    canvases.find((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 16 && rect.width <= 256 && rect.top >= 0 && rect.top <= 220;
    }) || null
  );
}

export function findWeatherCanvas(): HTMLCanvasElement | null {
  for (const selector of WEATHER_CANVAS_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) continue;

    if (element instanceof HTMLCanvasElement) {
      return element;
    }

    const canvas = element.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) {
      return canvas;
    }
  }

  const searchRoots: HTMLElement[] = [];
  const hud = getGameHudRoot();
  if (hud) {
    searchRoots.push(hud);
  }

  const appRoot = document.getElementById('App');
  if (appRoot instanceof HTMLElement && !searchRoots.includes(appRoot)) {
    searchRoots.push(appRoot);
  }

  for (const root of searchRoots) {
    const canvas = pickWeatherCanvasFrom(root);
    if (canvas) {
      return canvas;
    }
  }

  return pickWeatherCanvasFrom(document);
}

export function isCanvasDrawn(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    const width = Math.min(canvas.width, 128);
    const height = Math.min(canvas.height, 128);
    if (width === 0 || height === 0) return false;

    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i]! > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function getCanvasHash(canvas: HTMLCanvasElement): string {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'no-context';

    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const samples: Array<[number, number]> = [
      [width * 0.25, height * 0.25],
      [width * 0.5, height * 0.5],
      [width * 0.75, height * 0.75],
      [width * 0.2, height * 0.65],
      [width * 0.8, height * 0.35],
    ];

    let hash = 0;
    for (const [xRaw, yRaw] of samples) {
      const x = Math.min(width - 1, Math.max(0, Math.round(xRaw)));
      const y = Math.min(height - 1, Math.max(0, Math.round(yRaw)));
      const index = (y * width + x) * 4;
      hash = ((hash << 5) - hash) + imageData.data[index]!;
      hash |= 0;
    }

    return hash.toString(16);
  } catch {
    return 'error';
  }
}

export function classifyWeather(canvas: HTMLCanvasElement): 'weather' | 'noweather' {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'noweather';

    const width = canvas.width;
    const height = canvas.height;
    const { data } = ctx.getImageData(0, 0, width, height);

    let darkBluePixels = 0;
    let grayPixels = 0;
    let brightYellowPixels = 0;
    let whitePixels = 0;
    let totalPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;

      if (a < 50) continue;
      totalPixels++;

      if (b > 120 && b > r + 20 && b > g + 10) {
        darkBluePixels++;
      }

      const isGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && Math.abs(r - b) < 20;
      if (isGray && r >= 60 && r <= 140) {
        grayPixels++;
      }

      if (r > 200 && g > 150 && b < 120) {
        brightYellowPixels++;
      }

      if (r > 200 && g > 200 && b > 200) {
        whitePixels++;
      }
    }

    if (totalPixels === 0) return 'noweather';

    const darkBlueRatio = darkBluePixels / totalPixels;
    const grayRatio = grayPixels / totalPixels;
    const sunRatio = brightYellowPixels / totalPixels;
    const whiteRatio = whitePixels / totalPixels;

    if (darkBlueRatio >= 0.05 || grayRatio >= 0.1) {
      return 'weather';
    }

    if (sunRatio >= 0.01 || whiteRatio >= 0.3) {
      return 'noweather';
    }

    const avgBrightness = (darkBluePixels * 80 + grayPixels * 100 + brightYellowPixels * 220 + whitePixels * 255) / totalPixels;
    if (avgBrightness < 120) {
      return 'weather';
    }

    return 'noweather';
  } catch {
    return 'noweather';
  }
}

export type DetailedWeather = 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'unknown';

export function detectDetailedWeather(canvas: HTMLCanvasElement): DetailedWeather {
  const base = classifyWeather(canvas);
  if (base === 'noweather') {
    return 'sunny';
  }

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'unknown';

    const sampleWidth = Math.min(canvas.width, 120);
    const sampleHeight = Math.min(canvas.height, 120);
    const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);

    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;
    let pixelCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      if (a < 40) continue;
      redTotal += data[i]!;
      greenTotal += data[i + 1]!;
      blueTotal += data[i + 2]!;
      pixelCount++;
    }

    if (pixelCount === 0) return 'unknown';

    const redAvg = redTotal / pixelCount;
    const greenAvg = greenTotal / pixelCount;
    const blueAvg = blueTotal / pixelCount;

    if (blueAvg > redAvg + 20 && blueAvg > greenAvg + 10) {
      return 'rain';
    }

    if (blueAvg > 150 && redAvg > 150 && greenAvg > 150) {
      return 'snow';
    }

    if (redAvg > 120 && blueAvg > 100 && greenAvg < redAvg - 10) {
      return 'dawn';
    }

    if (redAvg > 150 && greenAvg > 100 && blueAvg < 100) {
      return 'amber';
    }

    return 'rain';
  } catch {
    return 'unknown';
  }
}
