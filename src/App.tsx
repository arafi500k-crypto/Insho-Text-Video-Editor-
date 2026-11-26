import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AudioPanel } from './components/AudioPanel';
import { BottomToolBar, TOOL_ITEMS } from './components/BottomToolBar';
import { ChromaKeyPanel } from './components/ChromaKeyPanel';
import { EditClipPanel } from './components/EditClipPanel';
import { ExportModal } from './components/ExportModal';
import { FilterPanel } from './components/FilterPanel';
import { HomeScreen, type HomeTab } from './components/HomeScreen';
import { MediaBinPanel } from './components/MediaBinPanel';
import { OverlayPanel } from './components/OverlayPanel';
import { PreviewPlayer } from './components/PreviewPlayer';
import { TextOverlayPanel } from './components/TextOverlayPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { TopHeader } from './components/TopHeader';
import { TransitionPanel } from './components/TransitionPanel';
import type {
  AspectRatioPreset,
  AudioTrackItem,
  ClipFilter,
  EditorTool,
  MediaAsset,
  MediaOverlay,
  ProjectDraft,
  TextOverlay,
  TimelineClip,
  TransitionType,
} from './types/editor';
import {
  createBuiltInAudioTrack,
  importAudioFile,
  type BuiltInTrackSpec,
} from './utils/audioEngine';
import {
  pauseAllCachedVideos,
  primeActiveVideoFromUserGesture,
  sampleMediaOverlayColorAtNormalized,
  syncVideoElementsForTime,
} from './utils/canvasRenderer';
import { buildProjectDraft, upsertDraftRecord } from './utils/drafts';
import {
  deleteProjectDraftRecord,
  hydrateDraftAssets,
  loadAllProjectDrafts,
  saveProjectDraftRecord,
  saveStoredAsset,
} from './utils/draftStorage';
import { createSampleAssets, getOrCreateVideoElement, importMediaFile } from './utils/mediaLoader';
import {
  DEFAULT_CHROMA_KEY,
  DEFAULT_CLIP_CROP,
  DEFAULT_CLIP_FILTER,
  MIN_CLIP_TRIM_DURATION,
  clamp,
  computeClipSegments,
  deriveTimelineTimeFromVideo,
  findActiveSegmentAtTime,
  getTotalTimelineDuration,
  pickBestAspectRatioForAsset,
  reorderClip,
  shouldHoldPlayheadForVideo,
  splitClipAtTime,
} from './utils/timeline';

interface HistorySnapshot {
  clips: TimelineClip[];
  overlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  audioTracks: AudioTrackItem[];
  aspectRatio: AspectRatioPreset;
}

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [homeTab, setHomeTab] = useState<HomeTab>('edit');
  const [drafts, setDrafts] = useState<ProjectDraft[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [mediaOverlays, setMediaOverlays] = useState<MediaOverlay[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioPreset>('9:16');

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedMediaOverlayId, setSelectedMediaOverlayId] = useState<string | null>(null);
  const [chromaPickerActive, setChromaPickerActive] = useState(false);
  const [chromaKeyPanelOpen, setChromaKeyPanelOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>('edit');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [zoomPxPerSec, setZoomPxPerSec] = useState(64);

  const [importingMedia, setImportingMedia] = useState(false);
  const [importingOverlayMedia, setImportingOverlayMedia] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const [history, setHistory] = useState<HistorySnapshot[]>([]);

  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const overlayInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const playbackAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastRafRef = useRef<number | null>(null);
  const liveTimeRef = useRef<number>(0);
  if (!isPlaying) {
    liveTimeRef.current = currentTime;
  }

  const assetsById = useMemo(() => {
    const map = new Map<string, MediaAsset>();
    for (const a of assets) map.set(a.id, a);
    return map;
  }, [assets]);

  const totalDuration = useMemo(() => getTotalTimelineDuration(clips), [clips]);
  const segments = useMemo(() => computeClipSegments(clips), [clips]);

  const selectedClipIndex = useMemo(
    () => clips.findIndex((c) => c.id === selectedClipId),
    [clips, selectedClipId],
  );
  const selectedClip = selectedClipIndex >= 0 ? clips[selectedClipIndex] : null;
  const selectedOverlay = useMemo(
    () => overlays.find((o) => o.id === selectedOverlayId) ?? null,
    [overlays, selectedOverlayId],
  );
  const selectedMediaOverlay = useMemo(
    () => mediaOverlays.find((m) => m.id === selectedMediaOverlayId) ?? null,
    [mediaOverlays, selectedMediaOverlayId],
  );

  const pushHistory = useCallback(() => {
    setHistory((prev) => [
      ...prev.slice(-19),
      {
        clips: clips.map((c) => ({ ...c, filter: { ...c.filter }, crop: { ...c.crop } })),
        overlays: overlays.map((o) => ({ ...o })),
        mediaOverlays: mediaOverlays.map((m) => ({
          ...m,
          chromaKey: { ...m.chromaKey },
        })),
        audioTracks: audioTracks.map((a) => ({ ...a })),
        aspectRatio,
      },
    ]);
  }, [clips, overlays, mediaOverlays, audioTracks, aspectRatio]);

  const handleUndo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setClips(last.clips);
      setOverlays(last.overlays);
      setMediaOverlays(last.mediaOverlays);
      setAudioTracks(last.audioTracks);
      setAspectRatio(last.aspectRatio);
      return prev.slice(0, -1);
    });
  };

  // Load initial sample reel on mount so the studio is immediately playable
  const loadSampleProject = useCallback(async () => {
    const samples = await createSampleAssets();
    setAssets((prev) => {
      const existingIds = new Set(prev.map((a) => a.id));
      const merged = [...prev];
      for (const s of samples) {
        if (!existingIds.has(s.id)) merged.push(s);
      }
      return merged;
    });

    const initialClips: TimelineClip[] = [
      {
        id: 'clip-sample-1',
        assetId: samples[0].id,
        label: 'Tokyo Rain',
        kind: 'image',
        sourceDuration: 10,
        trimStart: 0,
        trimEnd: 3.5,
        speed: 1,
        volume: 1,
        muted: false,
        filter: { ...DEFAULT_CLIP_FILTER },
        crop: { ...DEFAULT_CLIP_CROP },
        transitionIn: 'none',
        transitionDuration: 0.5,
      },
      {
        id: 'clip-sample-2',
        assetId: samples[1].id,
        label: 'Violet Dancer',
        kind: 'image',
        sourceDuration: 10,
        trimStart: 0,
        trimEnd: 3.5,
        speed: 1,
        volume: 1,
        muted: false,
        filter: { ...DEFAULT_CLIP_FILTER },
        crop: { ...DEFAULT_CLIP_CROP },
        transitionIn: 'dissolve',
        transitionDuration: 0.6,
      },
      {
        id: 'clip-sample-3',
        assetId: samples[2].id,
        label: 'Magenta Coast',
        kind: 'image',
        sourceDuration: 10,
        trimStart: 0,
        trimEnd: 3.5,
        speed: 1,
        volume: 1,
        muted: false,
        filter: { ...DEFAULT_CLIP_FILTER },
        crop: { ...DEFAULT_CLIP_CROP },
        transitionIn: 'slide-left',
        transitionDuration: 0.5,
      },
    ];

    const initialOverlay: TextOverlay = {
      id: 'text-sample-1',
      text: 'INSHO TEXT',
      startTime: 0,
      duration: 3.5,
      x: 0.5,
      y: 0.78,
      rotation: 0,
      fontFamily: 'Outfit',
      fontSize: 64,
      color: '#ffffff',
      boxStyle: 'pink-purple',
      align: 'center',
      opacity: 1,
      animation: 'pop',
    };

    setClips(initialClips);
    setOverlays([initialOverlay]);
    setSelectedClipId(initialClips[0].id);
    setSelectedOverlayId(initialOverlay.id);
    setCurrentTime(0);
    setIsPlaying(false);
    setCurrentDraftId((prev) => prev ?? makeUid('draft'));
    setScreen('editor');
  }, []);

  // Load saved drafts on mount without loading any default video into the editor
  useEffect(() => {
    void loadAllProjectDrafts().then((loaded) => {
      setDrafts(loaded);
    });
  }, []);

  // Auto-save active project as a draft whenever clips/overlays/audio/aspect change
  useEffect(() => {
    if (screen !== 'editor' || clips.length === 0) return;
    const draftId = currentDraftId ?? makeUid('draft');
    if (!currentDraftId) {
      setCurrentDraftId(draftId);
    }
    const timer = window.setTimeout(() => {
      const draft = buildProjectDraft({
        id: draftId,
        updatedAt: Date.now(),
        aspectRatio,
        clips,
        overlays,
        mediaOverlays,
        audioTracks,
        assetsById,
      });
      setDrafts((prev) => upsertDraftRecord(prev, draft));
      void saveProjectDraftRecord(draft);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    screen,
    currentDraftId,
    clips,
    overlays,
    mediaOverlays,
    audioTracks,
    aspectRatio,
    assetsById,
  ]);

  // Keep currentTime clamped when timeline shrinks
  useEffect(() => {
    if (totalDuration === 0) {
      setCurrentTime(0);
      setIsPlaying(false);
    } else if (currentTime > totalDuration) {
      setCurrentTime(totalDuration);
    }
  }, [totalDuration, currentTime]);

  const activeSegment = useMemo(
    () => findActiveSegmentAtTime(segments, currentTime),
    [segments, currentTime],
  );
  const activeClipKey = activeSegment ? `${activeSegment.index}:${activeSegment.clip.id}` : 'none';
  const activeVideoOverlayKey = useMemo(
    () =>
      mediaOverlays
        .filter(
          (m) =>
            m.kind === 'video' &&
            currentTime >= m.startTime &&
            currentTime <= m.startTime + m.duration,
        )
        .map((m) => m.id)
        .join(','),
    [mediaOverlays, currentTime],
  );

  const mediaSyncKey = useMemo(
    () =>
      [
        ...clips.map((c) => `${c.id}:${c.assetId}:${c.trimStart}:${c.trimEnd}:${c.speed}:${c.muted}:${c.volume}`),
        ...mediaOverlays
          .filter((m) => m.kind === 'video')
          .map((m) => `${m.id}:${m.assetId}:${m.startTime}:${m.duration}`),
      ].join('|'),
    [clips, mediaOverlays],
  );

  // Sync video elements cleanly on play/pause, clip switches, video overlay enter/exit, or manual seeks
  useEffect(() => {
    if (screen !== 'editor') {
      pauseAllCachedVideos();
      return;
    }
    if (exportModalOpen) return;
    const syncTime = isPlaying ? liveTimeRef.current : currentTime;
    void syncVideoElementsForTime(clips, assetsById, syncTime, isPlaying, mediaOverlays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, exportModalOpen, isPlaying, activeClipKey, activeVideoOverlayKey, mediaSyncKey, assetsById, isPlaying ? 0 : currentTime]);

  // Sync music audio tracks when seeking or playing
  useEffect(() => {
    if (audioTracks.length === 0 && playbackAudioRefs.current.size === 0) return;

    if (screen !== 'editor') {
      for (const audioEl of playbackAudioRefs.current.values()) {
        if (!audioEl.paused) audioEl.pause();
      }
      return;
    }

    for (const track of audioTracks) {
      let audioEl = playbackAudioRefs.current.get(track.id);
      if (!audioEl) {
        audioEl = new Audio(track.src);
        audioEl.loop = true;
        playbackAudioRefs.current.set(track.id, audioEl);
      }
      audioEl.muted = track.muted;
      audioEl.volume = clamp(track.volume, 0, 1);

      const relTime = Math.max(0, currentTime - track.startTime);
      if (Math.abs(audioEl.currentTime - (relTime % Math.max(1, track.duration))) > 0.35) {
        try {
          audioEl.currentTime = relTime % Math.max(1, track.duration);
        } catch {
          // ignore
        }
      }

      if (isPlaying && currentTime >= track.startTime && !track.muted) {
        if (audioEl.paused) {
          audioEl.play().catch(() => {});
        }
      } else if (!audioEl.paused) {
        audioEl.pause();
      }
    }
  }, [screen, audioTracks, currentTime, isPlaying]);

  // Real-time playback loop: advances liveTimeRef at 60Hz for smooth canvas/spin while
  // throttling React UI state updates to ~30Hz so DOM/timeline layout never drops frames
  useEffect(() => {
    if (!isPlaying || totalDuration <= 0 || screen !== 'editor') {
      lastRafRef.current = null;
      return;
    }

    let frameId = 0;
    let lastUiSyncMs = performance.now();
    let lastResumeAttemptMs = 0;

    const step = (now: number) => {
      if (lastRafRef.current === null) {
        lastRafRef.current = now;
      }
      const dt = Math.min(0.1, (now - lastRafRef.current) / 1000);
      lastRafRef.current = now;

      const prev = liveTimeRef.current;
      const seg = findActiveSegmentAtTime(segments, prev);
      const asset = seg ? assetsById.get(seg.clip.assetId) : undefined;

      let nextTime = prev + dt;
      let looped = false;
      let stoppedAtEnd = false;

      if (seg && asset?.kind === 'video') {
        const video = getOrCreateVideoElement(asset.id, asset.src);
        const clipFinished =
          !video.seeking &&
          video.readyState >= 2 &&
          (video.ended || (!video.paused && video.currentTime >= seg.clip.trimEnd - 0.02));
        if (clipFinished) {
          const afterSeg = seg.endTime + 0.001;
          if (afterSeg >= totalDuration) {
            if (loopEnabled) {
              nextTime = 0;
              looped = true;
            } else {
              nextTime = totalDuration;
              stoppedAtEnd = true;
            }
          } else {
            nextTime = afterSeg;
          }
        } else {
          const holdStatus = shouldHoldPlayheadForVideo({
            readyState: video.readyState,
            seeking: video.seeking,
            ended: video.ended,
            paused: video.paused,
            currentTime: video.currentTime,
            trimEnd: seg.clip.trimEnd,
          });
          if (holdStatus.holdClock) {
            nextTime = prev;
            if (holdStatus.needsResumePlay && now - lastResumeAttemptMs >= 250) {
              lastResumeAttemptMs = now;
              video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {});
              });
            }
          } else {
            const videoTimeline = deriveTimelineTimeFromVideo(seg, video.currentTime);
            const drift = videoTimeline - nextTime;
            if (Math.abs(drift) > 0.15) {
              nextTime = Math.max(prev, videoTimeline);
            } else {
              nextTime = Math.max(prev, nextTime + drift * 0.2);
            }
            if (nextTime >= seg.endTime && seg.endTime >= totalDuration) {
              if (loopEnabled) {
                nextTime = 0;
                looped = true;
              } else {
                nextTime = totalDuration;
                stoppedAtEnd = true;
              }
            }
          }
        }
      } else if (nextTime >= totalDuration) {
        if (loopEnabled) {
          nextTime = 0;
          looped = true;
        } else {
          nextTime = totalDuration;
          stoppedAtEnd = true;
        }
      }

      liveTimeRef.current = nextTime;

      if (looped) {
        void syncVideoElementsForTime(clips, assetsById, 0, true, mediaOverlays);
        lastUiSyncMs = now;
        setCurrentTime(0);
      } else if (stoppedAtEnd) {
        pauseAllCachedVideos();
        setCurrentTime(totalDuration);
        setIsPlaying(false);
        return;
      } else if (now - lastUiSyncMs >= 33) {
        lastUiSyncMs = now;
        setCurrentTime(nextTime);
      }

      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frameId);
      lastRafRef.current = null;
    };
  }, [isPlaying, totalDuration, loopEnabled, screen, segments, clips, mediaOverlays, assetsById]);

  const canSplitAtPlayhead = useMemo(() => {
    if (!selectedClip) return false;
    const seg = segments.find((s) => s.clip.id === selectedClip.id);
    if (!seg) return false;
    const minEdge = MIN_CLIP_TRIM_DURATION / seg.clip.speed;
    const offset = currentTime - seg.startTime;
    return offset > minEdge && seg.duration - offset > minEdge;
  }, [selectedClip, segments, currentTime]);

  const handleMediaFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImportingMedia(true);
    setImportError(null);

    try {
      const addedAssets: MediaAsset[] = [];
      for (const file of Array.from(files)) {
        const asset = await importMediaFile(file, makeUid('asset'));
        addedAssets.push(asset);
        void saveStoredAsset(asset, file);
      }

      if (addedAssets.length > 0) {
        const newClips: TimelineClip[] = addedAssets.map((asset) => ({
          id: makeUid('clip'),
          assetId: asset.id,
          label: asset.name,
          kind: asset.kind,
          sourceDuration: asset.duration,
          trimStart: 0,
          trimEnd: asset.kind === 'image' ? 3.5 : asset.duration,
          speed: 1,
          volume: 1,
          muted: false,
          filter: { ...DEFAULT_CLIP_FILTER },
          crop: { ...DEFAULT_CLIP_CROP },
          transitionIn: 'none',
          transitionDuration: 0.5,
        }));

        const nextAssetsMap = new Map(assetsById);
        for (const a of addedAssets) nextAssetsMap.set(a.id, a);
        setAssets((prev) => [...addedAssets, ...prev]);

        if (screen === 'home') {
          // Starting a fresh project directly from the Home screen picker
          const freshDraftId = makeUid('draft');
          const matchedAspectRatio = pickBestAspectRatioForAsset(
            addedAssets[0].width,
            addedAssets[0].height,
          );
          setCurrentDraftId(freshDraftId);
          setAspectRatio(matchedAspectRatio);
          setClips(newClips);
          setOverlays([]);
          setMediaOverlays([]);
          setAudioTracks([]);
          setHistory([]);
          setCurrentTime(0);
          setIsPlaying(false);
          setSelectedClipId(newClips[0].id);
          setSelectedOverlayId(null);
          setSelectedMediaOverlayId(null);
          setChromaPickerActive(false);
          setActiveTool('edit');
          setScreen('editor');

          const draft = buildProjectDraft({
            id: freshDraftId,
            updatedAt: Date.now(),
            aspectRatio: matchedAspectRatio,
            clips: newClips,
            overlays: [],
            mediaOverlays: [],
            audioTracks: [],
            assetsById: nextAssetsMap,
          });
          setDrafts((prev) => upsertDraftRecord(prev, draft));
          void saveProjectDraftRecord(draft);
        } else {
          pushHistory();
          setClips((prev) => [...prev, ...newClips]);
          setSelectedClipId(newClips[0].id);
          setActiveTool('edit');
        }
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import media file.');
    } finally {
      setImportingMedia(false);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  };

  const handleOpenDraft = async (draftId: string) => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;

    const hydrated = await hydrateDraftAssets(draft.assetIds, assetsById);
    if (hydrated.length > 0) {
      setAssets((prev) => {
        const existing = new Set(prev.map((a) => a.id));
        const merged = [...prev];
        for (const h of hydrated) {
          if (!existing.has(h.id)) merged.push(h);
        }
        return merged;
      });
    }

    setCurrentDraftId(draft.id);
    setAspectRatio(draft.aspectRatio);
    setClips(draft.clips.map((c) => ({ ...c, filter: { ...c.filter }, crop: { ...c.crop } })));
    setOverlays(draft.overlays.map((o) => ({ ...o })));
    setMediaOverlays(
      (draft.mediaOverlays ?? []).map((m) => ({
        ...m,
        chromaKey: { ...m.chromaKey },
      })),
    );
    setAudioTracks(draft.audioTracks.map((a) => ({ ...a })));
    setSelectedClipId(draft.clips[0]?.id ?? null);
    setSelectedOverlayId(draft.overlays[0]?.id ?? null);
    setSelectedMediaOverlayId(draft.mediaOverlays?.[0]?.id ?? null);
    setChromaPickerActive(false);
    setHistory([]);
    setCurrentTime(0);
    setIsPlaying(false);
    setActiveTool('edit');
    setScreen('editor');
  };

  const handleDeleteDraft = (draftId: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    void deleteProjectDraftRecord(draftId);
  };

  const handleBackHome = () => {
    setIsPlaying(false);
    setChromaPickerActive(false);
    pauseAllCachedVideos();
    if (clips.length > 0) {
      const draftId = currentDraftId ?? makeUid('draft');
      const draft = buildProjectDraft({
        id: draftId,
        updatedAt: Date.now(),
        aspectRatio,
        clips,
        overlays,
        mediaOverlays,
        audioTracks,
        assetsById,
      });
      setDrafts((prev) => upsertDraftRecord(prev, draft));
      void saveProjectDraftRecord(draft);
    }
    setScreen('home');
  };

  const handleAudioFileSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAudioError(null);
    try {
      const track = await importAudioFile(files[0], makeUid('audio'));
      pushHistory();
      setAudioTracks((prev) => [...prev, track]);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Failed to load audio file.');
    } finally {
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  };

  const handleAddAssetToTimeline = (asset: MediaAsset) => {
    pushHistory();
    const newClip: TimelineClip = {
      id: makeUid('clip'),
      assetId: asset.id,
      label: asset.name,
      kind: asset.kind,
      sourceDuration: asset.duration,
      trimStart: 0,
      trimEnd: asset.kind === 'image' ? 3.5 : asset.duration,
      speed: 1,
      volume: 1,
      muted: false,
      filter: { ...DEFAULT_CLIP_FILTER },
      crop: { ...DEFAULT_CLIP_CROP },
      transitionIn: 'none',
      transitionDuration: 0.5,
    };
    setClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
  };

  const handleUpdateClip = (
    clipId: string,
    updater: (prev: TimelineClip) => TimelineClip,
  ) => {
    setClips((prev) => prev.map((c) => (c.id === clipId ? updater(c) : c)));
  };

  const handleSplitAtPlayhead = () => {
    if (!selectedClip) return;
    const splitResult = splitClipAtTime(clips, selectedClip.id, currentTime, () =>
      makeUid('clip'),
    );
    if (!splitResult) return;
    pushHistory();
    setClips(splitResult);
  };

  const handleDuplicateClip = (clipId: string) => {
    const idx = clips.findIndex((c) => c.id === clipId);
    if (idx === -1) return;
    pushHistory();
    const orig = clips[idx];
    const copy: TimelineClip = {
      ...orig,
      id: makeUid('clip'),
      label: `${orig.label} Copy`,
      filter: { ...orig.filter },
      crop: { ...orig.crop },
    };
    const next = [...clips];
    next.splice(idx + 1, 0, copy);
    setClips(next);
    setSelectedClipId(copy.id);
  };

  const handleReorderClip = (clipId: string, direction: 'left' | 'right') => {
    pushHistory();
    setClips((prev) => reorderClip(prev, clipId, direction));
  };

  const handleDeleteClip = (clipId: string) => {
    pushHistory();
    setClips((prev) => {
      const next = prev.filter((c) => c.id !== clipId);
      if (selectedClipId === clipId) {
        setSelectedClipId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleAddTextOverlay = () => {
    if (totalDuration <= 0) return;
    pushHistory();
    const start = Number(clamp(currentTime, 0, Math.max(0, totalDuration - 0.5)).toFixed(1));
    const dur = Number(Math.min(3.0, Math.max(0.8, totalDuration - start)).toFixed(1));
    const newOverlay: TextOverlay = {
      id: makeUid('text'),
      text: 'New Caption',
      startTime: start,
      duration: dur,
      x: 0.5,
      y: 0.5,
      rotation: 0,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 56,
      color: '#ffffff',
      boxStyle: 'obsidian',
      align: 'center',
      opacity: 1,
      animation: 'none',
    };
    setOverlays((prev) => [...prev, newOverlay]);
    setSelectedOverlayId(newOverlay.id);
    setSelectedMediaOverlayId(null);
    setChromaPickerActive(false);
    setActiveTool('text');
    setMobileDrawerOpen(true);
  };

  const handleUpdateOverlay = (
    id: string,
    updater: (prev: TextOverlay) => TextOverlay,
  ) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? updater(o) : o)));
  };

  const handleDeleteOverlay = (id: string) => {
    pushHistory();
    setOverlays((prev) => {
      const next = prev.filter((o) => o.id !== id);
      if (selectedOverlayId === id) {
        setSelectedOverlayId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleAddMediaOverlayFromAsset = (asset: MediaAsset) => {
    if (totalDuration <= 0) return;
    pushHistory();
    const start = Number(clamp(currentTime, 0, Math.max(0, totalDuration - 0.5)).toFixed(1));
    const defaultSpan = asset.kind === 'video' ? Math.min(asset.duration, 4) : 3;
    const dur = Number(
      clamp(Math.min(defaultSpan, totalDuration - start), 0.5, totalDuration).toFixed(1),
    );
    const offsetCount = mediaOverlays.length % 3;
    const newOv: MediaOverlay = {
      id: makeUid('mov'),
      assetId: asset.id,
      label: asset.name,
      kind: asset.kind,
      sourceDuration: asset.duration,
      startTime: start,
      duration: dur,
      x: 0.5 + (offsetCount - 1) * 0.04,
      y: 0.45 + (offsetCount - 1) * 0.04,
      scale: 0.46,
      rotation: 0,
      opacity: 1,
      spinEnabled: false,
      spinSpeed: 1,
      spinDirection: 'cw',
      chromaKey: { ...DEFAULT_CHROMA_KEY },
    };
    setMediaOverlays((prev) => [...prev, newOv]);
    setSelectedMediaOverlayId(newOv.id);
    setSelectedOverlayId(null);
    setChromaPickerActive(false);
    setActiveTool('overlay');
    setMobileDrawerOpen(false);
  };

  const handleOverlayFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0 || totalDuration <= 0) return;
    setImportingOverlayMedia(true);
    setImportError(null);
    try {
      const addedAssets: MediaAsset[] = [];
      for (const file of Array.from(files)) {
        const asset = await importMediaFile(file, makeUid('asset'));
        addedAssets.push(asset);
        void saveStoredAsset(asset, file);
      }
      if (addedAssets.length > 0) {
        setAssets((prev) => [...addedAssets, ...prev]);
        pushHistory();
        const start = Number(clamp(currentTime, 0, Math.max(0, totalDuration - 0.5)).toFixed(1));
        const created: MediaOverlay[] = addedAssets.map((asset, idx) => {
          const defaultSpan = asset.kind === 'video' ? Math.min(asset.duration, 4) : 3;
          const dur = Number(
            clamp(Math.min(defaultSpan, totalDuration - start), 0.5, totalDuration).toFixed(1),
          );
          return {
            id: makeUid('mov'),
            assetId: asset.id,
            label: asset.name,
            kind: asset.kind,
            sourceDuration: asset.duration,
            startTime: start,
            duration: dur,
            x: 0.5 + (idx % 3) * 0.04,
            y: 0.45 + (idx % 3) * 0.04,
            scale: 0.46,
            rotation: 0,
            opacity: 1,
            spinEnabled: false,
            spinSpeed: 1,
            spinDirection: 'cw',
            chromaKey: { ...DEFAULT_CHROMA_KEY },
          };
        });
        setMediaOverlays((prev) => [...prev, ...created]);
        setSelectedMediaOverlayId(created[0].id);
        setSelectedOverlayId(null);
        setChromaPickerActive(false);
        setActiveTool('overlay');
        setMobileDrawerOpen(false);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import overlay media.');
    } finally {
      setImportingOverlayMedia(false);
      if (overlayInputRef.current) overlayInputRef.current.value = '';
    }
  };

  const handleUpdateMediaOverlay = (
    id: string,
    updater: (prev: MediaOverlay) => MediaOverlay,
  ) => {
    setMediaOverlays((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  };

  const handleDeleteMediaOverlay = (id: string) => {
    pushHistory();
    setMediaOverlays((prev) => {
      const next = prev.filter((m) => m.id !== id);
      if (selectedMediaOverlayId === id) {
        setSelectedMediaOverlayId(next[0]?.id ?? null);
        setChromaPickerActive(false);
        setChromaKeyPanelOpen(false);
      }
      return next;
    });
  };

  const handleOpenChromaKeyPanel = (overlayId: string) => {
    const ov = mediaOverlays.find((m) => m.id === overlayId);
    if (!ov) return;
    setSelectedMediaOverlayId(overlayId);
    setSelectedOverlayId(null);
    setIsPlaying(false);

    if (currentTime < ov.startTime || currentTime > ov.startTime + ov.duration) {
      setCurrentTime(ov.startTime + 0.05);
    }

    if (!ov.chromaKey.enabled) {
      const asset = assetsById.get(ov.assetId);
      const sampled =
        sampleMediaOverlayColorAtNormalized(
          ov,
          asset,
          ov.chromaKey.pickerX,
          ov.chromaKey.pickerY,
        ) ?? ov.chromaKey.color;
      handleUpdateMediaOverlay(overlayId, (prev) => ({
        ...prev,
        chromaKey: {
          ...prev.chromaKey,
          enabled: true,
          color: sampled,
        },
      }));
    }

    setChromaKeyPanelOpen(true);
    setChromaPickerActive(true);
    setMobileDrawerOpen(false);
  };

  const handleToggleChromaPicker = (overlayId: string) => {
    const ov = mediaOverlays.find((m) => m.id === overlayId);
    if (!ov) return;
    setSelectedMediaOverlayId(overlayId);
    setSelectedOverlayId(null);
    setIsPlaying(false);

    if (!chromaPickerActive) {
      const asset = assetsById.get(ov.assetId);
      const sampled =
        sampleMediaOverlayColorAtNormalized(
          ov,
          asset,
          ov.chromaKey.pickerX,
          ov.chromaKey.pickerY,
        ) ?? ov.chromaKey.color;
      handleUpdateMediaOverlay(overlayId, (prev) => ({
        ...prev,
        chromaKey: {
          ...prev.chromaKey,
          enabled: true,
          color: sampled,
        },
      }));
      setChromaPickerActive(true);
    } else {
      setChromaPickerActive(false);
    }
  };

  const handleAddBuiltInTrack = (spec: BuiltInTrackSpec) => {
    pushHistory();
    const track = createBuiltInAudioTrack(spec);
    setAudioTracks((prev) => {
      const exists = prev.some((t) => t.id === track.id);
      if (exists) return prev;
      return [...prev, track];
    });
  };

  const handleSelectMobileTool = (tool: EditorTool) => {
    if (tool !== 'overlay') {
      setChromaPickerActive(false);
      setChromaKeyPanelOpen(false);
    }
    if (activeTool === tool && mobileDrawerOpen) {
      setMobileDrawerOpen(false);
    } else {
      setActiveTool(tool);
      setMobileDrawerOpen(true);
    }
  };

  const renderInspectorContent = () => {
    switch (activeTool) {
      case 'media':
        return (
          <MediaBinPanel
            assets={assets}
            importing={importingMedia}
            importError={importError}
            onTriggerImport={() => mediaInputRef.current?.click()}
            onAddAssetToTimeline={handleAddAssetToTimeline}
            onLoadSampleProject={() => void loadSampleProject()}
            onClearProject={() => {
              pushHistory();
              setClips([]);
              setOverlays([]);
              setMediaOverlays([]);
              setAudioTracks([]);
              setSelectedClipId(null);
              setSelectedOverlayId(null);
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            hasClips={clips.length > 0}
          />
        );
      case 'edit':
        return (
          <EditClipPanel
            clip={selectedClip}
            clipIndex={selectedClipIndex}
            totalClips={clips.length}
            canSplit={canSplitAtPlayhead}
            onUpdateClip={handleUpdateClip}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onDuplicateClip={handleDuplicateClip}
            onReorderClip={handleReorderClip}
            onDeleteClip={handleDeleteClip}
          />
        );
      case 'overlay':
        return (
          <OverlayPanel
            mediaOverlays={mediaOverlays}
            selectedMediaOverlay={selectedMediaOverlay}
            assets={assets}
            totalDuration={totalDuration}
            chromaPickerActive={chromaPickerActive}
            importingOverlay={importingOverlayMedia}
            onTriggerOverlayImport={() => overlayInputRef.current?.click()}
            onAddOverlayFromAsset={handleAddMediaOverlayFromAsset}
            onSelectMediaOverlay={(id) => {
              setSelectedMediaOverlayId(id);
              setSelectedOverlayId(null);
            }}
            onUpdateMediaOverlay={handleUpdateMediaOverlay}
            onDeleteMediaOverlay={handleDeleteMediaOverlay}
            onToggleChromaPicker={handleOpenChromaKeyPanel}
          />
        );
      case 'text':
        return (
          <TextOverlayPanel
            overlays={overlays}
            selectedOverlay={selectedOverlay}
            totalDuration={totalDuration}
            onAddOverlay={handleAddTextOverlay}
            onSelectOverlay={(id) => {
              setSelectedOverlayId(id);
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
            }}
            onUpdateOverlay={handleUpdateOverlay}
            onDeleteOverlay={handleDeleteOverlay}
          />
        );
      case 'filter':
        return (
          <FilterPanel
            clip={selectedClip}
            onUpdateClip={handleUpdateClip}
            onApplyFilterToAll={(filter: ClipFilter) => {
              pushHistory();
              setClips((prev) =>
                prev.map((c) => ({ ...c, filter: { ...filter } })),
              );
            }}
          />
        );
      case 'audio':
        return (
          <AudioPanel
            selectedClip={selectedClip}
            audioTracks={audioTracks}
            audioError={audioError}
            onUpdateClip={handleUpdateClip}
            onTriggerAudioImport={() => audioInputRef.current?.click()}
            onAddBuiltInTrack={handleAddBuiltInTrack}
            onUpdateAudioTrack={(id, updater) =>
              setAudioTracks((prev) =>
                prev.map((t) => (t.id === id ? updater(t) : t)),
              )
            }
            onDeleteAudioTrack={(id) => {
              pushHistory();
              const audioEl = playbackAudioRefs.current.get(id);
              if (audioEl) {
                audioEl.pause();
                playbackAudioRefs.current.delete(id);
              }
              setAudioTracks((prev) => prev.filter((t) => t.id !== id));
            }}
          />
        );
      case 'transition':
        return (
          <TransitionPanel
            clip={selectedClip}
            clipIndex={selectedClipIndex}
            onUpdateClip={handleUpdateClip}
            onApplyTransitionToAll={(type: TransitionType, duration: number) => {
              pushHistory();
              setClips((prev) =>
                prev.map((c, idx) =>
                  idx === 0
                    ? c
                    : { ...c, transitionIn: type, transitionDuration: duration },
                ),
              );
            }}
          />
        );
    }
  };

  const hiddenInputs = (
    <>
      {/* Hidden native file pickers (Capacitor/Android gallery compatible) */}
      <input
        ref={mediaInputRef}
        data-testid="media-file-input"
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => void handleMediaFilesSelected(e.target.files)}
      />
      <input
        ref={overlayInputRef}
        data-testid="overlay-file-input"
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => void handleOverlayFilesSelected(e.target.files)}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleAudioFileSelected(e.target.files)}
      />
    </>
  );

  if (screen === 'home') {
    return (
      <>
        {hiddenInputs}
        <HomeScreen
          activeTab={homeTab}
          drafts={drafts}
          importingMedia={importingMedia}
          importError={importError}
          onChangeTab={setHomeTab}
          onStartEditing={() => mediaInputRef.current?.click()}
          onOpenDraft={(id) => void handleOpenDraft(id)}
          onDeleteDraft={handleDeleteDraft}
        />
      </>
    );
  }

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#08080b] text-zinc-100 overflow-hidden pt-safe pb-safe">
      {hiddenInputs}

      <TopHeader
        aspectRatio={aspectRatio}
        onChangeAspectRatio={(ratio) => {
          pushHistory();
          setAspectRatio(ratio);
        }}
        canUndo={history.length > 0}
        onUndo={handleUndo}
        onOpenExport={() => {
          setIsPlaying(false);
          setChromaPickerActive(false);
          setExportModalOpen(true);
        }}
        onBackHome={handleBackHome}
        hasClips={clips.length > 0}
      />

      {/* Responsive Studio Grid: vertical mobile / split desktop */}
      <main className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[1fr_370px] lg:grid-rows-[1fr_auto] overflow-hidden">
        <PreviewPlayer
          clips={clips}
          assetsById={assetsById}
          overlays={overlays}
          mediaOverlays={mediaOverlays}
          aspectRatio={aspectRatio}
          currentTime={currentTime}
          getLiveTime={() => liveTimeRef.current}
          totalDuration={totalDuration}
          isPlaying={isPlaying}
          loopEnabled={loopEnabled}
          selectedOverlayId={selectedOverlayId}
          selectedMediaOverlayId={selectedMediaOverlayId}
          chromaPickerActive={chromaPickerActive}
          pausedForExport={exportModalOpen}
          canSplit={canSplitAtPlayhead}
          onTogglePlay={() => {
            if (!isPlaying) {
              const startAt = currentTime >= totalDuration ? 0 : currentTime;
              liveTimeRef.current = startAt;
              if (currentTime >= totalDuration) {
                setCurrentTime(0);
              }
              setChromaPickerActive(false);
              primeActiveVideoFromUserGesture(clips, assetsById, startAt, mediaOverlays);
              setIsPlaying(true);
            } else {
              pauseAllCachedVideos();
              setCurrentTime(liveTimeRef.current);
              setIsPlaying(false);
            }
          }}
          onSeekStart={() => {
            pauseAllCachedVideos();
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onToggleLoop={() => setLoopEnabled((l) => !l)}
          onSplitAtPlayhead={handleSplitAtPlayhead}
          onQuickAddText={handleAddTextOverlay}
          onSelectOverlay={(id) => {
            setSelectedOverlayId(id);
            if (id) {
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
              setActiveTool('text');
            }
          }}
          onMoveOverlay={(id, x, y) =>
            handleUpdateOverlay(id, (prev) => ({ ...prev, x, y }))
          }
          onRotateOverlay={(id, rotation) =>
            handleUpdateOverlay(id, (prev) => ({ ...prev, rotation }))
          }
          onSelectMediaOverlay={(id) => {
            setSelectedMediaOverlayId(id);
            if (id) {
              setSelectedOverlayId(null);
              setActiveTool('overlay');
            }
          }}
          onMoveMediaOverlay={(id, x, y) =>
            handleUpdateMediaOverlay(id, (prev) => ({ ...prev, x, y }))
          }
          onScaleMediaOverlay={(id, scale) =>
            handleUpdateMediaOverlay(id, (prev) => ({ ...prev, scale }))
          }
          onRotateMediaOverlay={(id, rotation) =>
            handleUpdateMediaOverlay(id, (prev) => ({ ...prev, rotation }))
          }
          onPickChromaKeyColor={(id, pickerX, pickerY, color) =>
            handleUpdateMediaOverlay(id, (prev) => ({
              ...prev,
              chromaKey: {
                ...prev.chromaKey,
                enabled: true,
                pickerX,
                pickerY,
                color,
              },
            }))
          }
          onTriggerImport={() => mediaInputRef.current?.click()}
          onLoadSampleProject={() => void loadSampleProject()}
        />

        {/* Desktop Right Inspector Panel */}
        <aside
          aria-label="Inspector tools"
          className="hidden lg:flex flex-col min-h-0 border-l border-white/10 bg-[#121218]"
        >
          <div className="grid grid-cols-7 gap-1 p-2 border-b border-white/10 shrink-0">
            {TOOL_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTool === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id !== 'overlay') setChromaPickerActive(false);
                    setActiveTool(item.id);
                  }}
                  className={`min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/40 text-white'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-pink-400' : ''}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {chromaKeyPanelOpen && selectedMediaOverlay ? (
              <ChromaKeyPanel
                overlay={selectedMediaOverlay}
                pickerActive={chromaPickerActive}
                onTogglePicker={() => handleToggleChromaPicker(selectedMediaOverlay.id)}
                onUpdateOverlay={handleUpdateMediaOverlay}
                onDone={() => {
                  setChromaKeyPanelOpen(false);
                  setChromaPickerActive(false);
                }}
              />
            ) : (
              renderInspectorContent()
            )}
          </div>
        </aside>

        {/* Mobile Chroma Key Studio Panel (Screenshot 2 layout) */}
        {chromaKeyPanelOpen && selectedMediaOverlay && (
          <div className="lg:hidden shrink-0 max-h-[38dvh] overflow-y-auto">
            <ChromaKeyPanel
              overlay={selectedMediaOverlay}
              pickerActive={chromaPickerActive}
              onTogglePicker={() => handleToggleChromaPicker(selectedMediaOverlay.id)}
              onUpdateOverlay={handleUpdateMediaOverlay}
              onDone={() => {
                setChromaKeyPanelOpen(false);
                setChromaPickerActive(false);
              }}
            />
          </div>
        )}

        {/* Mobile Contextual Tool Drawer */}
        {mobileDrawerOpen && !(chromaKeyPanelOpen && selectedMediaOverlay) && (
          <div className="lg:hidden shrink-0 max-h-[28dvh] border-t border-white/10 bg-[#121218] flex flex-col overflow-hidden">
            <div className="h-9 px-3 border-b border-white/10 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-zinc-200 capitalize">
                {activeTool} Tools
              </span>
              <button
                type="button"
                onClick={() => {
                  setMobileDrawerOpen(false);
                  setChromaPickerActive(false);
                }}
                aria-label="Collapse tool drawer"
                className="min-w-[36px] min-h-[32px] flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {renderInspectorContent()}
            </div>
          </div>
        )}

        <div className={chromaKeyPanelOpen && selectedMediaOverlay ? 'hidden lg:block lg:col-span-2' : 'lg:col-span-2'}>
          <TimelinePanel
            clips={clips}
            assetsById={assetsById}
            overlays={overlays}
            mediaOverlays={mediaOverlays}
            audioTracks={audioTracks}
            currentTime={currentTime}
            getLiveTime={() => liveTimeRef.current}
            totalDuration={totalDuration}
            isPlaying={isPlaying}
            selectedClipId={selectedClipId}
            selectedOverlayId={selectedOverlayId}
            selectedMediaOverlayId={selectedMediaOverlayId}
            zoomPxPerSec={zoomPxPerSec}
            canSplit={canSplitAtPlayhead}
            onSeek={(t) => {
              liveTimeRef.current = t;
              setIsPlaying(false);
              setCurrentTime(t);
            }}
            onSelectClip={(clipId) => {
              setSelectedClipId(clipId);
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
              setChromaKeyPanelOpen(false);
              setActiveTool('edit');
            }}
            onSelectOverlay={(overlayId) => {
              setSelectedOverlayId(overlayId);
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
              setChromaKeyPanelOpen(false);
              setActiveTool('text');
              setMobileDrawerOpen(true);
              const ov = overlays.find((o) => o.id === overlayId);
              if (ov) {
                setIsPlaying(false);
                setCurrentTime(ov.startTime + 0.05);
              }
            }}
            onSelectMediaOverlay={(overlayId) => {
              setSelectedMediaOverlayId(overlayId);
              setSelectedOverlayId(null);
              setChromaPickerActive(false);
              setChromaKeyPanelOpen(false);
              setActiveTool('overlay');
              setMobileDrawerOpen(false);
              const ov = mediaOverlays.find((m) => m.id === overlayId);
              if (ov) {
                setIsPlaying(false);
                setCurrentTime(ov.startTime + 0.05);
              }
            }}
            onOpenOverlayTool={() => {
              setActiveTool('overlay');
              setMobileDrawerOpen(true);
            }}
            onOverlayInteractionStart={pushHistory}
            onUpdateOverlayTiming={(overlayId, startTime, duration) => {
              setSelectedOverlayId(overlayId);
              setOverlays((prev) =>
                prev.map((o) =>
                  o.id === overlayId ? { ...o, startTime, duration } : o,
                ),
              );
            }}
            onUpdateMediaOverlayTiming={(overlayId, startTime, duration) => {
              setSelectedMediaOverlayId(overlayId);
              setMediaOverlays((prev) =>
                prev.map((m) =>
                  m.id === overlayId ? { ...m, startTime, duration } : m,
                ),
              );
            }}
            onSelectTransition={(clipId) => {
              setSelectedClipId(clipId);
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
              setChromaKeyPanelOpen(false);
              setActiveTool('transition');
              setMobileDrawerOpen(true);
            }}
            onOpenAudioTool={() => {
              setSelectedMediaOverlayId(null);
              setChromaPickerActive(false);
              setChromaKeyPanelOpen(false);
              setActiveTool('audio');
              setMobileDrawerOpen(true);
            }}
            onTriggerImport={() => mediaInputRef.current?.click()}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onZoomChange={setZoomPxPerSec}
          />
        </div>
      </main>

      {!(chromaKeyPanelOpen && selectedMediaOverlay) && (
        <BottomToolBar
          activeTool={activeTool}
          drawerOpen={mobileDrawerOpen}
          selectedMediaOverlay={selectedMediaOverlay}
          onSelectTool={handleSelectMobileTool}
          onBackFromOverlayBar={() => {
            setSelectedMediaOverlayId(null);
            setChromaPickerActive(false);
            setChromaKeyPanelOpen(false);
            setMobileDrawerOpen(false);
          }}
          onOpenChromaKey={() => {
            if (selectedMediaOverlay) {
              handleOpenChromaKeyPanel(selectedMediaOverlay.id);
            }
          }}
          onToggleOverlaySpin={() => {
            if (selectedMediaOverlay) {
              handleUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                ...prev,
                spinEnabled: !prev.spinEnabled,
                spinSpeed: prev.spinSpeed ?? 1,
                spinDirection: prev.spinDirection ?? 'cw',
              }));
            }
          }}
          onOpenOverlayDrawer={() => {
            setActiveTool('overlay');
            setMobileDrawerOpen((o) => (activeTool === 'overlay' ? !o : true));
          }}
          onTriggerOverlayImport={() => overlayInputRef.current?.click()}
          onDeleteSelectedOverlay={() => {
            if (selectedMediaOverlay) {
              handleDeleteMediaOverlay(selectedMediaOverlay.id);
            }
          }}
        />
      )}

      <ExportModal
        open={exportModalOpen}
        clips={clips}
        assetsById={assetsById}
        overlays={overlays}
        mediaOverlays={mediaOverlays}
        audioTracks={audioTracks}
        aspectRatio={aspectRatio}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}
