import { useEffect, useRef, useState } from 'react';
import {
  Film,
  Pause,
  Play,
  Plus,
  Repeat,
  Scissors,
  SkipBack,
  Sparkles,
  Type,
} from 'lucide-react';
import type {
  AspectRatioPreset,
  MediaAsset,
  MediaOverlay,
  TextOverlay,
  TimelineClip,
} from '../types/editor';
import {
  renderTimelineFrame,
  sampleMediaOverlayColorAtNormalized,
  type MediaOverlayHitTarget,
  type OverlayHitTarget,
} from '../utils/canvasRenderer';
import { getOrCreateVideoElement } from '../utils/mediaLoader';
import {
  canvasPointToOverlayNormalized,
  clamp,
  clampNormalized,
  computeChromaPickerTouchPoint,
  computePinchRotateTransform,
  computeRotationAngleDegrees,
  fitBoxToBounds,
  formatTimecode,
  isPointInRotatedRect,
  normalizeRotationDegrees,
} from '../utils/timeline';

interface PreviewPlayerProps {
  clips: TimelineClip[];
  assetsById: Map<string, MediaAsset>;
  overlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  aspectRatio: AspectRatioPreset;
  currentTime: number;
  getLiveTime?: () => number;
  totalDuration: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  selectedOverlayId: string | null;
  selectedMediaOverlayId: string | null;
  chromaPickerActive: boolean;
  pausedForExport?: boolean;
  canSplit: boolean;
  onTogglePlay: () => void;
  onSeekStart: () => void;
  onToggleLoop: () => void;
  onSplitAtPlayhead: () => void;
  onQuickAddText: () => void;
  onSelectOverlay: (id: string | null) => void;
  onMoveOverlay: (id: string, x: number, y: number) => void;
  onRotateOverlay: (id: string, rotation: number) => void;
  onSelectMediaOverlay: (id: string | null) => void;
  onMoveMediaOverlay: (id: string, x: number, y: number) => void;
  onScaleMediaOverlay: (id: string, scale: number) => void;
  onRotateMediaOverlay: (id: string, rotation: number) => void;
  onPickChromaKeyColor: (id: string, pickerX: number, pickerY: number, color: string) => void;
  onTriggerImport: () => void;
  onLoadSampleProject: () => void;
}

function getPreviewCanvasDimensions(aspect: AspectRatioPreset): { width: number; height: number } {
  switch (aspect) {
    case '9:16':
      return { width: 540, height: 960 };
    case '16:9':
      return { width: 960, height: 540 };
    case '1:1':
      return { width: 720, height: 720 };
    case '4:5':
      return { width: 640, height: 800 };
  }
}

export function PreviewPlayer({
  clips,
  assetsById,
  overlays,
  mediaOverlays,
  aspectRatio,
  currentTime,
  getLiveTime,
  totalDuration,
  isPlaying,
  loopEnabled,
  selectedOverlayId,
  selectedMediaOverlayId,
  chromaPickerActive,
  pausedForExport = false,
  canSplit,
  onTogglePlay,
  onSeekStart,
  onToggleLoop,
  onSplitAtPlayhead,
  onQuickAddText,
  onSelectOverlay,
  onMoveOverlay,
  onRotateOverlay,
  onSelectMediaOverlay,
  onMoveMediaOverlay,
  onScaleMediaOverlay,
  onRotateMediaOverlay,
  onPickChromaKeyColor,
  onTriggerImport,
  onLoadSampleProject,
}: PreviewPlayerProps) {
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayHitTargetsRef = useRef<Map<string, OverlayHitTarget>>(new Map());
  const mediaOverlayHitTargetsRef = useRef<Map<string, MediaOverlayHitTarget>>(new Map());
  const dragInteractionRef = useRef<{
    targetType: 'text' | 'media';
    id: string;
    mode: 'move' | 'rotate' | 'resize' | 'chroma-pick';
    anchorX: number;
    anchorY: number;
    offsetNx?: number;
    offsetNy?: number;
    handleSide?: 'top' | 'bottom';
    startDist?: number;
    startScale?: number;
  } | null>(null);
  const activePointersRef = useRef<
    Map<number, { cx: number; cy: number; nx: number; ny: number }>
  >(new Map());
  const pinchInteractionRef = useRef<{
    targetType: 'text' | 'media';
    id: string;
    startX: number;
    startY: number;
    startScale: number;
    startRotation: number;
    startMidNx: number;
    startMidNy: number;
    startDist: number;
    startAngleRad: number;
  } | null>(null);
  const [activeAngleReadout, setActiveAngleReadout] = useState<number | null>(null);
  const [activeScaleReadout, setActiveScaleReadout] = useState<number | null>(null);
  const [activeChromaReadout, setActiveChromaReadout] = useState<string | null>(null);
  const [stageBounds, setStageBounds] = useState<{ width: number; height: number } | null>(null);
  const chromaTouchPointRef = useRef<{ x: number; y: number } | null>(null);
  const chromaPickRafRef = useRef<number | null>(null);
  const pendingChromaPickRef = useRef<{
    mediaOv: MediaOverlay;
    target: MediaOverlayHitTarget;
    touchCx: number;
    touchCy: number;
    scaleFactor: number;
  } | null>(null);

  const dims = getPreviewCanvasDimensions(aspectRatio);
  const renderLatestRef = useRef<() => void>(() => {});
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  renderLatestRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderTime = isPlaying && getLiveTime ? getLiveTime() : currentTime;

    renderTimelineFrame({
      ctx,
      width: dims.width,
      height: dims.height,
      clips,
      assetsById,
      overlays,
      mediaOverlays,
      timelineTime: renderTime,
      selectedOverlayId,
      selectedMediaOverlayId,
      chromaPickerActive,
      chromaTouchPoint: chromaTouchPointRef.current,
      showSelectionGuide: !isPlaying,
      chromaMaxDim: 260,
      overlayHitTargetsOut: overlayHitTargetsRef.current,
      mediaOverlayHitTargetsOut: mediaOverlayHitTargetsRef.current,
    });
  };

  // Re-render frame whenever paused state changes; while playing or exporting, avoid redundant redraws
  useEffect(() => {
    if (isPlaying || pausedForExport) return;
    renderLatestRef.current();
  }, [
    clips,
    assetsById,
    overlays,
    mediaOverlays,
    currentTime,
    dims.width,
    dims.height,
    selectedOverlayId,
    selectedMediaOverlayId,
    chromaPickerActive,
    isPlaying,
    pausedForExport,
  ]);

  // Repaint immediately when any active video clip or video overlay decodes, seeks, or plays
  const videoAssetsKey = [
    ...clips.filter((c) => c.kind === 'video').map((c) => c.assetId),
    ...mediaOverlays.filter((m) => m.kind === 'video').map((m) => `${m.id}:${m.assetId}`),
  ].join(',');

  useEffect(() => {
    if (pausedForExport) return;
    const videos: HTMLVideoElement[] = [];
    for (const clip of clips) {
      if (clip.kind !== 'video') continue;
      const asset = assetsById.get(clip.assetId);
      if (asset) {
        videos.push(getOrCreateVideoElement(asset.id, asset.src));
      }
    }
    for (const ov of mediaOverlays) {
      if (ov.kind !== 'video') continue;
      const asset = assetsById.get(ov.assetId);
      if (asset) {
        videos.push(getOrCreateVideoElement(`overlay:${ov.id}`, asset.src));
      }
    }
    if (videos.length === 0) return;

    const handleFrameReady = () => {
      if (!isPlayingRef.current) {
        renderLatestRef.current();
      }
    };
    const events = ['loadeddata', 'canplay', 'canplaythrough', 'seeked', 'playing'] as const;
    for (const v of videos) {
      for (const ev of events) {
        v.addEventListener(ev, handleFrameReady);
      }
    }
    return () => {
      for (const v of videos) {
        for (const ev of events) {
          v.removeEventListener(ev, handleFrameReady);
        }
      }
    };
  }, [videoAssetsKey, clips, mediaOverlays, assetsById, pausedForExport]);

  // Keep canvas painted at display refresh rate while playing (single render per RAF tick)
  useEffect(() => {
    if (!isPlaying || pausedForExport) return;
    let rafId = 0;
    const paintLoop = () => {
      renderLatestRef.current();
      rafId = window.requestAnimationFrame(paintLoop);
    };
    renderLatestRef.current();
    rafId = window.requestAnimationFrame(paintLoop);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, pausedForExport]);

  useEffect(() => {
    return () => {
      if (chromaPickRafRef.current !== null) {
        window.cancelAnimationFrame(chromaPickRafRef.current);
        chromaPickRafRef.current = null;
      }
    };
  }, []);

  // Observe preview wrapper size so the canvas box fits 100% cleanly without clipping
  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageBounds({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clips.length]);

  const activeOverlays = overlays.filter(
    (o) => currentTime >= o.startTime && currentTime <= o.startTime + o.duration,
  );
  const activeMediaOverlays = mediaOverlays.filter(
    (m) => currentTime >= m.startTime && currentTime <= m.startTime + m.duration,
  );

  const clientToCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { cx: 0, cy: 0, nx: 0, ny: 0, scaleFactor: 1 };
    const rect = canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    const cx = nx * dims.width;
    const cy = ny * dims.height;
    const scaleFactor = dims.width / Math.max(1, rect.width);
    return { cx, cy, nx, ny, scaleFactor };
  };

  const applyChromaPick = (
    mediaOv: MediaOverlay,
    target: MediaOverlayHitTarget,
    touchCx: number,
    touchCy: number,
    scaleFactor: number,
  ) => {
    const dotPt = computeChromaPickerTouchPoint(touchCx, touchCy, scaleFactor);
    chromaTouchPointRef.current = { x: touchCx, y: touchCy };
    const { nx, ny } = canvasPointToOverlayNormalized(
      dotPt.x,
      dotPt.y,
      target.centerX,
      target.centerY,
      target.halfW,
      target.halfH,
      target.rotation,
    );
    const asset = assetsById.get(mediaOv.assetId);
    const sampled =
      sampleMediaOverlayColorAtNormalized(mediaOv, asset, nx, ny) ??
      mediaOv.chromaKey.color;
    setActiveChromaReadout(sampled);
    onPickChromaKeyColor(mediaOv.id, nx, ny, sampled);
  };

  const scheduleChromaPick = (
    mediaOv: MediaOverlay,
    target: MediaOverlayHitTarget,
    touchCx: number,
    touchCy: number,
    scaleFactor: number,
  ) => {
    chromaTouchPointRef.current = { x: touchCx, y: touchCy };
    pendingChromaPickRef.current = { mediaOv, target, touchCx, touchCy, scaleFactor };
    if (chromaPickRafRef.current !== null) return;
    chromaPickRafRef.current = window.requestAnimationFrame(() => {
      chromaPickRafRef.current = null;
      const pending = pendingChromaPickRef.current;
      pendingChromaPickRef.current = null;
      if (!pending) return;
      applyChromaPick(
        pending.mediaOv,
        pending.target,
        pending.touchCx,
        pending.touchCy,
        pending.scaleFactor,
      );
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      (activeOverlays.length === 0 && activeMediaOverlays.length === 0) ||
      !canvasRef.current
    ) {
      return;
    }
    const { cx, cy, nx, ny, scaleFactor } = clientToCanvasCoords(e.clientX, e.clientY);
    activePointersRef.current.set(e.pointerId, { cx, cy, nx, ny });

    // 2-finger pinch-to-resize & twist-to-rotate directly on video preview
    if (activePointersRef.current.size === 2 && !isPlaying) {
      const pts = Array.from(activePointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const targetMedia =
        activeMediaOverlays.find((m) => m.id === selectedMediaOverlayId) ??
        activeMediaOverlays[activeMediaOverlays.length - 1] ??
        null;
      const targetText =
        !targetMedia
          ? activeOverlays.find((o) => o.id === selectedOverlayId) ??
            activeOverlays[activeOverlays.length - 1] ??
            null
          : null;

      if (targetMedia || targetText) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        dragInteractionRef.current = null;
        const startDist = Math.max(12, Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy));
        const startAngleRad = Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx);
        const startMidNx = (p1.nx + p2.nx) / 2;
        const startMidNy = (p1.ny + p2.ny) / 2;

        if (targetMedia) {
          onSelectMediaOverlay(targetMedia.id);
          pinchInteractionRef.current = {
            targetType: 'media',
            id: targetMedia.id,
            startX: targetMedia.x,
            startY: targetMedia.y,
            startScale: targetMedia.scale,
            startRotation: targetMedia.rotation || 0,
            startMidNx,
            startMidNy,
            startDist,
            startAngleRad,
          };
          setActiveAngleReadout(Math.round(targetMedia.rotation || 0));
          setActiveScaleReadout(Math.round(targetMedia.scale * 100));
        } else if (targetText) {
          onSelectOverlay(targetText.id);
          pinchInteractionRef.current = {
            targetType: 'text',
            id: targetText.id,
            startX: targetText.x,
            startY: targetText.y,
            startScale: 1,
            startRotation: targetText.rotation || 0,
            startMidNx,
            startMidNy,
            startDist,
            startAngleRad,
          };
          setActiveAngleReadout(Math.round(targetText.rotation || 0));
        }
        return;
      }
    }

    // 1. Chroma Key color-picker dot interaction on selected media overlay (dot sits beside touch)
    if (chromaPickerActive && selectedMediaOverlayId && !isPlaying) {
      const mediaOv = activeMediaOverlays.find((m) => m.id === selectedMediaOverlayId);
      const target = mediaOverlayHitTargetsRef.current.get(selectedMediaOverlayId);
      if (mediaOv && target) {
        const hitRadius = Math.max(32, 32 * scaleFactor);
        const distToDot = Math.hypot(cx - target.pickerX, cy - target.pickerY);
        const offsetPt = computeChromaPickerTouchPoint(cx, cy, scaleFactor);
        const insideOverlay =
          isPointInRotatedRect(
            cx,
            cy,
            target.centerX,
            target.centerY,
            target.halfW + 24 * scaleFactor,
            target.halfH + 24 * scaleFactor,
            target.rotation,
          ) ||
          isPointInRotatedRect(
            offsetPt.x,
            offsetPt.y,
            target.centerX,
            target.centerY,
            target.halfW + 16 * scaleFactor,
            target.halfH + 16 * scaleFactor,
            target.rotation,
          );
        if (distToDot <= hitRadius || insideOverlay) {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragInteractionRef.current = {
            targetType: 'media',
            id: mediaOv.id,
            mode: 'chroma-pick',
            anchorX: target.centerX,
            anchorY: target.centerY,
          };
          applyChromaPick(mediaOv, target, cx, cy, scaleFactor);
          return;
        }
      }
    }

    // 2. Rotation handle of currently selected text overlay
    if (selectedOverlayId && !isPlaying) {
      const selectedTarget = overlayHitTargetsRef.current.get(selectedOverlayId);
      if (selectedTarget) {
        const hitRadius = Math.max(24, 24 * scaleFactor);
        const distToKnob = Math.hypot(
          cx - selectedTarget.handleX,
          cy - selectedTarget.handleY,
        );
        if (distToKnob <= hitRadius) {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragInteractionRef.current = {
            targetType: 'text',
            id: selectedOverlayId,
            mode: 'rotate',
            anchorX: selectedTarget.anchorX,
            anchorY: selectedTarget.anchorY,
            handleSide: 'top',
          };
          setActiveAngleReadout(Math.round(selectedTarget.rotation));
          return;
        }
      }
    }

    // 3. Rotation handle & 4 corner resize handles of currently selected media overlay
    if (selectedMediaOverlayId && !isPlaying) {
      const mediaOv = activeMediaOverlays.find((m) => m.id === selectedMediaOverlayId);
      const mediaTarget = mediaOverlayHitTargetsRef.current.get(selectedMediaOverlayId);
      if (mediaOv && mediaTarget) {
        const knobHitRadius = Math.min(54, Math.max(24, 18 * scaleFactor));
        const cornerHitRadius = Math.min(58, Math.max(24, 18 * scaleFactor));
        const distToKnob = Math.hypot(
          cx - mediaTarget.handleX,
          cy - mediaTarget.handleY,
        );

        let bestCornerDist = Infinity;
        for (const corner of mediaTarget.corners) {
          const d = Math.hypot(cx - corner.x, cy - corner.y);
          if (d < bestCornerDist) {
            bestCornerDist = d;
          }
        }

        const cornerHit = bestCornerDist <= cornerHitRadius;
        const knobHit = distToKnob <= knobHitRadius;

        if (cornerHit && (!knobHit || bestCornerDist <= distToKnob)) {
          e.currentTarget.setPointerCapture(e.pointerId);
          const startDist = Math.max(
            18,
            Math.hypot(cx - mediaTarget.centerX, cy - mediaTarget.centerY),
          );
          dragInteractionRef.current = {
            targetType: 'media',
            id: mediaOv.id,
            mode: 'resize',
            anchorX: mediaTarget.centerX,
            anchorY: mediaTarget.centerY,
            startDist,
            startScale: mediaOv.scale,
          };
          setActiveScaleReadout(Math.round(mediaOv.scale * 100));
          return;
        }

        if (knobHit) {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragInteractionRef.current = {
            targetType: 'media',
            id: mediaOv.id,
            mode: 'rotate',
            anchorX: mediaTarget.centerX,
            anchorY: mediaTarget.centerY,
            handleSide: mediaTarget.handleSide,
          };
          setActiveAngleReadout(Math.round(mediaTarget.rotation));
          return;
        }
      }
    }

    // 4. Check text rotated bounding boxes (topmost layer)
    for (let i = activeOverlays.length - 1; i >= 0; i--) {
      const overlay = activeOverlays[i];
      const target = overlayHitTargetsRef.current.get(overlay.id);
      if (
        target &&
        isPointInRotatedRect(
          cx,
          cy,
          target.centerX,
          target.centerY,
          target.halfW + 16 * scaleFactor,
          target.halfH + 16 * scaleFactor,
          target.rotation,
        )
      ) {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragInteractionRef.current = {
          targetType: 'text',
          id: overlay.id,
          mode: 'move',
          anchorX: target.anchorX,
          anchorY: target.anchorY,
          offsetNx: overlay.x - nx,
          offsetNy: overlay.y - ny,
        };
        onSelectOverlay(overlay.id);
        return;
      }
    }

    // 5. Check media overlay rotated bounding boxes (select + drag move anywhere)
    for (let i = activeMediaOverlays.length - 1; i >= 0; i--) {
      const mediaOv = activeMediaOverlays[i];
      const target = mediaOverlayHitTargetsRef.current.get(mediaOv.id);
      if (
        target &&
        isPointInRotatedRect(
          cx,
          cy,
          target.centerX,
          target.centerY,
          target.halfW + 14 * scaleFactor,
          target.halfH + 14 * scaleFactor,
          target.rotation,
        )
      ) {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragInteractionRef.current = {
          targetType: 'media',
          id: mediaOv.id,
          mode: 'move',
          anchorX: target.centerX,
          anchorY: target.centerY,
          offsetNx: mediaOv.x - nx,
          offsetNy: mediaOv.y - ny,
        };
        onSelectMediaOverlay(mediaOv.id);
        return;
      }
    }

    // 6. Fallback proximity check on text overlays
    let closestId: string | null = null;
    let bestDist = 0.22;
    for (const overlay of activeOverlays) {
      const dist = Math.hypot(overlay.x - nx, overlay.y - ny);
      if (dist < bestDist) {
        bestDist = dist;
        closestId = overlay.id;
      }
    }

    if (closestId) {
      const overlay = activeOverlays.find((o) => o.id === closestId);
      e.currentTarget.setPointerCapture(e.pointerId);
      dragInteractionRef.current = {
        targetType: 'text',
        id: closestId,
        mode: 'move',
        anchorX: 0,
        anchorY: 0,
        offsetNx: overlay ? overlay.x - nx : 0,
        offsetNy: overlay ? overlay.y - ny : 0,
      };
      onSelectOverlay(closestId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const { cx, cy, nx, ny, scaleFactor } = clientToCanvasCoords(e.clientX, e.clientY);
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { cx, cy, nx, ny });
    }

    const pinch = pinchInteractionRef.current;
    if (pinch && activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const currentDist = Math.max(12, Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy));
      const currentAngleRad = Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx);
      const currentMidNx = (p1.nx + p2.nx) / 2;
      const currentMidNy = (p1.ny + p2.ny) / 2;
      const next = computePinchRotateTransform({
        startX: pinch.startX,
        startY: pinch.startY,
        startScale: pinch.startScale,
        startRotation: pinch.startRotation,
        startMidNx: pinch.startMidNx,
        startMidNy: pinch.startMidNy,
        currentMidNx,
        currentMidNy,
        startDist: pinch.startDist,
        currentDist,
        startAngleRad: pinch.startAngleRad,
        currentAngleRad,
      });

      setActiveAngleReadout(next.rotation);
      if (pinch.targetType === 'media') {
        setActiveScaleReadout(Math.round(next.scale * 100));
        onMoveMediaOverlay(pinch.id, next.x, next.y);
        onScaleMediaOverlay(pinch.id, next.scale);
        onRotateMediaOverlay(pinch.id, next.rotation);
      } else {
        onMoveOverlay(pinch.id, next.x, next.y);
        onRotateOverlay(pinch.id, next.rotation);
      }
      return;
    }

    const drag = dragInteractionRef.current;
    if (!drag) return;

    if (drag.mode === 'chroma-pick') {
      const mediaOv = activeMediaOverlays.find((m) => m.id === drag.id);
      const target = mediaOverlayHitTargetsRef.current.get(drag.id);
      if (mediaOv && target) {
        scheduleChromaPick(mediaOv, target, cx, cy, scaleFactor);
      }
      return;
    }

    if (drag.mode === 'resize') {
      const currentDist = Math.max(
        10,
        Math.hypot(cx - drag.anchorX, cy - drag.anchorY),
      );
      const ratio = currentDist / Math.max(10, drag.startDist ?? 100);
      const nextScale = Number(clamp((drag.startScale ?? 0.45) * ratio, 0.15, 1.6).toFixed(2));
      setActiveScaleReadout(Math.round(nextScale * 100));
      onScaleMediaOverlay(drag.id, nextScale);
      return;
    }

    if (drag.mode === 'rotate') {
      const rawDeg = computeRotationAngleDegrees(drag.anchorX, drag.anchorY, cx, cy);
      const deg =
        drag.handleSide === 'bottom' ? normalizeRotationDegrees(rawDeg + 180) : rawDeg;
      setActiveAngleReadout(deg);
      if (drag.targetType === 'media') {
        onRotateMediaOverlay(drag.id, deg);
      } else {
        onRotateOverlay(drag.id, deg);
      }
      return;
    }

    const clampedX = clampNormalized(nx + (drag.offsetNx ?? 0));
    const clampedY = clampNormalized(ny + (drag.offsetNy ?? 0));
    if (drag.targetType === 'media') {
      onMoveMediaOverlay(drag.id, Number(clampedX.toFixed(3)), Number(clampedY.toFixed(3)));
    } else {
      onMoveOverlay(drag.id, Number(clampedX.toFixed(3)), Number(clampedY.toFixed(3)));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (pinchInteractionRef.current && activePointersRef.current.size < 2) {
      pinchInteractionRef.current = null;
      setActiveAngleReadout(null);
      setActiveScaleReadout(null);
    }
    if (dragInteractionRef.current) {
      if (chromaPickRafRef.current !== null) {
        window.cancelAnimationFrame(chromaPickRafRef.current);
        chromaPickRafRef.current = null;
      }
      const pending = pendingChromaPickRef.current;
      pendingChromaPickRef.current = null;
      if (pending) {
        applyChromaPick(
          pending.mediaOv,
          pending.target,
          pending.touchCx,
          pending.touchCy,
          pending.scaleFactor,
        );
      }
      dragInteractionRef.current = null;
      chromaTouchPointRef.current = null;
      setActiveAngleReadout(null);
      setActiveScaleReadout(null);
      setActiveChromaReadout(null);
      renderLatestRef.current();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const aspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16]'
      : aspectRatio === '16:9'
        ? 'aspect-video'
        : aspectRatio === '1:1'
          ? 'aspect-square'
          : 'aspect-[4/5]';

  const fittedPreviewBox = stageBounds
    ? fitBoxToBounds(stageBounds.width, stageBounds.height, dims.width / dims.height)
    : null;

  return (
    <section
      aria-label="Video preview stage"
      className="flex-1 min-h-0 flex flex-col items-center justify-center px-2 py-1.5 sm:px-5 sm:py-3 bg-[#08080b] relative overflow-hidden"
    >
      {/* Canvas viewport wrapper */}
      <div
        ref={stageWrapRef}
        className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden"
      >
        {clips.length === 0 ? (
          <div className="w-full max-w-sm rounded-3xl bg-[#121218] border border-white/10 p-5 sm:p-6 text-center flex flex-col items-center gap-3.5 sm:gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 flex items-center justify-center text-pink-400">
              <Film className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-base sm:text-lg text-white">
                Start a New Cut
              </h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Import videos or photos from your gallery, or load the sample reel to test trimming, text overlays, and export.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5 w-full">
              <button
                type="button"
                onClick={onTriggerImport}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Import Media</span>
              </button>
              <button
                type="button"
                onClick={onLoadSampleProject}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#1a1a24] border border-white/10 hover:bg-[#232330] text-zinc-100 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>Load Sample</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            style={
              fittedPreviewBox
                ? { width: `${fittedPreviewBox.width}px`, height: `${fittedPreviewBox.height}px` }
                : undefined
            }
            className={`relative max-h-full max-w-full ${fittedPreviewBox ? '' : `h-full ${aspectClass}`} rounded-2xl overflow-hidden bg-black border border-white/12 shadow-2xl flex items-center justify-center`}
          >
            <canvas
              ref={canvasRef}
              data-testid="preview-canvas"
              width={dims.width}
              height={dims.height}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full h-full object-contain touch-none cursor-grab active:cursor-grabbing"
            />
            {activeAngleReadout !== null && (
              <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-xs font-mono-tabular font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-600 px-3 py-1 rounded-lg shadow-lg">
                {activeAngleReadout}°
              </span>
            )}
            {activeScaleReadout !== null && (
              <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-xs font-mono-tabular font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-600 px-3 py-1 rounded-lg shadow-lg">
                {activeScaleReadout}%
              </span>
            )}
            {activeChromaReadout !== null && (
              <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-xs font-mono-tabular font-semibold text-white bg-black/85 border border-white/20 px-3 py-1 rounded-lg shadow-lg flex items-center gap-1.5">
                <span
                  style={{ backgroundColor: activeChromaReadout }}
                  className="w-3.5 h-3.5 rounded-full border border-white/60 inline-block"
                />
                <span>{activeChromaReadout}</span>
              </span>
            )}
            {(activeOverlays.length > 0 || activeMediaOverlays.length > 0) &&
              !isPlaying &&
              activeAngleReadout === null &&
              activeScaleReadout === null &&
              activeChromaReadout === null && (
                <span className="pointer-events-none hidden sm:inline-block absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-zinc-300/85 bg-black/65 backdrop-blur-sm px-2.5 py-0.5 rounded-md whitespace-nowrap">
                  {chromaPickerActive
                    ? 'Drag the Chroma Key dot onto the color to remove'
                    : 'Drag to move · Corners to resize · Top knob to rotate 360°'}
                </span>
              )}
          </div>
        )}
      </div>

      {/* Transport Bar */}
      <div className="w-full max-w-2xl shrink-0 pt-1.5 sm:pt-2 flex items-center justify-between gap-1 sm:gap-2">
        <div className="font-mono-tabular text-[11px] sm:text-xs text-zinc-300 whitespace-nowrap shrink-0 min-w-[78px] sm:min-w-[106px]">
          <span className="text-white font-semibold" data-testid="current-timecode">
            {formatTimecode(currentTime)}
          </span>
          <span className="text-zinc-500 mx-0.5 sm:mx-1">/</span>
          <span className="text-zinc-400">{formatTimecode(totalDuration)}</span>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-2">
          <button
            type="button"
            onClick={onSeekStart}
            disabled={clips.length === 0}
            aria-label="Jump to start"
            title="Jump to start"
            className="min-w-[34px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] rounded-xl flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-35 transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            disabled={clips.length === 0}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            className="min-w-[38px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] px-3 sm:px-4 rounded-full bg-white text-black hover:bg-zinc-200 flex items-center justify-center disabled:opacity-35 transition-transform active:scale-95"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onSplitAtPlayhead}
            disabled={!canSplit}
            aria-label="Split clip at playhead"
            title="Split clip at playhead"
            className="min-w-[34px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] rounded-xl flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <Scissors className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button
            type="button"
            onClick={onQuickAddText}
            disabled={clips.length === 0}
            aria-label="Quick add text overlay"
            title="Add Text"
            className="min-w-[34px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] rounded-xl flex items-center justify-center text-zinc-300 hover:text-pink-400 hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <Type className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleLoop}
            aria-label={loopEnabled ? 'Disable playback loop' : 'Enable playback loop'}
            aria-pressed={loopEnabled}
            title="Loop playback"
            className={`min-w-[34px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] rounded-xl flex items-center justify-center transition-colors ${
              loopEnabled
                ? 'text-pink-400 bg-pink-500/15'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
