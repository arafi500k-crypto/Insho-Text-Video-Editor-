import type {
  MediaAsset,
  MediaOverlay,
  TextOverlay,
  TimelineClip,
  TimelineSegment,
} from '../types/editor';
import { createChromaKeyedCanvas, sampleDrawableHexColor } from './chromaKey';
import { mediaCache, getOrCreateVideoElement, loadImageElement } from './mediaLoader';
import {
  buildCssFilterString,
  clamp,
  computeClipSegments,
  computeMediaOverlayBoxSize,
  computeMediaOverlaySourceTime,
  computeMediaOverlaySpinDegrees,
  computeRotationHandleCoords,
  computeTextAnimationState,
  findActiveSegmentAtTime,
  mapTimelineTimeToSourceTime,
} from './timeline';

export interface OverlayHitTarget {
  id: string;
  anchorX: number;
  anchorY: number;
  centerX: number;
  centerY: number;
  halfW: number;
  halfH: number;
  handleX: number;
  handleY: number;
  rotation: number;
}

export interface MediaOverlayHitTarget {
  id: string;
  centerX: number;
  centerY: number;
  halfW: number;
  halfH: number;
  rotation: number;
  handleX: number;
  handleY: number;
  handleSide: 'top' | 'bottom';
  corners: Array<{ x: number; y: number }>;
  pickerX: number;
  pickerY: number;
}

export interface OverrideVideoFrame {
  width: number;
  height: number;
  sourceKey: string;
  timestamp: number;
  draw: (ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) => void;
  asCanvasSource: () => CanvasImageSource | null;
}

export interface RenderFrameOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  clips: TimelineClip[];
  assetsById: Map<string, MediaAsset>;
  overlays: TextOverlay[];
  mediaOverlays?: MediaOverlay[];
  timelineTime: number;
  selectedOverlayId?: string | null;
  selectedMediaOverlayId?: string | null;
  chromaPickerActive?: boolean;
  chromaTouchPoint?: { x: number; y: number } | null;
  showSelectionGuide?: boolean;
  chromaMaxDim?: number;
  precomputedSegments?: TimelineSegment[];
  skipSnapshotCache?: boolean;
  imageSmoothingQuality?: ImageSmoothingQuality;
  videoFrameOverrides?: Map<string, OverrideVideoFrame>;
  overlayHitTargetsOut?: Map<string, OverlayHitTarget>;
  mediaOverlayHitTargetsOut?: Map<string, MediaOverlayHitTarget>;
}

const lastDecodedVideoFrameCache = new WeakMap<HTMLVideoElement, HTMLCanvasElement>();
const lastSnapshotAtMs = new WeakMap<HTMLVideoElement, number>();

function maybeSnapshotVideoFrame(video: HTMLVideoElement): void {
  if (
    video.readyState < 2 ||
    video.seeking ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return;
  }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prevMs = lastSnapshotAtMs.get(video) ?? 0;
  if (!video.paused && now - prevMs < 140) {
    return;
  }
  lastSnapshotAtMs.set(video, now);

  // Cap fallback snapshot canvas to 720px max side so 4K mobile videos never OOM
  const maxSnapDim = 720;
  const scale = Math.min(1, maxSnapDim / Math.max(video.videoWidth, video.videoHeight));
  const targetW = Math.max(2, Math.round(video.videoWidth * scale));
  const targetH = Math.max(2, Math.round(video.videoHeight * scale));

  let cached = lastDecodedVideoFrameCache.get(video);
  if (!cached) {
    cached = document.createElement('canvas');
    cached.width = targetW;
    cached.height = targetH;
    lastDecodedVideoFrameCache.set(video, cached);
  } else if (cached.width !== targetW || cached.height !== targetH) {
    cached.width = targetW;
    cached.height = targetH;
  }
  const cctx = cached.getContext('2d');
  if (!cctx) return;
  try {
    cctx.drawImage(video, 0, 0, targetW, targetH);
  } catch {
    // Ignore transient decode copy error
  }
}

function resolveVideoDrawable(
  video: HTMLVideoElement,
  skipSnapshotCache = false,
): HTMLVideoElement | HTMLCanvasElement | undefined {
  if (!video.seeking && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    if (!skipSnapshotCache) {
      maybeSnapshotVideoFrame(video);
    }
    return video;
  }
  const cached = lastDecodedVideoFrameCache.get(video);
  if (cached && cached.width > 0 && cached.height > 0) {
    return cached;
  }
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return video;
  }
  return undefined;
}

function drawClipVisual(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  segment: TimelineSegment,
  asset: MediaAsset | undefined,
  timelineTime: number,
  alpha = 1,
  extraOffsetX = 0,
  extraScale = 1,
  skipSnapshotCache = false,
  videoFrameOverrides?: Map<string, OverrideVideoFrame>,
  isHoldPrev = false,
) {
  if (!asset || alpha <= 0.01) return;

  let drawable: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | undefined;
  let overrideFrame: OverrideVideoFrame | undefined;
  let naturalW = asset.width || 1080;
  let naturalH = asset.height || 1920;

  if (asset.kind === 'image') {
    const img = mediaCache.images.get(asset.id);
    if (img && img.complete && img.naturalWidth > 0) {
      drawable = img;
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
    } else {
      void loadImageElement(asset.id, asset.src);
    }
  } else {
    const override = isHoldPrev
      ? videoFrameOverrides?.get(`hold:${segment.clip.id}`) ?? videoFrameOverrides?.get(asset.id)
      : videoFrameOverrides?.get(asset.id);
    if (override) {
      overrideFrame = override;
      naturalW = override.width || naturalW;
      naturalH = override.height || naturalH;
    } else {
      const video = getOrCreateVideoElement(asset.id, asset.src);
      const resolved = resolveVideoDrawable(video, skipSnapshotCache);
      if (resolved) {
        drawable = resolved;
        naturalW =
          resolved instanceof HTMLVideoElement
            ? resolved.videoWidth || naturalW
            : resolved.width || naturalW;
        naturalH =
          resolved instanceof HTMLVideoElement
            ? resolved.videoHeight || naturalH
            : resolved.height || naturalH;
      }
    }
  }

  ctx.save();
  if (alpha < 0.999) {
    ctx.globalAlpha = clamp(alpha, 0, 1);
  }

  const filterStr = buildCssFilterString(segment.clip.filter);
  if (filterStr !== 'none') {
    ctx.filter = filterStr;
  }

  if (!overrideFrame && !drawable) {
    // Clean dark placeholder frame while asset finishes initial decode
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#181824');
    grad.addColorStop(1, '#09090d');
    ctx.fillStyle = grad;
    ctx.fillRect(extraOffsetX, 0, width, height);
    ctx.restore();
    return;
  }

  const baseScale =
    segment.clip.crop.fit === 'cover'
      ? Math.max(width / naturalW, height / naturalH)
      : Math.min(width / naturalW, height / naturalH);

  // Subtle Ken Burns drift on still photos for lively preview & export
  const localProgress =
    segment.duration > 0
      ? clamp((timelineTime - segment.startTime) / segment.duration, 0, 1)
      : 0;
  const kenBurnsBoost = asset.kind === 'image' ? 1 + localProgress * 0.05 : 1;

  const finalScale = baseScale * segment.clip.crop.zoom * kenBurnsBoost * extraScale;
  const drawW = naturalW * finalScale;
  const drawH = naturalH * finalScale;

  const panOffsetX = segment.clip.crop.panX * width * 0.5;
  const panOffsetY = segment.clip.crop.panY * height * 0.5;

  const drawX = (width - drawW) / 2 + panOffsetX + extraOffsetX;
  const drawY = (height - drawH) / 2 + panOffsetY;

  if (overrideFrame) {
    overrideFrame.draw(ctx, drawX, drawY, drawW, drawH);
  } else if (drawable) {
    ctx.drawImage(drawable, drawX, drawY, drawW, drawH);
  }
  ctx.restore();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawTextOverlayItem(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: TextOverlay,
  timelineTime: number,
  isSelected: boolean,
  showSelectionGuide: boolean,
  hitTargetsOut?: Map<string, OverlayHitTarget>,
) {
  const anim = computeTextAnimationState(overlay, timelineTime);
  if (anim.opacity <= 0.01 || !overlay.text.trim()) return;

  const scaleUnit = Math.min(width, height) / 1080;
  const scaledFontSize = Math.max(14, Math.round(overlay.fontSize * scaleUnit));
  const lineHeight = Math.round(scaledFontSize * 1.24);
  const rotationDeg = (overlay.rotation || 0) + anim.rotationDeg;
  const rotationRad = (rotationDeg * Math.PI) / 180;

  ctx.save();
  ctx.globalAlpha = clamp(anim.opacity, 0, 1);

  const anchorX = overlay.x * width;
  const anchorY = overlay.y * height + anim.offsetY * scaleUnit;

  ctx.translate(anchorX, anchorY);
  ctx.rotate(rotationRad);
  ctx.scale(anim.scale, anim.scale);

  ctx.font = `700 ${scaledFontSize}px "${overlay.fontFamily}", "Plus Jakarta Sans", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = overlay.align;

  const maxLineWidth = width * 0.82;
  const lines = wrapTextLines(ctx, overlay.text, maxLineWidth);
  const measuredWidths = lines.map((l) => ctx.measureText(l).width);
  const blockW = Math.max(24, ...measuredWidths);
  const blockH = lines.length * lineHeight;

  const padX = Math.round(scaledFontSize * 0.48);
  const padY = Math.round(scaledFontSize * 0.28);

  const boxLeft =
    overlay.align === 'center'
      ? -blockW / 2 - padX
      : overlay.align === 'left'
        ? -padX
        : -blockW - padX;
  const boxTop = -blockH / 2 - padY;
  const boxW = blockW + padX * 2;
  const boxH = blockH + padY * 2;

  if (overlay.boxStyle !== 'none' && overlay.boxStyle !== 'outline') {
    drawRoundedRectPath(ctx, boxLeft, boxTop, boxW, boxH, Math.round(scaledFontSize * 0.34));
    if (overlay.boxStyle === 'obsidian') {
      ctx.fillStyle = 'rgba(10, 10, 15, 0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = Math.max(1, 2 * scaleUnit);
      ctx.stroke();
    } else if (overlay.boxStyle === 'white-pill') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.fill();
    } else if (overlay.boxStyle === 'pink-purple') {
      const grad = ctx.createLinearGradient(boxLeft, boxTop, boxLeft + boxW, boxTop + boxH);
      grad.addColorStop(0, '#ec4899');
      grad.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  const startY = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, idx) => {
    const lineY = startY + idx * lineHeight;
    if (overlay.boxStyle === 'outline') {
      ctx.lineWidth = Math.max(2, scaledFontSize * 0.14);
      ctx.strokeStyle = '#08080b';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, 0, lineY);
    } else if (overlay.boxStyle === 'none') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = Math.round(scaledFontSize * 0.26);
      ctx.shadowOffsetY = Math.round(scaledFontSize * 0.08);
    }

    ctx.fillStyle =
      overlay.boxStyle === 'white-pill' && overlay.color.toLowerCase() === '#ffffff'
        ? '#09090d'
        : overlay.color;
    ctx.fillText(line, 0, lineY);
  });

  const boxCenterX = boxLeft + boxW / 2;
  const stemLen = Math.max(22, 42 * scaleUnit);
  const knobRadius = Math.max(9, 16 * scaleUnit);
  const handleLocalY = boxTop - 6 - stemLen;

  if (hitTargetsOut) {
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    const scaledCenterX = boxCenterX * anim.scale;
    const worldCenterX = anchorX + scaledCenterX * cos;
    const worldCenterY = anchorY + scaledCenterX * sin;

    // Handle sits directly above boxCenterX
    const handleLocalX = boxCenterX * anim.scale;
    const handleOffsetY = handleLocalY * anim.scale;
    const worldHandleX = anchorX + handleLocalX * cos - handleOffsetY * sin;
    const worldHandleY = anchorY + handleLocalX * sin + handleOffsetY * cos;

    // Fallback check uses pure computeRotationHandleCoords when center-aligned
    const fallbackHandle = computeRotationHandleCoords(
      anchorX,
      anchorY,
      handleOffsetY,
      rotationDeg,
    );

    hitTargetsOut.set(overlay.id, {
      id: overlay.id,
      anchorX,
      anchorY,
      centerX: worldCenterX,
      centerY: worldCenterY,
      halfW: (boxW * anim.scale) / 2,
      halfH: (boxH * anim.scale) / 2,
      handleX: overlay.align === 'center' ? fallbackHandle.x : worldHandleX,
      handleY: overlay.align === 'center' ? fallbackHandle.y : worldHandleY,
      rotation: rotationDeg,
    });
  }

  if (isSelected && showSelectionGuide) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = Math.max(1.5, 2.5 * scaleUnit);
    ctx.setLineDash([6, 4]);
    drawRoundedRectPath(ctx, boxLeft - 6, boxTop - 6, boxW + 12, boxH + 12, 10);
    ctx.stroke();

    // Stem + 360° circular rotation knob
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(boxCenterX, boxTop - 6);
    ctx.lineTo(boxCenterX, handleLocalY + knobRadius);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = Math.max(1.5, 2.5 * scaleUnit);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(boxCenterX, handleLocalY, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#121218';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.5 * scaleUnit);
    ctx.strokeStyle = '#ec4899';
    ctx.stroke();

    // Small curved rotation arc glyph inside knob
    ctx.beginPath();
    ctx.arc(boxCenterX, handleLocalY, knobRadius * 0.48, -Math.PI * 0.75, Math.PI * 0.55);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.3, 2 * scaleUnit);
    ctx.stroke();
  }

  ctx.restore();
}

export function getMediaOverlayDrawable(
  overlay: Pick<MediaOverlay, 'id' | 'kind'>,
  asset: MediaAsset | undefined,
  skipSnapshotCache = false,
): {
  drawable?: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  naturalW: number;
  naturalH: number;
} {
  if (!asset) {
    return { naturalW: 1080, naturalH: 1080 };
  }
  if (asset.kind === 'image') {
    const img = mediaCache.images.get(asset.id);
    if (img && img.complete && img.naturalWidth > 0) {
      return { drawable: img, naturalW: img.naturalWidth, naturalH: img.naturalHeight };
    }
    void loadImageElement(asset.id, asset.src);
    return { naturalW: asset.width || 1080, naturalH: asset.height || 1080 };
  }
  const video = getOrCreateVideoElement(`overlay:${overlay.id}`, asset.src);
  const resolved = resolveVideoDrawable(video, skipSnapshotCache);
  if (resolved) {
    const naturalW =
      resolved instanceof HTMLVideoElement
        ? resolved.videoWidth || asset.width || 1080
        : resolved.width || asset.width || 1080;
    const naturalH =
      resolved instanceof HTMLVideoElement
        ? resolved.videoHeight || asset.height || 1080
        : resolved.height || asset.height || 1080;
    return { drawable: resolved, naturalW, naturalH };
  }
  return { naturalW: asset.width || 1080, naturalH: asset.height || 1080 };
}

export function sampleMediaOverlayColorAtNormalized(
  overlay: Pick<MediaOverlay, 'id' | 'kind'>,
  asset: MediaAsset | undefined,
  nx: number,
  ny: number,
): string | null {
  const { drawable, naturalW, naturalH } = getMediaOverlayDrawable(overlay, asset);
  if (!drawable) return null;
  return sampleDrawableHexColor(drawable, naturalW, naturalH, nx, ny);
}

function drawMediaOverlayItem(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: MediaOverlay,
  asset: MediaAsset | undefined,
  timelineTime: number,
  isSelected: boolean,
  showSelectionGuide: boolean,
  chromaPickerActive: boolean,
  chromaMaxDim: number,
  hitTargetsOut?: Map<string, MediaOverlayHitTarget>,
  skipSnapshotCache = false,
  videoFrameOverrides?: Map<string, OverrideVideoFrame>,
) {
  if (!asset || overlay.opacity <= 0.01) return;

  const override = overlay.kind === 'video' ? videoFrameOverrides?.get(`overlay:${overlay.id}`) : undefined;
  const fallback = override
    ? { drawable: undefined, naturalW: override.width, naturalH: override.height }
    : getMediaOverlayDrawable(overlay, asset, skipSnapshotCache);
  const { drawable, naturalW, naturalH } = fallback;
  const { width: boxW, height: boxH } = computeMediaOverlayBoxSize(
    width,
    height,
    naturalW,
    naturalH,
    overlay.scale,
  );
  const halfW = boxW / 2;
  const halfH = boxH / 2;

  const spinDeg = computeMediaOverlaySpinDegrees(overlay, timelineTime);
  const rotationDeg = (overlay.rotation || 0) + spinDeg;
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const scaleUnit = Math.min(width, height) / 1080;

  const centerX = overlay.x * width;
  const centerY = overlay.y * height;

  ctx.save();
  ctx.globalAlpha = clamp(overlay.opacity, 0, 1);
  ctx.translate(centerX, centerY);
  ctx.rotate(rotationRad);

  if (override) {
    if (overlay.chromaKey.enabled) {
      const ovSource = override.asCanvasSource();
      const keyed = ovSource
        ? createChromaKeyedCanvas(
            `ck:${overlay.id}`,
            ovSource as HTMLCanvasElement,
            naturalW,
            naturalH,
            overlay.chromaKey,
            chromaMaxDim,
          )
        : null;
      if (keyed) {
        ctx.drawImage(keyed, -halfW, -halfH, boxW, boxH);
      } else {
        override.draw(ctx, -halfW, -halfH, boxW, boxH);
      }
    } else {
      override.draw(ctx, -halfW, -halfH, boxW, boxH);
    }
  } else if (drawable) {
    let sourceToDraw: CanvasImageSource = drawable;
    if (overlay.chromaKey.enabled) {
      const keyed = createChromaKeyedCanvas(
        `ck:${overlay.id}`,
        drawable,
        naturalW,
        naturalH,
        overlay.chromaKey,
        chromaMaxDim,
      );
      if (keyed) {
        sourceToDraw = keyed;
      }
    }
    ctx.drawImage(sourceToDraw, -halfW, -halfH, boxW, boxH);
  } else {
    ctx.fillStyle = 'rgba(24, 24, 34, 0.85)';
    ctx.fillRect(-halfW, -halfH, boxW, boxH);
  }

  const stemLen = Math.max(24, 46 * scaleUnit);
  const knobRadius = Math.max(12, 20 * scaleUnit);
  const topHandleLocalY = -halfH - 6 - stemLen;
  const bottomHandleLocalY = halfH + 6 + stemLen;

  const topHandleWorld = computeRotationHandleCoords(
    centerX,
    centerY,
    topHandleLocalY,
    rotationDeg,
  );
  const bottomHandleWorld = computeRotationHandleCoords(
    centerX,
    centerY,
    bottomHandleLocalY,
    rotationDeg,
  );
  const topClipped =
    topHandleWorld.y < knobRadius + 8 ||
    topHandleWorld.y > height - knobRadius - 8 ||
    topHandleWorld.x < knobRadius + 8 ||
    topHandleWorld.x > width - knobRadius - 8;
  const bottomInside =
    bottomHandleWorld.y >= knobRadius + 8 &&
    bottomHandleWorld.y <= height - knobRadius - 8 &&
    bottomHandleWorld.x >= knobRadius + 8 &&
    bottomHandleWorld.x <= width - knobRadius - 8;

  const handleSide: 'top' | 'bottom' = topClipped && bottomInside ? 'bottom' : 'top';
  const handleLocalY = handleSide === 'bottom' ? bottomHandleLocalY : topHandleLocalY;
  const activeHandleWorld = handleSide === 'bottom' ? bottomHandleWorld : topHandleWorld;

  const pickerLocalX = (clamp(overlay.chromaKey.pickerX, 0.02, 0.98) - 0.5) * boxW;
  const pickerLocalY = (clamp(overlay.chromaKey.pickerY, 0.02, 0.98) - 0.5) * boxH;

  if (hitTargetsOut) {
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    const toWorld = (lx: number, ly: number) => ({
      x: centerX + lx * cos - ly * sin,
      y: centerY + lx * sin + ly * cos,
    });
    const pickerWorld = toWorld(pickerLocalX, pickerLocalY);
    hitTargetsOut.set(overlay.id, {
      id: overlay.id,
      centerX,
      centerY,
      halfW,
      halfH,
      rotation: rotationDeg,
      handleX: activeHandleWorld.x,
      handleY: activeHandleWorld.y,
      handleSide,
      corners: [
        toWorld(-halfW, -halfH),
        toWorld(halfW, -halfH),
        toWorld(halfW, halfH),
        toWorld(-halfW, halfH),
      ],
      pickerX: pickerWorld.x,
      pickerY: pickerWorld.y,
    });
  }

  if (isSelected && showSelectionGuide) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = Math.max(1.5, 2.5 * scaleUnit);
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-halfW, -halfH, boxW, boxH);
    ctx.setLineDash([]);

    // 4 Corner resize handles
    const cornerSize = Math.max(11, 18 * scaleUnit);
    const cornerPts = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ];
    for (const [cx, cy] of cornerPts) {
      ctx.beginPath();
      ctx.arc(cx, cy, cornerSize * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, 2.2 * scaleUnit);
      ctx.strokeStyle = '#ec4899';
      ctx.stroke();
    }

    // Stem + 360° rotation knob (auto-flips below box if near top edge)
    const stemEdgeY = handleSide === 'bottom' ? halfH : -halfH;
    const stemTipY = handleSide === 'bottom' ? handleLocalY - knobRadius : handleLocalY + knobRadius;
    ctx.beginPath();
    ctx.moveTo(0, stemEdgeY);
    ctx.lineTo(0, stemTipY);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = Math.max(1.5, 2.5 * scaleUnit);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, handleLocalY, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#121218';
    ctx.fill();
    ctx.lineWidth = Math.max(1.8, 2.8 * scaleUnit);
    ctx.strokeStyle = '#ec4899';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, handleLocalY, knobRadius * 0.48, -Math.PI * 0.75, Math.PI * 0.55);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.4, 2.2 * scaleUnit);
    ctx.stroke();

    // Chroma Key Color Picker circular ring reticle inside overlay when active
    if (chromaPickerActive) {
      const outerR = Math.max(24, 48 * scaleUnit);
      const innerR = outerR * 0.72;
      const midR = (outerR + innerR) / 2;
      const bandWidth = Math.max(4, outerR - innerR);

      // Sampled color ring band
      ctx.beginPath();
      ctx.arc(pickerLocalX, pickerLocalY, midR, 0, Math.PI * 2);
      ctx.strokeStyle = overlay.chromaKey.color;
      ctx.lineWidth = bandWidth;
      ctx.stroke();

      // Crisp outer and inner white rims
      ctx.beginPath();
      ctx.arc(pickerLocalX, pickerLocalY, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.8, 2.5 * scaleUnit);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pickerLocalX, pickerLocalY, innerR, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.4, 2 * scaleUnit);
      ctx.stroke();

      // Hollow crystal-clear center sampling hole ("futa") with dual-contrast outline + ticks
      const holeR = Math.max(5, 8 * scaleUnit);
      ctx.beginPath();
      ctx.arc(pickerLocalX, pickerLocalY, holeR + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = Math.max(1.5, 2 * scaleUnit);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pickerLocalX, pickerLocalY, holeR, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, 2.2 * scaleUnit);
      ctx.stroke();

      const tickInner = holeR + 3 * scaleUnit;
      const tickOuter = Math.min(innerR - 3 * scaleUnit, holeR + 10 * scaleUnit);
      if (tickOuter > tickInner) {
        ctx.beginPath();
        ctx.moveTo(pickerLocalX - tickOuter, pickerLocalY);
        ctx.lineTo(pickerLocalX - tickInner, pickerLocalY);
        ctx.moveTo(pickerLocalX + tickInner, pickerLocalY);
        ctx.lineTo(pickerLocalX + tickOuter, pickerLocalY);
        ctx.moveTo(pickerLocalX, pickerLocalY - tickOuter);
        ctx.lineTo(pickerLocalX, pickerLocalY - tickInner);
        ctx.moveTo(pickerLocalX, pickerLocalY + tickInner);
        ctx.lineTo(pickerLocalX, pickerLocalY + tickOuter);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = Math.max(1.3, 2 * scaleUnit);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

export function renderTimelineFrame(opts: RenderFrameOptions): void {
  const {
    ctx,
    width,
    height,
    clips,
    assetsById,
    overlays,
    mediaOverlays = [],
    timelineTime,
    selectedOverlayId,
    selectedMediaOverlayId,
    chromaPickerActive = false,
    chromaTouchPoint = null,
    showSelectionGuide = false,
    chromaMaxDim = 420,
    precomputedSegments,
    skipSnapshotCache = false,
    imageSmoothingQuality = 'medium',
    videoFrameOverrides,
    overlayHitTargetsOut,
    mediaOverlayHitTargetsOut,
  } = opts;

  if (overlayHitTargetsOut) {
    overlayHitTargetsOut.clear();
  }
  if (mediaOverlayHitTargetsOut) {
    mediaOverlayHitTargetsOut.clear();
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = imageSmoothingQuality;
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, width, height);

  const segments = precomputedSegments ?? computeClipSegments(clips);
  const activeSeg = findActiveSegmentAtTime(segments, timelineTime);

  if (!activeSeg) {
    ctx.restore();
    return;
  }

  const prevSeg = activeSeg.index > 0 ? segments[activeSeg.index - 1] : null;
  const localTime = timelineTime - activeSeg.startTime;
  const transDur =
    activeSeg.clip.transitionIn !== 'none' && prevSeg
      ? Math.min(activeSeg.clip.transitionDuration, activeSeg.duration * 0.65, prevSeg.duration * 0.65)
      : 0;

  if (transDur > 0 && localTime < transDur && prevSeg) {
    const t = clamp(localTime / transDur, 0, 1);
    const prevAsset = assetsById.get(prevSeg.clip.assetId);
    const nextAsset = assetsById.get(activeSeg.clip.assetId);

    switch (activeSeg.clip.transitionIn) {
      case 'dissolve': {
        drawClipVisual(ctx, width, height, prevSeg, prevAsset, prevSeg.endTime - 0.01, 1 - t, 0, 1, skipSnapshotCache, videoFrameOverrides, true);
        drawClipVisual(ctx, width, height, activeSeg, nextAsset, timelineTime, t, 0, 1, skipSnapshotCache, videoFrameOverrides, false);
        break;
      }
      case 'fade-black': {
        if (t < 0.5) {
          drawClipVisual(ctx, width, height, prevSeg, prevAsset, prevSeg.endTime - 0.01, 1 - t * 2, 0, 1, skipSnapshotCache, videoFrameOverrides, true);
        } else {
          drawClipVisual(ctx, width, height, activeSeg, nextAsset, timelineTime, (t - 0.5) * 2, 0, 1, skipSnapshotCache, videoFrameOverrides, false);
        }
        break;
      }
      case 'slide-left': {
        const ease = 1 - Math.pow(1 - t, 3);
        drawClipVisual(ctx, width, height, prevSeg, prevAsset, prevSeg.endTime - 0.01, 1, -ease * width, 1, skipSnapshotCache, videoFrameOverrides, true);
        drawClipVisual(ctx, width, height, activeSeg, nextAsset, timelineTime, 1, (1 - ease) * width, 1, skipSnapshotCache, videoFrameOverrides, false);
        break;
      }
      case 'zoom-in': {
        const ease = 1 - Math.pow(1 - t, 3);
        drawClipVisual(ctx, width, height, prevSeg, prevAsset, prevSeg.endTime - 0.01, 1 - ease, 0, 1 + ease * 0.18, skipSnapshotCache, videoFrameOverrides, true);
        drawClipVisual(ctx, width, height, activeSeg, nextAsset, timelineTime, ease, 0, 1.18 - ease * 0.18, skipSnapshotCache, videoFrameOverrides, false);
        break;
      }
      default:
        drawClipVisual(ctx, width, height, activeSeg, nextAsset, timelineTime, 1, 0, 1, skipSnapshotCache, videoFrameOverrides, false);
    }
  } else {
    const asset = assetsById.get(activeSeg.clip.assetId);
    drawClipVisual(ctx, width, height, activeSeg, asset, timelineTime, 1, 0, 1, skipSnapshotCache, videoFrameOverrides, false);
  }

  // Draw active video & photo overlays above main track
  for (const mediaOverlay of mediaOverlays) {
    if (
      timelineTime >= mediaOverlay.startTime &&
      timelineTime <= mediaOverlay.startTime + mediaOverlay.duration
    ) {
      drawMediaOverlayItem(
        ctx,
        width,
        height,
        mediaOverlay,
        assetsById.get(mediaOverlay.assetId),
        timelineTime,
        mediaOverlay.id === selectedMediaOverlayId,
        showSelectionGuide,
        chromaPickerActive && mediaOverlay.id === selectedMediaOverlayId,
        chromaMaxDim,
        mediaOverlayHitTargetsOut,
        skipSnapshotCache,
        videoFrameOverrides,
      );
    }
  }

  // Draw active text overlays on top
  for (const overlay of overlays) {
    if (
      timelineTime >= overlay.startTime &&
      timelineTime <= overlay.startTime + overlay.duration
    ) {
      drawTextOverlayItem(
        ctx,
        width,
        height,
        overlay,
        timelineTime,
        overlay.id === selectedOverlayId,
        showSelectionGuide,
        overlayHitTargetsOut,
      );
    }
  }

  // Draw subtle finger-to-picker tether while dragging Chroma Key picker
  if (
    chromaPickerActive &&
    showSelectionGuide &&
    chromaTouchPoint &&
    selectedMediaOverlayId &&
    mediaOverlayHitTargetsOut
  ) {
    const activeTarget = mediaOverlayHitTargetsOut.get(selectedMediaOverlayId);
    if (activeTarget) {
      const scaleUnit = Math.min(width, height) / 1080;
      ctx.save();
      ctx.setLineDash([4 * scaleUnit, 4 * scaleUnit]);
      ctx.beginPath();
      ctx.moveTo(chromaTouchPoint.x, chromaTouchPoint.y);
      ctx.lineTo(activeTarget.pickerX, activeTarget.pickerY);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.lineWidth = Math.max(1.5, 2 * scaleUnit);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(chromaTouchPoint.x, chromaTouchPoint.y, Math.max(5, 8 * scaleUnit), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, 2 * scaleUnit);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

export function pauseAllCachedVideos(exceptAssetIds?: Set<string>): void {
  for (const [assetId, video] of mediaCache.videos.entries()) {
    if (exceptAssetIds && exceptAssetIds.has(assetId)) continue;
    if (!video.paused) {
      try {
        video.pause();
      } catch {
        // ignore
      }
    }
  }
}

export function primeActiveVideoFromUserGesture(
  clips: TimelineClip[],
  assetsById: Map<string, MediaAsset>,
  timelineTime: number,
  mediaOverlays: MediaOverlay[] = [],
): void {
  const segments = computeClipSegments(clips);
  const activeSeg = findActiveSegmentAtTime(segments, timelineTime);
  if (activeSeg) {
    const asset = assetsById.get(activeSeg.clip.assetId);
    if (asset && asset.kind === 'video') {
      const video = getOrCreateVideoElement(asset.id, asset.src);
      const targetSourceTime = mapTimelineTimeToSourceTime(activeSeg, timelineTime);
      video.playbackRate = activeSeg.clip.speed;
      video.muted = activeSeg.clip.muted;
      video.volume = clamp(activeSeg.clip.volume, 0, 1);

      if (Math.abs(video.currentTime - targetSourceTime) > 0.25 && !video.seeking) {
        try {
          video.currentTime = targetSourceTime;
        } catch {
          // ignore
        }
      }

      if (video.paused) {
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      }
    }
  }

  for (const ov of mediaOverlays) {
    if (
      ov.kind !== 'video' ||
      timelineTime < ov.startTime ||
      timelineTime > ov.startTime + ov.duration
    ) {
      continue;
    }
    const asset = assetsById.get(ov.assetId);
    if (!asset) continue;
    const video = getOrCreateVideoElement(`overlay:${ov.id}`, asset.src);
    video.loop = true;
    video.muted = true;
    const target = computeMediaOverlaySourceTime(ov, timelineTime);
    if (Math.abs(video.currentTime - target) > 0.25 && !video.seeking) {
      try {
        video.currentTime = target;
      } catch {
        // ignore
      }
    }
    if (video.paused) {
      video.play().catch(() => {});
    }
  }
}

const pendingVideoSeekTargets = new WeakMap<HTMLVideoElement, number>();
const pendingVideoSeekListeners = new WeakSet<HTMLVideoElement>();

export async function syncVideoElementsForTime(
  clips: TimelineClip[],
  assetsById: Map<string, MediaAsset>,
  timelineTime: number,
  isPlaying: boolean,
  mediaOverlays: MediaOverlay[] = [],
): Promise<void> {
  const keepPlayingIds = new Set<string>();

  const segments = computeClipSegments(clips);
  const activeSeg = findActiveSegmentAtTime(segments, timelineTime);
  const mainAsset = activeSeg ? assetsById.get(activeSeg.clip.assetId) : undefined;
  if (activeSeg && mainAsset?.kind === 'video') {
    keepPlayingIds.add(mainAsset.id);
  }

  const activeVideoOverlays: Array<{ overlay: MediaOverlay; asset: MediaAsset }> = [];
  for (const ov of mediaOverlays) {
    if (
      ov.kind === 'video' &&
      timelineTime >= ov.startTime &&
      timelineTime <= ov.startTime + ov.duration
    ) {
      const ovAsset = assetsById.get(ov.assetId);
      if (ovAsset) {
        keepPlayingIds.add(`overlay:${ov.id}`);
        activeVideoOverlays.push({ overlay: ov, asset: ovAsset });
      }
    }
  }

  pauseAllCachedVideos(keepPlayingIds);

  const syncSingleVideo = async (
    video: HTMLVideoElement,
    targetSourceTime: number,
    playbackRate: number,
    muted: boolean,
    volume: number,
    loop: boolean,
  ) => {
    video.loop = loop;
    video.playbackRate = playbackRate;
    if (!video.muted || !isPlaying) {
      video.muted = muted;
    }
    video.volume = clamp(volume, 0, 1);

    const driftThreshold = isPlaying ? 1.25 : 0.03;
    const needsSeek = Math.abs(video.currentTime - targetSourceTime) > driftThreshold;

    if (needsSeek) {
      if (video.seeking) {
        pendingVideoSeekTargets.set(video, targetSourceTime);
        if (!pendingVideoSeekListeners.has(video)) {
          pendingVideoSeekListeners.add(video);
          const flushPendingSeek = () => {
            const queued = pendingVideoSeekTargets.get(video);
            pendingVideoSeekTargets.delete(video);
            if (queued !== undefined && Math.abs(video.currentTime - queued) > 0.03 && !video.seeking) {
              try {
                video.currentTime = queued;
              } catch {
                // ignore
              }
            }
          };
          video.addEventListener('seeked', flushPendingSeek, { once: true });
          const cleanupOnListener = () => pendingVideoSeekListeners.delete(video);
          video.addEventListener('seeked', cleanupOnListener, { once: true });
        }
      } else {
        pendingVideoSeekTargets.delete(video);
        try {
          video.currentTime = targetSourceTime;
        } catch {
          // ignore
        }
      }
    }

    if (isPlaying && video.paused) {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  };

  if (activeSeg && mainAsset?.kind === 'video') {
    const mainVideo = getOrCreateVideoElement(mainAsset.id, mainAsset.src);
    await syncSingleVideo(
      mainVideo,
      mapTimelineTimeToSourceTime(activeSeg, timelineTime),
      activeSeg.clip.speed,
      activeSeg.clip.muted,
      activeSeg.clip.volume,
      false,
    );
  }

  for (const { overlay, asset } of activeVideoOverlays) {
    const ovVideo = getOrCreateVideoElement(`overlay:${overlay.id}`, asset.src);
    await syncSingleVideo(
      ovVideo,
      computeMediaOverlaySourceTime(overlay, timelineTime),
      1,
      true,
      0,
      true,
    );
  }
}
