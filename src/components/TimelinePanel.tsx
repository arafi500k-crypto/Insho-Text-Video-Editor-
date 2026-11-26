import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Layers,
  Music,
  Plus,
  Scissors,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  AudioTrackItem,
  MediaAsset,
  MediaOverlay,
  TextOverlay,
  TimelineClip,
} from '../types/editor';
import {
  clamp,
  computeClipSegments,
  computeEdgeAutoScrollVelocity,
  computeTrackDragDeltaSeconds,
  formatTimecode,
  getClipDuration,
  moveOverlayTiming,
  scrollLeftToTimelineTime,
  timelineTimeToScrollLeft,
  trimOverlayEndTiming,
  trimOverlayStartTiming,
} from '../utils/timeline';

type OverlayDragMode = 'holding' | 'moving' | 'trim-start' | 'trim-end';
type OverlayTrackKind = 'text' | 'media';

interface ActiveOverlayGesture {
  kind: OverlayTrackKind;
  overlayId: string;
  pointerId: number;
  mode: OverlayDragMode;
  startX: number;
  lastX: number;
  startY: number;
  origScrollLeft: number;
  origStartTime: number;
  origDuration: number;
  movedPx: number;
  holdTimerId: number | null;
  captureEl: HTMLElement | null;
}

const LONG_PRESS_MOVE_MS = 850;

interface TimelinePanelProps {
  clips: TimelineClip[];
  assetsById: Map<string, MediaAsset>;
  overlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  audioTracks: AudioTrackItem[];
  currentTime: number;
  getLiveTime?: () => number;
  totalDuration: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedMediaOverlayId: string | null;
  zoomPxPerSec: number;
  canSplit: boolean;
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string) => void;
  onSelectOverlay: (overlayId: string) => void;
  onSelectMediaOverlay: (overlayId: string) => void;
  onOpenOverlayTool: () => void;
  onOverlayInteractionStart?: () => void;
  onUpdateOverlayTiming: (overlayId: string, startTime: number, duration: number) => void;
  onUpdateMediaOverlayTiming: (overlayId: string, startTime: number, duration: number) => void;
  onSelectTransition: (clipId: string) => void;
  onOpenAudioTool: () => void;
  onTriggerImport: () => void;
  onSplitAtPlayhead: () => void;
  onZoomChange: (pxPerSec: number) => void;
}

export function TimelinePanel({
  clips,
  assetsById,
  overlays,
  mediaOverlays,
  audioTracks,
  currentTime,
  getLiveTime,
  totalDuration,
  isPlaying,
  selectedClipId,
  selectedOverlayId,
  selectedMediaOverlayId,
  zoomPxPerSec,
  canSplit,
  onSeek,
  onSelectClip,
  onSelectOverlay,
  onSelectMediaOverlay,
  onOpenOverlayTool,
  onOverlayInteractionStart,
  onUpdateOverlayTiming,
  onUpdateMediaOverlayTiming,
  onSelectTransition,
  onOpenAudioTool,
  onTriggerImport,
  onSplitAtPlayhead,
  onZoomChange,
}: TimelinePanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const mousePanRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
    fromRuler: boolean;
    captureEl: HTMLElement;
  } | null>(null);
  const userScrollActiveUntilRef = useRef(0);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const seekRafRef = useRef<number | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);

  const gestureRef = useRef<ActiveOverlayGesture | null>(null);
  const latestCallbacksRef = useRef({
    zoomPxPerSec,
    totalDuration,
    getLiveTime,
    onSelectOverlay,
    onSelectMediaOverlay,
    onOverlayInteractionStart,
    onUpdateOverlayTiming,
    onUpdateMediaOverlayTiming,
    onSeek,
  });
  latestCallbacksRef.current = {
    zoomPxPerSec,
    totalDuration,
    getLiveTime,
    onSelectOverlay,
    onSelectMediaOverlay,
    onOverlayInteractionStart,
    onUpdateOverlayTiming,
    onUpdateMediaOverlayTiming,
    onSeek,
  };

  const scheduleSeek = (nextTime: number) => {
    pendingSeekTimeRef.current = nextTime;
    if (seekRafRef.current !== null) return;
    seekRafRef.current = window.requestAnimationFrame(() => {
      seekRafRef.current = null;
      const pending = pendingSeekTimeRef.current;
      pendingSeekTimeRef.current = null;
      if (pending !== null) {
        latestCallbacksRef.current.onSeek(pending);
      }
    });
  };

  const [activeOverlayDrag, setActiveOverlayDrag] = useState<{
    kind: OverlayTrackKind;
    overlayId: string;
    mode: OverlayDragMode;
  } | null>(null);
  const [edgeAutoScrollDir, setEdgeAutoScrollDir] = useState<'left' | 'right' | null>(null);

  const applyOverlayGestureTiming = (g: ActiveOverlayGesture) => {
    const {
      zoomPxPerSec: pxPerSec,
      totalDuration: maxDur,
      onUpdateOverlayTiming: updateTextTiming,
      onUpdateMediaOverlayTiming: updateMediaTiming,
    } = latestCallbacksRef.current;
    const updateTiming = g.kind === 'media' ? updateMediaTiming : updateTextTiming;
    const currentScrollLeft = scrollRef.current?.scrollLeft ?? g.origScrollLeft;
    const deltaSec = computeTrackDragDeltaSeconds(
      g.startX,
      g.lastX,
      g.origScrollLeft,
      currentScrollLeft,
      pxPerSec,
    );

    if (g.mode === 'moving') {
      const next = moveOverlayTiming(
        { startTime: g.origStartTime, duration: g.origDuration },
        deltaSec,
        maxDur,
      );
      updateTiming(g.overlayId, next.startTime, next.duration);
    } else if (g.mode === 'trim-start') {
      const next = trimOverlayStartTiming(
        { startTime: g.origStartTime, duration: g.origDuration },
        deltaSec,
      );
      updateTiming(g.overlayId, next.startTime, next.duration);
    } else if (g.mode === 'trim-end') {
      const next = trimOverlayEndTiming(
        { startTime: g.origStartTime, duration: g.origDuration },
        deltaSec,
        maxDur,
      );
      updateTiming(g.overlayId, next.startTime, next.duration);
    }
  };

  // Measure scroll viewport width so left/right spacers align 0s and endTime exactly under center white playhead
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateWidth = () => {
      setViewportWidth(el.clientWidth);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync timeline horizontal scroll position smoothly at 60Hz during playback without fighting user scroll
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const stepScroll = () => {
      const container = scrollRef.current;
      const now = performance.now();
      if (container && !mousePanRef.current && now > userScrollActiveUntilRef.current) {
        const liveT = latestCallbacksRef.current.getLiveTime
          ? latestCallbacksRef.current.getLiveTime()
          : currentTime;
        const targetLeft = timelineTimeToScrollLeft(
          liveT,
          latestCallbacksRef.current.zoomPxPerSec,
          latestCallbacksRef.current.totalDuration,
        );
        if (Math.abs(container.scrollLeft - targetLeft) >= 0.5) {
          programmaticScrollTargetRef.current = targetLeft;
          container.scrollLeft = targetLeft;
        }
      }
      rafId = window.requestAnimationFrame(stepScroll);
    };
    rafId = window.requestAnimationFrame(stepScroll);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, currentTime]);

  // Sync paused scrollLeft only when not actively scrubbed or auto-scrolled during overlay trim/move
  useEffect(() => {
    if (isPlaying) return;
    const container = scrollRef.current;
    if (
      !container ||
      mousePanRef.current ||
      (gestureRef.current && gestureRef.current.mode !== 'holding') ||
      performance.now() <= userScrollActiveUntilRef.current
    ) {
      return;
    }
    const targetLeft = timelineTimeToScrollLeft(currentTime, zoomPxPerSec, totalDuration);
    if (Math.abs(container.scrollLeft - targetLeft) >= 1) {
      programmaticScrollTargetRef.current = targetLeft;
      container.scrollLeft = targetLeft;
    }
  }, [isPlaying, currentTime, zoomPxPerSec, totalDuration, viewportWidth]);

  useEffect(() => {
    return () => {
      if (seekRafRef.current !== null) {
        window.cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
    };
  }, []);

  const clearGesture = () => {
    const g = gestureRef.current;
    if (g) {
      if (g.holdTimerId !== null) {
        window.clearTimeout(g.holdTimerId);
      }
      if (g.captureEl) {
        try {
          if (g.captureEl.hasPointerCapture(g.pointerId)) {
            g.captureEl.releasePointerCapture(g.pointerId);
          }
        } catch {
          // ignore
        }
      }
      if (g.mode !== 'holding' && scrollRef.current) {
        const container = scrollRef.current;
        if (Math.abs(container.scrollLeft - g.origScrollLeft) >= 1) {
          const { zoomPxPerSec: pxPerSec, totalDuration: maxDur } = latestCallbacksRef.current;
          userScrollActiveUntilRef.current = performance.now() + 260;
          scheduleSeek(scrollLeftToTimelineTime(container.scrollLeft, pxPerSec, maxDur));
        }
      }
      gestureRef.current = null;
    }
    setActiveOverlayDrag(null);
    setEdgeAutoScrollDir(null);
  };

  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;

      const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
      g.movedPx = Math.max(g.movedPx, dist);
      g.lastX = e.clientX;

      if (g.mode === 'holding') {
        if (dist > 10) {
          // Pointer moved significantly before hold completed — cancel hold so timeline pan takes over smoothly
          clearGesture();
        }
        return;
      }

      applyOverlayGestureTiming(g);
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;

      const wasTap = g.mode === 'holding' && g.movedPx < 8;
      const tappedId = g.overlayId;
      const tappedKind = g.kind;
      clearGesture();

      if (wasTap) {
        if (tappedKind === 'media') {
          latestCallbacksRef.current.onSelectMediaOverlay(tappedId);
        } else {
          latestCallbacksRef.current.onSelectOverlay(tappedId);
        }
      }
    };

    const handleWindowPointerCancel = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      clearGesture();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      clearGesture();
    };
  }, []);

  const isOverlayTransforming =
    activeOverlayDrag !== null && activeOverlayDrag.mode !== 'holding';

  // Continuously auto-scroll the timeline when user drags/holds an overlay handle near viewport edges
  useEffect(() => {
    if (!isOverlayTransforming) {
      setEdgeAutoScrollDir(null);
      return;
    }

    let rafId = 0;
    let lastFrameMs = performance.now();

    const tickEdgeAutoScroll = (now: number) => {
      const g = gestureRef.current;
      const container = scrollRef.current;
      const dtSec = Math.min(0.05, Math.max(0.001, (now - lastFrameMs) / 1000));
      lastFrameMs = now;

      if (!g || g.mode === 'holding' || !container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const edgeThresholdPx = Math.min(56, Math.max(32, rect.width * 0.14));
      const velocityPxPerSec = computeEdgeAutoScrollVelocity(
        g.lastX,
        rect.left,
        rect.right,
        edgeThresholdPx,
        360,
      );

      const hasDragIntent =
        g.movedPx >= 3 ||
        g.lastX <= rect.left + 26 ||
        g.lastX >= rect.right - 26;

      if (hasDragIntent && velocityPxPerSec !== 0) {
        const { zoomPxPerSec: pxPerSec, totalDuration: maxDur } = latestCallbacksRef.current;
        const maxScroll = timelineTimeToScrollLeft(maxDur, pxPerSec, maxDur);
        const nextScroll = clamp(
          container.scrollLeft + velocityPxPerSec * dtSec,
          0,
          maxScroll,
        );
        if (Math.abs(nextScroll - container.scrollLeft) >= 0.05) {
          programmaticScrollTargetRef.current = nextScroll;
          userScrollActiveUntilRef.current = now + 300;
          container.scrollLeft = nextScroll;
          applyOverlayGestureTiming(g);
          scheduleSeek(scrollLeftToTimelineTime(nextScroll, pxPerSec, maxDur));
          setEdgeAutoScrollDir(velocityPxPerSec > 0 ? 'right' : 'left');
        } else {
          setEdgeAutoScrollDir(null);
        }
      } else {
        setEdgeAutoScrollDir(null);
      }

      rafId = window.requestAnimationFrame(tickEdgeAutoScroll);
    };

    rafId = window.requestAnimationFrame(tickEdgeAutoScroll);
    return () => {
      window.cancelAnimationFrame(rafId);
      setEdgeAutoScrollDir(null);
    };
  }, [isOverlayTransforming]);

  const startOverlayBodyHold = (
    e: React.PointerEvent<HTMLDivElement>,
    kind: OverlayTrackKind,
    item: { id: string; startTime: number; duration: number },
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearGesture();

    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;

    const holdTimerId = window.setTimeout(() => {
      const current = gestureRef.current;
      if (!current || current.pointerId !== pointerId || current.mode !== 'holding') {
        return;
      }
      mousePanRef.current = null;
      current.mode = 'moving';
      current.holdTimerId = null;
      current.startX = current.lastX;
      current.origScrollLeft = scrollRef.current?.scrollLeft ?? current.origScrollLeft;
      try {
        captureEl.setPointerCapture(pointerId);
      } catch {
        // ignore
      }
      setActiveOverlayDrag({ kind, overlayId: item.id, mode: 'moving' });
      latestCallbacksRef.current.onOverlayInteractionStart?.();
      try {
        navigator.vibrate?.(25);
      } catch {
        // ignore unsupported vibrate
      }
    }, LONG_PRESS_MOVE_MS);

    gestureRef.current = {
      kind,
      overlayId: item.id,
      pointerId,
      mode: 'holding',
      startX: e.clientX,
      lastX: e.clientX,
      startY: e.clientY,
      origScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      origStartTime: item.startTime,
      origDuration: item.duration,
      movedPx: 0,
      holdTimerId,
      captureEl,
    };
    setActiveOverlayDrag({ kind, overlayId: item.id, mode: 'holding' });
  };

  const startOverlayTrim = (
    e: React.PointerEvent<HTMLDivElement>,
    kind: OverlayTrackKind,
    item: { id: string; startTime: number; duration: number },
    edge: 'trim-start' | 'trim-end',
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    clearGesture();

    const captureEl = e.currentTarget;
    try {
      captureEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    latestCallbacksRef.current.onOverlayInteractionStart?.();
    gestureRef.current = {
      kind,
      overlayId: item.id,
      pointerId: e.pointerId,
      mode: edge,
      startX: e.clientX,
      lastX: e.clientX,
      startY: e.clientY,
      origScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      origStartTime: item.startTime,
      origDuration: item.duration,
      movedPx: 0,
      holdTimerId: null,
      captureEl,
    };
    setActiveOverlayDrag({ kind, overlayId: item.id, mode: edge });
  };

  const segments = computeClipSegments(clips);
  const trackDuration = Math.max(totalDuration, 6);
  const trackWidthPx = Math.max(320, Math.round(trackDuration * zoomPxPerSec));
  const halfViewportPx = viewportWidth > 0 ? viewportWidth / 2 : 195;

  const selectedSegment = segments.find((s) => s.clip.id === selectedClipId) ?? null;
  const activeDraggedOverlay: { startTime: number; duration: number } | null = activeOverlayDrag
    ? activeOverlayDrag.kind === 'media'
      ? mediaOverlays.find((o) => o.id === activeOverlayDrag.overlayId) ?? null
      : overlays.find((o) => o.id === activeOverlayDrag.overlayId) ?? null
    : null;

  const handleSurfacePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    fromRuler = false,
  ) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || totalDuration <= 0) return;
    const container = scrollRef.current;
    if (!container) return;
    mousePanRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: container.scrollLeft,
      moved: false,
      fromRuler,
      captureEl: e.currentTarget,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = mousePanRef.current;
    const container = scrollRef.current;
    if (!pan || !container || e.pointerId !== pan.pointerId) return;

    const dx = e.clientX - pan.startX;
    if (Math.abs(dx) > 4) {
      pan.moved = true;
    }
    if (!pan.moved) return;

    const maxScroll = timelineTimeToScrollLeft(totalDuration, zoomPxPerSec, totalDuration);
    const nextScroll = clamp(pan.startScrollLeft - dx, 0, maxScroll);
    programmaticScrollTargetRef.current = nextScroll;
    container.scrollLeft = nextScroll;
    scheduleSeek(scrollLeftToTimelineTime(nextScroll, zoomPxPerSec, totalDuration));
  };

  const handleSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = mousePanRef.current;
    if (!pan || e.pointerId !== pan.pointerId) return;
    mousePanRef.current = null;
    if (pan.moved) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
      if (seekRafRef.current !== null) {
        window.cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
      const pending = pendingSeekTimeRef.current;
      pendingSeekTimeRef.current = null;
      if (pending !== null) {
        onSeek(pending);
      }
    }
    try {
      if (pan.captureEl.hasPointerCapture(e.pointerId)) {
        pan.captureEl.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    // If user clicked directly on the ruler without dragging, jump straight to that timestamp
    if (pan.fromRuler && !pan.moved && trackContainerRef.current) {
      const rect = trackContainerRef.current.getBoundingClientRect();
      const clickedTime = clamp(
        (e.clientX - rect.left) / zoomPxPerSec,
        0,
        Math.max(0.05, totalDuration),
      );
      onSeek(Number(clickedTime.toFixed(2)));
    }
  };

  const handleTimelineScroll = () => {
    const container = scrollRef.current;
    if (
      !container ||
      mousePanRef.current ||
      (gestureRef.current && gestureRef.current.mode !== 'holding')
    ) {
      return;
    }

    const now = performance.now();
    if (programmaticScrollTargetRef.current !== null) {
      const diff = Math.abs(container.scrollLeft - programmaticScrollTargetRef.current);
      if (diff < 2) {
        programmaticScrollTargetRef.current = null;
        return;
      }
      programmaticScrollTargetRef.current = null;
    }

    // Ignore delayed scroll echoes while playback drives scrollLeft automatically
    if (isPlaying && now > userScrollActiveUntilRef.current) {
      return;
    }

    if (totalDuration <= 0) return;
    userScrollActiveUntilRef.current = now + 220;

    const nextTime = scrollLeftToTimelineTime(
      container.scrollLeft,
      zoomPxPerSec,
      totalDuration,
    );
    if (Math.abs(nextTime - currentTime) >= 0.005) {
      scheduleSeek(nextTime);
    }
  };

  const tickCount = Math.ceil(trackDuration) + 1;
  const tickStep = zoomPxPerSec < 40 ? 2 : 1;

  return (
    <section
      aria-label="Multi-track timeline"
      className="lg:col-span-2 shrink-0 border-t border-white/10 bg-[#0d0d12] flex flex-col select-none"
    >
      {/* Timeline toolbar */}
      <div className="h-9 sm:h-11 px-2.5 sm:px-4 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <button
            type="button"
            onClick={onTriggerImport}
            className="min-h-[30px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg bg-[#1a1a24] hover:bg-[#242433] border border-white/10 text-[11px] sm:text-xs font-medium text-white flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-pink-400" />
            <span>Add Clip</span>
          </button>

          <button
            type="button"
            onClick={onSplitAtPlayhead}
            disabled={!canSplit}
            className="min-h-[30px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg bg-[#1a1a24] hover:bg-[#242433] border border-white/10 text-[11px] sm:text-xs font-medium text-zinc-200 flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-35 disabled:pointer-events-none"
          >
            <Scissors className="w-3.5 h-3.5 text-purple-400" />
            <span>Split</span>
          </button>

          {activeDraggedOverlay && activeOverlayDrag && activeOverlayDrag.mode !== 'holding' ? (
            <span
              data-testid="timeline-overlay-live-timing"
              className="text-[11px] font-mono-tabular text-pink-300 truncate font-medium"
            >
              {activeOverlayDrag.mode === 'moving' &&
              totalDuration - activeDraggedOverlay.duration <= 0.05 ? (
                'Trim shorter to slide'
              ) : (
                <>
                  <span className="hidden sm:inline">
                    {activeOverlayDrag.mode === 'moving' ? 'Moving' : 'Duration'}:{' '}
                  </span>
                  {activeDraggedOverlay.startTime.toFixed(1)}s–
                  {(activeDraggedOverlay.startTime + activeDraggedOverlay.duration).toFixed(1)}s (
                  {activeDraggedOverlay.duration.toFixed(1)}s)
                </>
              )}
            </span>
          ) : activeOverlayDrag?.mode === 'holding' ? (
            <span className="text-[11px] text-pink-200 truncate">
              Hold steady to drag…
            </span>
          ) : selectedSegment ? (
            <span className="hidden sm:inline text-xs text-zinc-400 truncate font-mono-tabular">
              {selectedSegment.clip.label} · {getClipDuration(selectedSegment.clip).toFixed(1)}s ·{' '}
              {selectedSegment.clip.speed}x
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onZoomChange(Math.max(28, zoomPxPerSec - 16))}
            aria-label="Zoom out timeline"
            className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(140, zoomPxPerSec + 16))}
            aria-label="Zoom in timeline"
            className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Centered-Playhead Timeline Stage */}
      <div className="relative">
        {/* Scrollable multi-track surface sliding underneath the centered white playhead */}
        <div
          ref={scrollRef}
          data-testid="timeline-scroll-surface"
          onScroll={handleTimelineScroll}
          onTouchStart={() => {
            userScrollActiveUntilRef.current = performance.now() + 900;
          }}
          onTouchMove={() => {
            userScrollActiveUntilRef.current = performance.now() + 900;
          }}
          onTouchEnd={() => {
            userScrollActiveUntilRef.current = performance.now() + 260;
          }}
          onWheel={() => {
            userScrollActiveUntilRef.current = performance.now() + 500;
          }}
          onPointerDown={(e) => handleSurfacePointerDown(e, false)}
          onPointerMove={handleSurfacePointerMove}
          onPointerUp={handleSurfacePointerUp}
          onPointerCancel={handleSurfacePointerUp}
          className="relative overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x py-1 sm:py-2 no-scrollbar cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-stretch">
            {/* Left center-alignment spacer */}
            <div
              aria-hidden="true"
              style={{ width: `${halfViewportPx}px` }}
              className="shrink-0"
            />

            {/* Main Track Stack */}
            <div
              ref={trackContainerRef}
              data-testid="timeline-track-stack"
              style={{ width: `${trackWidthPx}px` }}
              onClickCapture={(e) => {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  e.stopPropagation();
                  e.preventDefault();
                }
              }}
              className="shrink-0 relative flex flex-col gap-1"
            >
              {/* Interactive Time Ruler */}
              <div
                role="slider"
                aria-label="Timeline playhead scrubber"
                aria-valuemin={0}
                aria-valuemax={Number(totalDuration.toFixed(1))}
                aria-valuenow={Number(currentTime.toFixed(1))}
                tabIndex={0}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleSurfacePointerDown(e, true);
                }}
                onPointerMove={handleSurfacePointerMove}
                onPointerUp={handleSurfacePointerUp}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') onSeek(clamp(currentTime + 0.2, 0, totalDuration));
                  if (e.key === 'ArrowLeft') onSeek(clamp(currentTime - 0.2, 0, totalDuration));
                }}
                className="h-5 relative border-b border-white/10 cursor-ew-resize"
              >
                {Array.from({ length: tickCount }).map((_, sec) => {
                  if (sec % tickStep !== 0) return null;
                  return (
                    <div
                      key={sec}
                      style={{ left: `${sec * zoomPxPerSec}px` }}
                      className="absolute top-0 flex flex-col items-start pointer-events-none"
                    >
                      <span className="text-[10px] font-mono-tabular text-zinc-500 leading-none">
                        {sec}s
                      </span>
                      <span className="w-px h-1.5 bg-white/15 mt-0.5" />
                    </div>
                  );
                })}
              </div>

              {/* Track 1: Video & Photo Clips */}
              <div className="h-10 sm:h-14 relative rounded-xl bg-white/[0.03] border border-white/5 flex items-center overflow-hidden">
                {segments.length === 0 ? (
                  <span className="px-3 text-xs text-zinc-500">
                    No clips on timeline — import a video or photo to begin
                  </span>
                ) : (
                  segments.map((seg) => {
                    const asset = assetsById.get(seg.clip.assetId);
                    const leftPx = seg.startTime * zoomPxPerSec;
                    const widthPx = Math.max(38, seg.duration * zoomPxPerSec);
                    const isSelected = seg.clip.id === selectedClipId;
                    const thumb = asset?.thumbnails[0];

                    return (
                      <div
                        key={seg.clip.id}
                        style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        className="absolute top-1 bottom-1 flex items-center"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectClip(seg.clip.id)}
                          aria-label={`Select clip ${seg.clip.label}`}
                          className={`w-full h-full rounded-lg overflow-hidden relative border transition-colors text-left flex items-end pb-1.5 pr-1.5 ${
                            seg.index > 0 ? 'pl-4.5' : 'pl-2'
                          } ${
                            isSelected
                              ? 'border-pink-500 ring-1 ring-purple-500/70 bg-zinc-900'
                              : 'border-white/15 bg-zinc-900/90 hover:border-white/35'
                          }`}
                        >
                          {thumb && (
                            <img
                              src={thumb}
                              alt={seg.clip.label}
                              referrerPolicy="no-referrer"
                              draggable="false"
                              onContextMenu={(e) => e.preventDefault()}
                              className="absolute inset-0 w-full h-full object-cover opacity-55 pointer-events-none"
                            />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none" />
                          <span className="relative z-10 text-[10px] font-medium text-white truncate max-w-full">
                            {seg.clip.label} · {seg.duration.toFixed(1)}s
                          </span>
                        </button>

                        {/* Transition junction button between clips */}
                        {seg.index > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTransition(seg.clip.id);
                            }}
                            aria-label={`Edit transition into ${seg.clip.label}`}
                            title={`Transition: ${seg.clip.transitionIn}`}
                            className={`-left-3.5 absolute z-20 w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                              seg.clip.transitionIn !== 'none'
                                ? 'bg-purple-600 border-pink-400 text-white'
                                : 'bg-[#181822] border-white/25 text-zinc-300 hover:text-white'
                            }`}
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Track 2: Video & Photo Overlays (PiP - same hold-to-move + side trim handles) */}
              {(() => {
                const laneEnds: number[] = [];
                const lanedMedia = mediaOverlays.map((ov) => {
                  let laneIndex = laneEnds.findIndex((end) => end <= ov.startTime + 0.01);
                  if (laneIndex === -1) {
                    laneIndex = laneEnds.length;
                    laneEnds.push(ov.startTime + ov.duration);
                  } else {
                    laneEnds[laneIndex] = ov.startTime + ov.duration;
                  }
                  return { ov, laneIndex };
                });
                const laneCount = Math.max(1, laneEnds.length);
                const laneHeight = 32;
                const trackHeightPx = laneCount * laneHeight + 4;

                return (
                  <div
                    style={{ height: `${trackHeightPx}px` }}
                    className="relative rounded-lg bg-white/[0.02] border border-white/5 flex items-center"
                  >
                    {mediaOverlays.length === 0 ? (
                      <button
                        type="button"
                        onClick={onOpenOverlayTool}
                        className="px-2.5 h-full w-full text-left text-[11px] text-zinc-600 hover:text-zinc-300 flex items-center gap-1.5"
                      >
                        <Layers className="w-3 h-3 text-pink-400" />
                        <span>Tap to add video or photo overlay</span>
                      </button>
                    ) : (
                      lanedMedia.map(({ ov, laneIndex }) => {
                        const asset = assetsById.get(ov.assetId);
                        const thumb = asset?.thumbnails[0];
                        const leftPx = ov.startTime * zoomPxPerSec;
                        const widthPx = Math.max(68, ov.duration * zoomPxPerSec);
                        const isSelected = ov.id === selectedMediaOverlayId;
                        const dragMode =
                          activeOverlayDrag?.kind === 'media' &&
                          activeOverlayDrag.overlayId === ov.id
                            ? activeOverlayDrag.mode
                            : 'idle';
                        const isMoving = dragMode === 'moving';
                        const isHolding = dragMode === 'holding';
                        const isTrimming = dragMode === 'trim-start' || dragMode === 'trim-end';
                        const topPx = 3 + laneIndex * laneHeight;
                        const labelText = ov.label || 'Overlay';

                        return (
                          <div
                            key={ov.id}
                            data-testid={`timeline-media-overlay-bar-${ov.id}`}
                            data-overlay-id={ov.id}
                            data-drag-state={dragMode}
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            aria-label={`Media overlay ${labelText}, ${ov.startTime.toFixed(1)}s to ${(
                              ov.startTime + ov.duration
                            ).toFixed(1)}s. Hold 1 second and drag to move, or drag edges to resize.`}
                            onContextMenu={(e) => e.preventDefault()}
                            onDragStart={(e) => e.preventDefault()}
                            onPointerDown={(e) => startOverlayBodyHold(e, 'media', ov)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectMediaOverlay(ov.id);
                              }
                            }}
                            style={{
                              left: `${leftPx}px`,
                              width: `${widthPx}px`,
                              top: `${2 + laneIndex * laneHeight}px`,
                              height: '28px',
                              WebkitTouchCallout: 'none',
                              WebkitUserSelect: 'none',
                            }}
                            className={`group ${isMoving ? 'touch-none' : 'touch-pan-x'} absolute rounded-md border flex items-stretch text-[11px] font-medium select-none transition-transform ${
                              isMoving
                                ? 'z-30 cursor-grabbing scale-[1.03] -translate-y-0.5 bg-pink-500/45 border-white text-white ring-2 ring-pink-400/85 shadow-[0_8px_20px_rgba(236,72,153,0.45)]'
                                : isTrimming
                                  ? 'z-30 bg-pink-500/35 border-white text-white ring-1 ring-pink-400'
                                  : isHolding
                                    ? 'z-20 bg-pink-500/35 border-pink-300 text-white ring-1 ring-pink-300/60'
                                    : isSelected
                                      ? 'z-10 bg-pink-500/30 border-pink-400 text-white cursor-grab'
                                      : 'bg-fuchsia-500/20 border-pink-400/40 text-pink-100 hover:border-pink-300/70 cursor-pointer'
                            }`}
                          >
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Trim start of overlay ${labelText}`}
                              data-testid={`media-trim-start-handle-${ov.id}`}
                              draggable={false}
                              onContextMenu={(e) => e.preventDefault()}
                              onDragStart={(e) => e.preventDefault()}
                              onPointerDown={(e) => startOverlayTrim(e, 'media', ov, 'trim-start')}
                              className={`w-4 h-full rounded-l-[5px] flex items-center justify-center shrink-0 cursor-ew-resize touch-none transition-colors ${
                                isSelected || dragMode === 'trim-start'
                                  ? 'bg-white text-zinc-900'
                                  : 'bg-white/10 hover:bg-white/30 text-white/80'
                              }`}
                            >
                              <span
                                className={`pointer-events-none w-0.5 h-3.5 rounded-full ${
                                  isSelected || dragMode === 'trim-start'
                                    ? 'bg-pink-600'
                                    : 'bg-white/75'
                                }`}
                              />
                            </div>

                            <div className="relative flex-1 min-w-0 px-1.5 flex items-center justify-between gap-1 overflow-hidden pointer-events-none">
                              {thumb && (
                                <img
                                  src={thumb}
                                  alt=""
                                  draggable="false"
                                  onContextMenu={(e) => e.preventDefault()}
                                  className="w-4 h-4 rounded-sm object-cover shrink-0 border border-white/20"
                                />
                              )}
                              {isHolding && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-0 bg-gradient-to-r from-pink-500/45 to-purple-500/45 animate-hold-fill"
                                />
                              )}
                              <span className="relative z-10 flex items-center gap-1 min-w-0">
                                <span className="truncate">{labelText}</span>
                              </span>
                              {widthPx >= 96 && (
                                <span className="relative z-10 font-mono-tabular text-[10px] opacity-80 shrink-0">
                                  {ov.duration.toFixed(1)}s
                                </span>
                              )}
                            </div>

                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Trim end of overlay ${labelText}`}
                              data-testid={`media-trim-end-handle-${ov.id}`}
                              draggable={false}
                              onContextMenu={(e) => e.preventDefault()}
                              onDragStart={(e) => e.preventDefault()}
                              onPointerDown={(e) => startOverlayTrim(e, 'media', ov, 'trim-end')}
                              className={`w-4 h-full rounded-r-[5px] flex items-center justify-center shrink-0 cursor-ew-resize touch-none transition-colors ${
                                isSelected || dragMode === 'trim-end'
                                  ? 'bg-white text-zinc-900'
                                  : 'bg-white/10 hover:bg-white/30 text-white/80'
                              }`}
                            >
                              <span
                                className={`pointer-events-none w-0.5 h-3.5 rounded-full ${
                                  isSelected || dragMode === 'trim-end'
                                    ? 'bg-pink-600'
                                    : 'bg-white/75'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })()}

              {/* Track 3: Text Overlays (CapCut-style 1s hold-to-move + side trim handles) */}
              {(() => {
                const laneEnds: number[] = [];
                const lanedOverlays = overlays.map((overlay) => {
                  let laneIndex = laneEnds.findIndex((end) => end <= overlay.startTime + 0.01);
                  if (laneIndex === -1) {
                    laneIndex = laneEnds.length;
                    laneEnds.push(overlay.startTime + overlay.duration);
                  } else {
                    laneEnds[laneIndex] = overlay.startTime + overlay.duration;
                  }
                  return { overlay, laneIndex };
                });
                const laneCount = Math.max(1, laneEnds.length);
                const laneHeight = 32;
                const trackHeightPx = laneCount * laneHeight + 4;

                return (
                  <div
                    style={{ height: `${trackHeightPx}px` }}
                    className="relative rounded-lg bg-white/[0.02] border border-white/5 flex items-center"
                  >
                    {overlays.length === 0 ? (
                      <span className="px-2.5 text-[11px] text-zinc-600 flex items-center gap-1.5">
                        <Type className="w-3 h-3" />
                        <span>Text track empty</span>
                      </span>
                    ) : (
                      lanedOverlays.map(({ overlay, laneIndex }) => {
                        const leftPx = overlay.startTime * zoomPxPerSec;
                        const widthPx = Math.max(68, overlay.duration * zoomPxPerSec);
                        const isSelected = overlay.id === selectedOverlayId;
                        const dragMode =
                          activeOverlayDrag?.kind === 'text' &&
                          activeOverlayDrag.overlayId === overlay.id
                            ? activeOverlayDrag.mode
                            : 'idle';
                        const isMoving = dragMode === 'moving';
                        const isHolding = dragMode === 'holding';
                        const isTrimming = dragMode === 'trim-start' || dragMode === 'trim-end';
                        const topPx = 3 + laneIndex * laneHeight;
                        const labelText = overlay.text || 'Text';

                        return (
                          <div
                            key={overlay.id}
                            data-testid={`timeline-text-bar-${overlay.id}`}
                            data-overlay-id={overlay.id}
                            data-drag-state={dragMode}
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            aria-label={`Text layer ${labelText}, ${overlay.startTime.toFixed(1)}s to ${(
                              overlay.startTime + overlay.duration
                            ).toFixed(1)}s. Hold 1 second and drag to move, or drag edges to resize.`}
                            onContextMenu={(e) => e.preventDefault()}
                            onDragStart={(e) => e.preventDefault()}
                            onPointerDown={(e) => startOverlayBodyHold(e, 'text', overlay)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectOverlay(overlay.id);
                              }
                            }}
                            style={{
                              left: `${leftPx}px`,
                              width: `${widthPx}px`,
                              top: `${2 + laneIndex * laneHeight}px`,
                              height: '28px',
                              WebkitTouchCallout: 'none',
                              WebkitUserSelect: 'none',
                            }}
                            className={`group ${isMoving ? 'touch-none' : 'touch-pan-x'} absolute rounded-md border flex items-stretch text-[11px] font-medium select-none transition-transform ${
                              isMoving
                                ? 'z-30 cursor-grabbing scale-[1.03] -translate-y-0.5 bg-pink-500/45 border-white text-white ring-2 ring-pink-400/85 shadow-[0_8px_20px_rgba(236,72,153,0.45)]'
                                : isTrimming
                                  ? 'z-30 bg-pink-500/35 border-white text-white ring-1 ring-pink-400'
                                  : isHolding
                                    ? 'z-20 bg-pink-500/35 border-pink-300 text-white ring-1 ring-pink-300/60'
                                    : isSelected
                                      ? 'z-10 bg-pink-500/30 border-pink-400 text-white cursor-grab'
                                      : 'bg-purple-500/20 border-purple-400/40 text-purple-100 hover:border-purple-300/70 cursor-pointer'
                            }`}
                          >
                            {/* Left CapCut-style duration trim handle */}
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Trim start of ${labelText}`}
                              data-testid={`trim-start-handle-${overlay.id}`}
                              draggable={false}
                              onContextMenu={(e) => e.preventDefault()}
                              onDragStart={(e) => e.preventDefault()}
                              onPointerDown={(e) => startOverlayTrim(e, 'text', overlay, 'trim-start')}
                              className={`w-4 h-full rounded-l-[5px] flex items-center justify-center shrink-0 cursor-ew-resize touch-none transition-colors ${
                                isSelected || dragMode === 'trim-start'
                                  ? 'bg-white text-zinc-900'
                                  : 'bg-white/10 hover:bg-white/30 text-white/80'
                              }`}
                            >
                              <span
                                className={`pointer-events-none w-0.5 h-3.5 rounded-full ${
                                  isSelected || dragMode === 'trim-start'
                                    ? 'bg-pink-600'
                                    : 'bg-white/75'
                                }`}
                              />
                            </div>

                            {/* Center text label + visual hold charge fill */}
                            <div className="relative flex-1 min-w-0 px-1.5 flex items-center justify-between gap-1 overflow-hidden pointer-events-none">
                              {isHolding && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-0 bg-gradient-to-r from-pink-500/45 to-purple-500/45 animate-hold-fill"
                                />
                              )}
                              <span className="relative z-10 flex items-center gap-1 min-w-0">
                                <Type className="w-3 h-3 shrink-0" />
                                <span className="truncate">{labelText}</span>
                              </span>
                              {widthPx >= 96 && (
                                <span className="relative z-10 font-mono-tabular text-[10px] opacity-80 shrink-0">
                                  {overlay.duration.toFixed(1)}s
                                </span>
                              )}
                            </div>

                            {/* Right CapCut-style duration trim handle */}
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Trim end of ${labelText}`}
                              data-testid={`trim-end-handle-${overlay.id}`}
                              draggable={false}
                              onContextMenu={(e) => e.preventDefault()}
                              onDragStart={(e) => e.preventDefault()}
                              onPointerDown={(e) => startOverlayTrim(e, 'text', overlay, 'trim-end')}
                              className={`w-4 h-full rounded-r-[5px] flex items-center justify-center shrink-0 cursor-ew-resize touch-none transition-colors ${
                                isSelected || dragMode === 'trim-end'
                                  ? 'bg-white text-zinc-900'
                                  : 'bg-white/10 hover:bg-white/30 text-white/80'
                              }`}
                            >
                              <span
                                className={`pointer-events-none w-0.5 h-3.5 rounded-full ${
                                  isSelected || dragMode === 'trim-end'
                                    ? 'bg-pink-600'
                                    : 'bg-white/75'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })()}

              {/* Track 3: Music / Audio */}
              <div className="h-7 sm:h-8 relative rounded-lg bg-white/[0.02] border border-white/5 flex items-center">
                {audioTracks.length === 0 ? (
                  <button
                    type="button"
                    onClick={onOpenAudioTool}
                    className="px-2.5 h-full w-full text-left text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5"
                  >
                    <Music className="w-3 h-3 text-purple-400" />
                    <span>Tap to add music or sound</span>
                  </button>
                ) : (
                  audioTracks.map((track) => {
                    const displayDur = Math.min(track.duration, Math.max(totalDuration, 4));
                    const leftPx = track.startTime * zoomPxPerSec;
                    const widthPx = Math.max(60, displayDur * zoomPxPerSec);
                    return (
                      <button
                        key={track.id}
                        type="button"
                        onClick={onOpenAudioTool}
                        style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        className={`absolute top-1 bottom-1 px-2.5 rounded-md border flex items-center justify-between gap-2 text-[11px] font-medium truncate ${
                          track.muted
                            ? 'bg-zinc-800/70 border-zinc-700 text-zinc-400'
                            : 'bg-gradient-to-r from-purple-600/30 to-pink-600/30 border-purple-400/40 text-zinc-100'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Music className="w-3 h-3 shrink-0 text-pink-400" />
                          <span className="truncate">{track.name}</span>
                        </span>
                        <span className="font-mono-tabular text-[10px] text-zinc-300 shrink-0">
                          {track.muted ? 'Muted' : `${Math.round(track.volume * 100)}%`}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right center-alignment spacer */}
            <div
              aria-hidden="true"
              style={{ width: `${halfViewportPx}px` }}
              className="shrink-0"
            />
          </div>
        </div>

        {/* Subtle edge auto-scroll feedback glow when extending/dragging near viewport borders */}
        {edgeAutoScrollDir === 'left' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-7 z-20 bg-gradient-to-r from-pink-500/35 to-transparent"
          />
        )}
        {edgeAutoScrollDir === 'right' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-7 z-20 bg-gradient-to-l from-pink-500/35 to-transparent"
          />
        )}

        {/* Fixed Center White Playhead Indicator (CapCut-style stationary needle) */}
        <div
          data-testid="timeline-center-playhead"
          className="pointer-events-none absolute top-2.5 bottom-2.5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center"
        >
          <div className="w-3 h-3 rounded-sm rotate-45 bg-gradient-to-br from-pink-400 to-purple-500 border border-white shadow" />
          <div className="w-0.5 flex-1 bg-white shadow-[0_0_8px_rgba(236,72,153,0.75)]" />
        </div>
      </div>

      {/* Subtle mobile timecode readout if needed */}
      <div className="sr-only">{formatTimecode(currentTime)}</div>
    </section>
  );
}
