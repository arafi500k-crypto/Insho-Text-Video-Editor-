import type {
  AspectRatioPreset,
  ClipCrop,
  ClipFilter,
  ExportResolution,
  FilterPresetId,
  MediaOverlay,
  MediaOverlayChromaKey,
  TextOverlay,
  TimelineClip,
  TimelineSegment,
} from '../types/editor';

export const MIN_CLIP_TRIM_DURATION = 0.25;

export const DEFAULT_CLIP_FILTER: ClipFilter = {
  preset: 'original',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  blur: 0,
};

export const DEFAULT_CLIP_CROP: ClipCrop = {
  fit: 'contain',
  zoom: 1,
  panX: 0,
  panY: 0,
};

export interface FilterPresetMeta {
  id: FilterPresetId;
  label: string;
  swatchGradient: string;
  filter: ClipFilter;
}

export const FILTER_PRESETS: FilterPresetMeta[] = [
  {
    id: 'original',
    label: 'Original',
    swatchGradient: 'from-zinc-700 to-zinc-900',
    filter: { ...DEFAULT_CLIP_FILTER },
  },
  {
    id: 'vivid',
    label: 'Vivid',
    swatchGradient: 'from-pink-500 to-amber-400',
    filter: {
      preset: 'vivid',
      brightness: 106,
      contrast: 116,
      saturation: 138,
      warmth: 0,
      blur: 0,
    },
  },
  {
    id: 'noir',
    label: 'Noir',
    swatchGradient: 'from-zinc-200 to-zinc-950',
    filter: {
      preset: 'noir',
      brightness: 98,
      contrast: 128,
      saturation: 0,
      warmth: 0,
      blur: 0,
    },
  },
  {
    id: 'cyber-pink',
    label: 'Cyber Pink',
    swatchGradient: 'from-pink-500 to-fuchsia-700',
    filter: {
      preset: 'cyber-pink',
      brightness: 104,
      contrast: 122,
      saturation: 152,
      warmth: 12,
      blur: 0,
    },
  },
  {
    id: 'amethyst',
    label: 'Amethyst',
    swatchGradient: 'from-violet-500 to-indigo-900',
    filter: {
      preset: 'amethyst',
      brightness: 96,
      contrast: 114,
      saturation: 120,
      warmth: 6,
      blur: 0,
    },
  },
  {
    id: 'warm-film',
    label: 'Warm Film',
    swatchGradient: 'from-amber-500 to-rose-700',
    filter: {
      preset: 'warm-film',
      brightness: 103,
      contrast: 108,
      saturation: 112,
      warmth: 32,
      blur: 0,
    },
  },
  {
    id: 'cool-crisp',
    label: 'Cool Crisp',
    swatchGradient: 'from-cyan-400 to-slate-800',
    filter: {
      preset: 'cool-crisp',
      brightness: 105,
      contrast: 115,
      saturation: 92,
      warmth: 0,
      blur: 0,
    },
  },
  {
    id: 'vintage',
    label: 'Vintage',
    swatchGradient: 'from-stone-400 to-stone-800',
    filter: {
      preset: 'vintage',
      brightness: 95,
      contrast: 92,
      saturation: 74,
      warmth: 44,
      blur: 0,
    },
  },
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampNormalized(value: number): number {
  return clamp(value, 0, 1);
}

export function getClipDuration(clip: TimelineClip): number {
  const sourceSpan = Math.max(0.05, clip.trimEnd - clip.trimStart);
  const speed = clamp(clip.speed, 0.25, 4);
  return sourceSpan / speed;
}

export function computeClipSegments(clips: TimelineClip[]): TimelineSegment[] {
  let cursor = 0;
  return clips.map((clip, index) => {
    const duration = getClipDuration(clip);
    const segment: TimelineSegment = {
      clip,
      index,
      startTime: cursor,
      endTime: cursor + duration,
      duration,
    };
    cursor += duration;
    return segment;
  });
}

export function getTotalTimelineDuration(clips: TimelineClip[]): number {
  return clips.reduce((acc, clip) => acc + getClipDuration(clip), 0);
}

export function findActiveSegmentAtTime(
  segments: TimelineSegment[],
  timelineTime: number,
): TimelineSegment | null {
  if (segments.length === 0) return null;
  const clampedTime = Math.max(0, timelineTime);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (clampedTime < seg.endTime || i === segments.length - 1) {
      return seg;
    }
  }
  return segments[segments.length - 1];
}

export function mapTimelineTimeToSourceTime(
  segment: TimelineSegment,
  timelineTime: number,
): number {
  const localTimelineTime = clamp(timelineTime - segment.startTime, 0, segment.duration);
  const sourceTime = segment.clip.trimStart + localTimelineTime * segment.clip.speed;
  return clamp(sourceTime, segment.clip.trimStart, segment.clip.trimEnd);
}

export function trimClipBounds(
  clip: TimelineClip,
  requestedStart: number,
  requestedEnd: number,
): { trimStart: number; trimEnd: number } {
  const maxDur = Math.max(MIN_CLIP_TRIM_DURATION, clip.sourceDuration);
  let trimStart = clamp(requestedStart, 0, maxDur - MIN_CLIP_TRIM_DURATION);
  let trimEnd = clamp(requestedEnd, trimStart + MIN_CLIP_TRIM_DURATION, maxDur);
  if (trimEnd - trimStart < MIN_CLIP_TRIM_DURATION) {
    trimStart = Math.max(0, trimEnd - MIN_CLIP_TRIM_DURATION);
  }
  return {
    trimStart: Number(trimStart.toFixed(2)),
    trimEnd: Number(trimEnd.toFixed(2)),
  };
}

export function splitClipAtTime(
  clips: TimelineClip[],
  clipId: string,
  timelineTime: number,
  createId: () => string,
): TimelineClip[] | null {
  const segments = computeClipSegments(clips);
  const seg = segments.find((s) => s.clip.id === clipId);
  if (!seg) return null;

  const minTimelineEdge = MIN_CLIP_TRIM_DURATION / seg.clip.speed;
  const localOffset = timelineTime - seg.startTime;
  if (localOffset <= minTimelineEdge || seg.duration - localOffset <= minTimelineEdge) {
    return null;
  }

  const splitSourcePoint = Number(
    (seg.clip.trimStart + localOffset * seg.clip.speed).toFixed(2),
  );

  const firstHalf: TimelineClip = {
    ...seg.clip,
    trimEnd: splitSourcePoint,
  };

  const secondHalf: TimelineClip = {
    ...seg.clip,
    id: createId(),
    label: `${seg.clip.label} (2)`,
    trimStart: splitSourcePoint,
    transitionIn: 'none',
  };

  const next = [...clips];
  next.splice(seg.index, 1, firstHalf, secondHalf);
  return next;
}

export function reorderClip(
  clips: TimelineClip[],
  clipId: string,
  direction: 'left' | 'right',
): TimelineClip[] {
  const index = clips.findIndex((c) => c.id === clipId);
  if (index === -1) return clips;
  const targetIndex = direction === 'left' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= clips.length) return clips;
  const next = [...clips];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${mm}:${ss}.${tenths}`;
}

export function getExportDimensions(
  aspect: AspectRatioPreset,
  resolution: ExportResolution,
): { width: number; height: number } {
  const shortSide = resolution === '1080p' ? 1080 : resolution === '480p' ? 480 : 720;
  let width: number;
  let height: number;

  switch (aspect) {
    case '9:16':
      width = shortSide;
      height = Math.round((shortSide * 16) / 9);
      break;
    case '16:9':
      height = shortSide;
      width = Math.round((shortSide * 16) / 9);
      break;
    case '1:1':
      width = shortSide;
      height = shortSide;
      break;
    case '4:5':
      width = shortSide;
      height = Math.round((shortSide * 5) / 4);
      break;
  }

  // Ensure even pixel dimensions for H.264/VP9 encoders
  return {
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1,
  };
}

export function buildCssFilterString(filter: ClipFilter): string {
  const parts: string[] = [];
  if (filter.brightness !== 100) parts.push(`brightness(${filter.brightness}%)`);
  if (filter.contrast !== 100) parts.push(`contrast(${filter.contrast}%)`);
  if (filter.saturation !== 100) parts.push(`saturate(${filter.saturation}%)`);
  if (filter.warmth > 0) parts.push(`sepia(${filter.warmth}%)`);
  if (filter.blur > 0) parts.push(`blur(${filter.blur}px)`);
  if (filter.preset === 'cyber-pink') {
    parts.push('hue-rotate(-10deg)');
  } else if (filter.preset === 'amethyst') {
    parts.push('hue-rotate(16deg)');
  } else if (filter.preset === 'cool-crisp') {
    parts.push('hue-rotate(6deg)');
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

export function computeTextAnimationState(
  overlay: TextOverlay,
  timelineTime: number,
): { opacity: number; scale: number; offsetY: number; rotationDeg: number } {
  const elapsed = timelineTime - overlay.startTime;
  const remaining = overlay.startTime + overlay.duration - timelineTime;
  const animWindow = Math.min(0.35, overlay.duration * 0.25);

  if (overlay.animation === 'spin-360') {
    const safeElapsed = clamp(elapsed, 0, Math.max(0, overlay.duration));
    const speed = clamp(overlay.spinSpeed ?? 1, 0.25, 4);
    const dir = overlay.spinDirection === 'ccw' ? -1 : 1;
    const rotationDeg = dir * safeElapsed * 180 * speed;
    return { opacity: overlay.opacity, scale: 1, offsetY: 0, rotationDeg };
  }

  if (overlay.animation === 'none' || animWindow <= 0) {
    return { opacity: overlay.opacity, scale: 1, offsetY: 0, rotationDeg: 0 };
  }

  const enterProgress = clamp(elapsed / animWindow, 0, 1);
  const exitProgress = clamp(remaining / animWindow, 0, 1);
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  if (overlay.animation === 'fade') {
    const fadeFactor = Math.min(ease(enterProgress), ease(exitProgress));
    return {
      opacity: overlay.opacity * (0.25 + 0.75 * fadeFactor),
      scale: 1,
      offsetY: 0,
      rotationDeg: 0,
    };
  }

  if (overlay.animation === 'pop') {
    const p = ease(enterProgress);
    const scale = 0.78 + 0.22 * p;
    const fadeFactor = Math.min(0.45 + 0.55 * p, ease(exitProgress));
    return { opacity: overlay.opacity * fadeFactor, scale, offsetY: 0, rotationDeg: 0 };
  }

  // slide-up
  const p = ease(enterProgress);
  const offsetY = (1 - p) * 28;
  const fadeFactor = Math.min(0.45 + 0.55 * p, ease(exitProgress));
  return { opacity: overlay.opacity * fadeFactor, scale: 1, offsetY, rotationDeg: 0 };
}

export function normalizeRotationDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = ((Math.round(deg) % 360) + 360) % 360;
  return mod;
}

export function computeRotationAngleDegrees(
  anchorX: number,
  anchorY: number,
  pointerX: number,
  pointerY: number,
): number {
  const dx = pointerX - anchorX;
  const dy = pointerY - anchorY;
  if (Math.hypot(dx, dy) < 1e-4) return 0;
  // Top-center rotation knob sits at -90 deg in standard atan2 coordinates
  const rawDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return normalizeRotationDegrees(rawDeg);
}

export function computeRotationHandleCoords(
  anchorX: number,
  anchorY: number,
  localOffsetY: number,
  rotationDeg: number,
): { x: number; y: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    x: anchorX - localOffsetY * Math.sin(rad),
    y: anchorY + localOffsetY * Math.cos(rad),
  };
}

export function isPointInRotatedRect(
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  halfW: number,
  halfH: number,
  rotationDeg: number,
): boolean {
  const rad = (-rotationDeg * Math.PI) / 180;
  const dx = px - centerX;
  const dy = py - centerY;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(localX) <= halfW && Math.abs(localY) <= halfH;
}

export const MIN_OVERLAY_DURATION = 0.4;

function roundTimelineSec(value: number): number {
  return Number(value.toFixed(2));
}

export function moveOverlayTiming(
  overlay: Pick<TextOverlay, 'startTime' | 'duration'>,
  deltaSec: number,
  maxTimelineDuration: number,
): { startTime: number; duration: number } {
  const safeMax = Math.max(MIN_OVERLAY_DURATION, maxTimelineDuration);
  const clampedDuration = clamp(overlay.duration, MIN_OVERLAY_DURATION, safeMax);
  const maxStart = Math.max(0, safeMax - clampedDuration);
  const nextStart = clamp(overlay.startTime + deltaSec, 0, maxStart);
  return {
    startTime: roundTimelineSec(nextStart),
    duration: roundTimelineSec(clampedDuration),
  };
}

export function trimOverlayStartTiming(
  overlay: Pick<TextOverlay, 'startTime' | 'duration'>,
  deltaSec: number,
): { startTime: number; duration: number } {
  const endTime = overlay.startTime + overlay.duration;
  const maxStart = Math.max(0, endTime - MIN_OVERLAY_DURATION);
  const nextStart = clamp(overlay.startTime + deltaSec, 0, maxStart);
  const nextDuration = Math.max(MIN_OVERLAY_DURATION, endTime - nextStart);
  return {
    startTime: roundTimelineSec(nextStart),
    duration: roundTimelineSec(nextDuration),
  };
}

export function trimOverlayEndTiming(
  overlay: Pick<TextOverlay, 'startTime' | 'duration'>,
  deltaSec: number,
  maxTimelineDuration: number,
): { startTime: number; duration: number } {
  const safeMax = Math.max(overlay.startTime + MIN_OVERLAY_DURATION, maxTimelineDuration);
  const maxDuration = Math.max(MIN_OVERLAY_DURATION, safeMax - overlay.startTime);
  const nextDuration = clamp(overlay.duration + deltaSec, MIN_OVERLAY_DURATION, maxDuration);
  return {
    startTime: roundTimelineSec(overlay.startTime),
    duration: roundTimelineSec(nextDuration),
  };
}

export function timelineTimeToScrollLeft(
  timeSec: number,
  zoomPxPerSec: number,
  totalDuration: number,
): number {
  const safeMax = Math.max(0, totalDuration);
  const safeTime = clamp(Number.isFinite(timeSec) ? timeSec : 0, 0, safeMax);
  return safeTime * Math.max(1, zoomPxPerSec);
}

export function scrollLeftToTimelineTime(
  scrollLeft: number,
  zoomPxPerSec: number,
  totalDuration: number,
): number {
  const safeMax = Math.max(0, totalDuration);
  const pxPerSec = Math.max(1, zoomPxPerSec);
  const raw = Math.max(0, Number.isFinite(scrollLeft) ? scrollLeft : 0) / pxPerSec;
  return Number(clamp(raw, 0, safeMax).toFixed(3));
}

export function deriveTimelineTimeFromVideo(
  segment: TimelineSegment,
  videoCurrentTime: number,
): number {
  const speed = clamp(segment.clip.speed, 0.25, 4);
  const localSource = clamp(
    videoCurrentTime,
    segment.clip.trimStart,
    segment.clip.trimEnd,
  ) - segment.clip.trimStart;
  const derived = segment.startTime + localSource / speed;
  return clamp(derived, segment.startTime, segment.endTime);
}

export function pickBestAspectRatioForAsset(
  width: number,
  height: number,
): AspectRatioPreset {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '9:16';
  }
  const ratio = width / height;
  if (ratio >= 1.25) return '16:9';
  if (ratio >= 0.9) return '1:1';
  if (ratio >= 0.72) return '4:5';
  return '9:16';
}

export function fitBoxToBounds(
  availWidth: number,
  availHeight: number,
  targetAspectRatio: number,
): { width: number; height: number } {
  const w = Math.max(1, availWidth);
  const h = Math.max(1, availHeight);
  const ar = Math.max(0.1, targetAspectRatio);
  if (w / h > ar) {
    const fittedH = Math.floor(h);
    return { width: Math.max(1, Math.floor(fittedH * ar)), height: fittedH };
  }
  const fittedW = Math.floor(w);
  return { width: fittedW, height: Math.max(1, Math.floor(fittedW / ar)) };
}

export const DEFAULT_CHROMA_KEY: MediaOverlayChromaKey = {
  enabled: false,
  color: '#00d25b',
  similarity: 38,
  smoothness: 18,
  shadow: 0,
  edgeCleanup: 0,
  pickerX: 0.2,
  pickerY: 0.2,
};

export function computeMediaOverlaySpinDegrees(
  overlay: Pick<MediaOverlay, 'startTime' | 'spinEnabled' | 'spinSpeed' | 'spinDirection'>,
  timelineTime: number,
): number {
  if (!overlay.spinEnabled) return 0;
  const elapsed = Math.max(0, timelineTime - overlay.startTime);
  const speed = clamp(overlay.spinSpeed ?? 1, 0.25, 4);
  const dir = overlay.spinDirection === 'ccw' ? -1 : 1;
  return dir * elapsed * 180 * speed;
}

export function computeMediaOverlaySourceTime(
  overlay: Pick<MediaOverlay, 'startTime' | 'sourceDuration'>,
  timelineTime: number,
): number {
  const elapsed = Math.max(0, timelineTime - overlay.startTime);
  const srcDur = Math.max(0.2, overlay.sourceDuration || 1);
  return elapsed % srcDur;
}

export function computeMediaOverlayBoxSize(
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  scale: number,
): { width: number; height: number } {
  const safeScale = clamp(scale, 0.12, 1.8);
  const baseSide = Math.min(canvasWidth, canvasHeight) * safeScale;
  const natW = Math.max(1, naturalWidth);
  const natH = Math.max(1, naturalHeight);
  const aspect = natW / natH;
  if (aspect >= 1) {
    return {
      width: Math.max(24, baseSide),
      height: Math.max(24, baseSide / aspect),
    };
  }
  return {
    width: Math.max(24, baseSide * aspect),
    height: Math.max(24, baseSide),
  };
}

export function canvasPointToOverlayNormalized(
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  halfW: number,
  halfH: number,
  rotationDeg: number,
): { nx: number; ny: number } {
  const rad = (-rotationDeg * Math.PI) / 180;
  const dx = px - centerX;
  const dy = py - centerY;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
  return {
    nx: Number(clamp(0.5 + localX / Math.max(1, halfW * 2), 0.02, 0.98).toFixed(4)),
    ny: Number(clamp(0.5 + localY / Math.max(1, halfH * 2), 0.02, 0.98).toFixed(4)),
  };
}

export function computePinchRotateTransform(opts: {
  startX: number;
  startY: number;
  startScale: number;
  startRotation: number;
  startMidNx: number;
  startMidNy: number;
  currentMidNx: number;
  currentMidNy: number;
  startDist: number;
  currentDist: number;
  startAngleRad: number;
  currentAngleRad: number;
  minScale?: number;
  maxScale?: number;
}): { x: number; y: number; scale: number; rotation: number } {
  const minS = opts.minScale ?? 0.15;
  const maxS = opts.maxScale ?? 1.6;
  const ratio = opts.currentDist / Math.max(12, opts.startDist);
  const scale = Number(clamp(opts.startScale * ratio, minS, maxS).toFixed(2));
  const deltaDeg = ((opts.currentAngleRad - opts.startAngleRad) * 180) / Math.PI;
  const rotation = normalizeRotationDegrees(opts.startRotation + deltaDeg);
  const x = Number(clampNormalized(opts.startX + (opts.currentMidNx - opts.startMidNx)).toFixed(3));
  const y = Number(clampNormalized(opts.startY + (opts.currentMidNy - opts.startMidNy)).toFixed(3));
  return { x, y, scale, rotation };
}

/**
 * Offsets the Chroma Key sampling hole ("dot") slightly above-left of the finger touch point
 * so the user's fingertip never covers the target pixel while dragging on mobile.
 */
export function computeChromaPickerTouchPoint(
  touchCanvasX: number,
  touchCanvasY: number,
  scaleFactor: number,
  offsetCssX = -26,
  offsetCssY = -34,
): { x: number; y: number } {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: touchCanvasX + offsetCssX * safeScale,
    y: touchCanvasY + offsetCssY * safeScale,
  };
}

/**
 * Computes horizontal auto-scroll velocity (px/sec) when a pointer is held near
 * the left or right edge of the timeline scroll viewport during a trim/move drag.
 */
export function computeEdgeAutoScrollVelocity(
  clientX: number,
  rectLeft: number,
  rectRight: number,
  edgeThresholdPx = 56,
  maxSpeedPxPerSec = 360,
): number {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(rectLeft) ||
    !Number.isFinite(rectRight) ||
    rectRight <= rectLeft ||
    edgeThresholdPx <= 0 ||
    maxSpeedPxPerSec <= 0
  ) {
    return 0;
  }

  const width = rectRight - rectLeft;
  const threshold = Math.min(edgeThresholdPx, width * 0.25);
  if (threshold <= 0) return 0;

  const distFromLeft = clientX - rectLeft;
  if (distFromLeft < threshold) {
    const ratio = clamp((threshold - distFromLeft) / threshold, 0, 1.35);
    const eased = Math.pow(Math.min(1.25, ratio), 1.25);
    return -Number((maxSpeedPxPerSec * Math.max(0.18, eased)).toFixed(2));
  }

  const distFromRight = rectRight - clientX;
  if (distFromRight < threshold) {
    const ratio = clamp((threshold - distFromRight) / threshold, 0, 1.35);
    const eased = Math.pow(Math.min(1.25, ratio), 1.25);
    return Number((maxSpeedPxPerSec * Math.max(0.18, eased)).toFixed(2));
  }

  return 0;
}

/**
 * Converts pointer delta + accumulated horizontal scroll delta into timeline seconds
 * so holding a trim/move handle stationary at the viewport edge continues extending duration.
 */
export function computeTrackDragDeltaSeconds(
  startClientX: number,
  currentClientX: number,
  origScrollLeft: number,
  currentScrollLeft: number,
  zoomPxPerSec: number,
): number {
  const pxPerSec = Math.max(1, Number.isFinite(zoomPxPerSec) ? zoomPxPerSec : 1);
  const pointerDelta = Number.isFinite(currentClientX - startClientX)
    ? currentClientX - startClientX
    : 0;
  const scrollDelta = Number.isFinite(currentScrollLeft - origScrollLeft)
    ? currentScrollLeft - origScrollLeft
    : 0;
  return (pointerDelta + scrollDelta) / pxPerSec;
}

/**
 * Prevents live playback clock from racing ahead into blank/black frames when an active
 * video element is buffering, seeking, or unexpectedly paused by the mobile browser.
 */
export function shouldHoldPlayheadForVideo(state: {
  readyState: number;
  seeking: boolean;
  ended: boolean;
  paused: boolean;
  currentTime: number;
  trimEnd: number;
}): { holdClock: boolean; needsResumePlay: boolean } {
  if (state.seeking || state.readyState < 2) {
    return { holdClock: true, needsResumePlay: false };
  }
  const nearTrimEnd = state.currentTime >= Math.max(0, state.trimEnd - 0.04);
  if (state.paused && !state.ended && !nearTrimEnd) {
    return { holdClock: true, needsResumePlay: true };
  }
  return { holdClock: false, needsResumePlay: false };
}
