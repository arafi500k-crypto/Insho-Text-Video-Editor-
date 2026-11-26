import type { MediaOverlayChromaKey } from '../types/editor';
import { clamp } from './timeline';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function parseHexColor(hex: string): RgbColor {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { r: 0, g: 200, b: 80 };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Computes output alpha (0..255) for a pixel given target key color,
 * intensity/similarity (0..100), feather smoothness (0..100), shadow (0..100), and edgeCleanup (0..100).
 */
export function computeChromaKeyAlpha(
  r: number,
  g: number,
  b: number,
  keyR: number,
  keyG: number,
  keyB: number,
  similarity: number,
  smoothness: number,
  shadow = 0,
  edgeCleanup = 0,
): number {
  const dr = r - keyR;
  const dg = g - keyG;
  const db = b - keyB;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);

  const threshold = clamp(similarity, 0, 100) * 2.2;
  const feather = Math.max(4, clamp(smoothness, 0, 100) * 1.4);

  let alphaRatio = 1;
  if (dist <= threshold) {
    alphaRatio = 0;
  } else if (dist < threshold + feather) {
    alphaRatio = clamp((dist - threshold) / feather, 0, 1);
  }

  // Shadow cleanup: remove darker shades with matching chroma direction
  if (alphaRatio > 0 && shadow > 0) {
    const keyLum = Math.max(24, 0.299 * keyR + 0.587 * keyG + 0.114 * keyB);
    const pixLum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (pixLum < keyLum) {
      const ratio = clamp(pixLum / keyLum, 0.1, 1);
      const scaledR = keyR * ratio;
      const scaledG = keyG * ratio;
      const scaledB = keyB * ratio;
      const sDist = Math.hypot(r - scaledR, g - scaledG, b - scaledB);
      const shadowThreshold = (clamp(shadow, 0, 100) * 1.35) + threshold * 0.45;
      if (sDist <= shadowThreshold) {
        const shadowKill = clamp(1 - sDist / Math.max(1, shadowThreshold), 0, 1);
        alphaRatio *= 1 - shadowKill * clamp(shadow / 60, 0, 1);
      }
    }
  }

  // Edge cleanup: tighten semi-transparent fringe pixels
  if (alphaRatio > 0 && alphaRatio < 1 && edgeCleanup > 0) {
    const cutoff = clamp(edgeCleanup, 0, 100) / 140;
    alphaRatio = clamp((alphaRatio - cutoff) / Math.max(0.05, 1 - cutoff), 0, 1);
  }

  return Math.round(clamp(alphaRatio, 0, 1) * 255);
}

export interface ChromaCacheEntry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  signature: string;
  videoTime: number | null;
}

export function buildChromaKeySignature(
  naturalW: number,
  naturalH: number,
  chromaKey: MediaOverlayChromaKey,
  maxProcessingDim: number,
  mediaSrc?: string,
): string {
  return [
    mediaSrc ?? '',
    naturalW,
    naturalH,
    maxProcessingDim,
    chromaKey.color.toLowerCase(),
    chromaKey.similarity,
    chromaKey.smoothness,
    chromaKey.shadow ?? 0,
    chromaKey.edgeCleanup ?? 0,
  ].join('|');
}

export function shouldReuseChromaCache(
  cachedSignature: string | null,
  nextSignature: string,
  isVideo: boolean,
  cachedVideoTime: number | null,
  currentVideoTime: number | null,
): boolean {
  if (!cachedSignature || cachedSignature !== nextSignature) {
    return false;
  }
  if (!isVideo) {
    return true;
  }
  if (cachedVideoTime === null || currentVideoTime === null) {
    return false;
  }
  return Math.abs(currentVideoTime - cachedVideoTime) < 0.001;
}

// Reusable scratch buffers + cache metadata so static images & repeated video frames cost 0ms
const scratchCacheMap = new Map<string, ChromaCacheEntry>();
let pickerSampleCanvas: HTMLCanvasElement | null = null;

function getScratchEntry(key: string): ChromaCacheEntry {
  let entry = scratchCacheMap.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    entry = {
      canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true }),
      signature: '',
      videoTime: null,
    };
    scratchCacheMap.set(key, entry);
  }
  return entry;
}

/**
 * Samples the RGB color at normalized (nx, ny) inside a loaded image or video frame.
 */
export function sampleDrawableHexColor(
  drawable: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  naturalW: number,
  naturalH: number,
  nx: number,
  ny: number,
): string | null {
  if (naturalW <= 0 || naturalH <= 0) return null;
  if (!pickerSampleCanvas) {
    pickerSampleCanvas = document.createElement('canvas');
    pickerSampleCanvas.width = 3;
    pickerSampleCanvas.height = 3;
  }
  const ctx = pickerSampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const px = clamp(Math.floor(nx * naturalW), 0, Math.max(0, naturalW - 1));
  const py = clamp(Math.floor(ny * naturalH), 0, Math.max(0, naturalH - 1));
  const sx = clamp(px - 1, 0, Math.max(0, naturalW - 3));
  const sy = clamp(py - 1, 0, Math.max(0, naturalH - 3));
  const sw = Math.min(3, naturalW);
  const sh = Math.min(3, naturalH);

  try {
    ctx.clearRect(0, 0, 3, 3);
    ctx.drawImage(drawable, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    const count = Math.max(1, sw * sh);
    for (let i = 0; i < count * 4; i += 4) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    return rgbToHex(rSum / count, gSum / count, bSum / count);
  } catch {
    return null;
  }
}

/**
 * Renders the drawable onto a reusable scratch canvas with chroma key transparency applied.
 * Caches processed pixels by parameter signature + decoded video frame timestamp so spinning
 * photo overlays cost 0ms CPU per frame and 60Hz RAF never re-keys duplicate video frames.
 */
export function createChromaKeyedCanvas(
  cacheKey: string,
  drawable: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  naturalW: number,
  naturalH: number,
  chromaKey: MediaOverlayChromaKey,
  maxProcessingDim = 420,
): HTMLCanvasElement | null {
  if (naturalW <= 0 || naturalH <= 0) return null;

  const isVideo = typeof HTMLVideoElement !== 'undefined' && drawable instanceof HTMLVideoElement;
  const isFallbackCanvas =
    typeof HTMLCanvasElement !== 'undefined' && drawable instanceof HTMLCanvasElement;
  const mediaSrc = isVideo
    ? (drawable as HTMLVideoElement).currentSrc || (drawable as HTMLVideoElement).src
    : isFallbackCanvas
      ? 'fallback-frame'
      : (drawable as HTMLImageElement).currentSrc || (drawable as HTMLImageElement).src;
  const currentVideoTime = isVideo ? (drawable as HTMLVideoElement).currentTime : null;

  const entry = getScratchEntry(cacheKey);
  const nextSignature = buildChromaKeySignature(
    naturalW,
    naturalH,
    chromaKey,
    maxProcessingDim,
    mediaSrc,
  );

  if (
    entry.canvas.width > 0 &&
    shouldReuseChromaCache(
      entry.signature,
      nextSignature,
      isVideo,
      entry.videoTime,
      currentVideoTime,
    )
  ) {
    return entry.canvas;
  }

  const scale = Math.min(1, maxProcessingDim / Math.max(naturalW, naturalH));
  const w = Math.max(2, Math.round(naturalW * scale));
  const h = Math.max(2, Math.round(naturalH * scale));

  const scratch = entry.canvas;
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }

  const ctx = entry.ctx ?? scratch.getContext('2d', { willReadFrequently: true });
  entry.ctx = ctx;
  if (!ctx) return null;

  try {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(drawable, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const { r: keyR, g: keyG, b: keyB } = parseHexColor(chromaKey.color);
    const similarity = clamp(chromaKey.similarity, 0, 100);
    const smoothness = clamp(chromaKey.smoothness, 0, 100);
    const shadow = clamp(chromaKey.shadow ?? 0, 0, 100);
    const edgeCleanup = clamp(chromaKey.edgeCleanup ?? 0, 0, 100);

    const threshold = similarity * 2.2;
    const feather = Math.max(4, smoothness * 1.4);
    const outerRadius = threshold + feather;
    const thresholdSq = threshold * threshold;
    const outerSq = outerRadius * outerRadius;
    const keyLum = shadow > 0 ? Math.max(24, 0.299 * keyR + 0.587 * keyG + 0.114 * keyB) : 0;
    const shadowThreshold = shadow > 0 ? shadow * 1.35 + threshold * 0.45 : 0;
    const shadowStrength = shadow > 0 ? Math.min(1, shadow / 60) : 0;
    const edgeCutoff = edgeCleanup > 0 ? edgeCleanup / 140 : 0;
    const edgeDenom = Math.max(0.05, 1 - edgeCutoff);
    const despill = edgeCleanup > 0 ? Math.min(0.7, edgeCleanup / 120) : 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dr = r - keyR;
      const dg = g - keyG;
      const db = b - keyB;
      const distSq = dr * dr + dg * dg + db * db;

      // Fast path 1: solid background key match -> instant alpha 0 without sqrt
      if (distSq <= thresholdSq) {
        data[i + 3] = 0;
        continue;
      }

      let alphaRatio = 1;
      if (distSq < outerSq) {
        const dist = Math.sqrt(distSq);
        alphaRatio = (dist - threshold) / feather;
        if (alphaRatio < 0) alphaRatio = 0;
        else if (alphaRatio > 1) alphaRatio = 1;
      }

      // Shadow cleanup only when needed
      if (shadow > 0 && alphaRatio > 0) {
        const pixLum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (pixLum < keyLum) {
          let ratio = pixLum / keyLum;
          if (ratio < 0.1) ratio = 0.1;
          const sdr = r - keyR * ratio;
          const sdg = g - keyG * ratio;
          const sdb = b - keyB * ratio;
          const sDistSq = sdr * sdr + sdg * sdg + sdb * sdb;
          if (sDistSq <= shadowThreshold * shadowThreshold) {
            const sDist = Math.sqrt(sDistSq);
            const shadowKill = 1 - sDist / Math.max(1, shadowThreshold);
            alphaRatio *= 1 - shadowKill * shadowStrength;
          }
        }
      }

      // Fast path 2: fully opaque foreground pixel -> leave untouched
      if (alphaRatio >= 0.998) {
        continue;
      }

      if (edgeCleanup > 0 && alphaRatio > 0) {
        alphaRatio = (alphaRatio - edgeCutoff) / edgeDenom;
        if (alphaRatio < 0) alphaRatio = 0;
        else if (alphaRatio > 1) alphaRatio = 1;
      }

      if (alphaRatio <= 0.002) {
        data[i + 3] = 0;
        continue;
      }

      data[i + 3] = Math.round(data[i + 3] * alphaRatio);
      if (despill > 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = Math.round(r + (lum - r) * despill);
        data[i + 1] = Math.round(g + (lum - g) * despill);
        data[i + 2] = Math.round(b + (lum - b) * despill);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    entry.signature = nextSignature;
    entry.videoTime = currentVideoTime;
    return scratch;
  } catch {
    return null;
  }
}
