import type {
  AspectRatioPreset,
  AudioTrackItem,
  MediaAsset,
  MediaOverlay,
  ProjectDraft,
  TextOverlay,
  TimelineClip,
} from '../types/editor';
import { getTotalTimelineDuration } from './timeline';

export function formatDraftCode(timestampMs: number): string {
  const date = new Date(timestampMs);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${mm}${dd}-${hh}${min}`;
}

export function deriveDraftTitle(clips: TimelineClip[], fallback = 'Untitled Cut'): string {
  if (clips.length === 0) return fallback;
  const firstLabel = clips[0].label.trim();
  if (!firstLabel) return fallback;
  return clips.length > 1 ? `${firstLabel} +${clips.length - 1}` : firstLabel;
}

export function deriveDraftThumbnail(
  clips: TimelineClip[],
  assetsById: Map<string, MediaAsset>,
): string | undefined {
  for (const clip of clips) {
    const asset = assetsById.get(clip.assetId);
    if (asset && asset.thumbnails.length > 0 && asset.thumbnails[0]) {
      return asset.thumbnails[0];
    }
  }
  return undefined;
}

export function buildProjectDraft(params: {
  id: string;
  title?: string;
  updatedAt: number;
  aspectRatio: AspectRatioPreset;
  clips: TimelineClip[];
  overlays: TextOverlay[];
  mediaOverlays?: MediaOverlay[];
  audioTracks: AudioTrackItem[];
  assetsById: Map<string, MediaAsset>;
}): ProjectDraft {
  const {
    id,
    title,
    updatedAt,
    aspectRatio,
    clips,
    overlays,
    mediaOverlays = [],
    audioTracks,
    assetsById,
  } = params;
  const assetIds = Array.from(
    new Set([
      ...clips.map((c) => c.assetId),
      ...mediaOverlays.map((m) => m.assetId),
    ]),
  );
  return {
    id,
    title: (title && title.trim()) || deriveDraftTitle(clips),
    code: formatDraftCode(updatedAt),
    updatedAt,
    aspectRatio,
    totalDuration: Number(getTotalTimelineDuration(clips).toFixed(2)),
    clipCount: clips.length,
    thumbnail: deriveDraftThumbnail(clips, assetsById),
    clips: clips.map((c) => ({ ...c, filter: { ...c.filter }, crop: { ...c.crop } })),
    overlays: overlays.map((o) => ({ ...o })),
    mediaOverlays: mediaOverlays.map((m) => ({
      ...m,
      chromaKey: { ...m.chromaKey },
    })),
    audioTracks: audioTracks.map((a) => ({ ...a })),
    assetIds,
  };
}

export function upsertDraftRecord(
  drafts: ProjectDraft[],
  nextDraft: ProjectDraft,
): ProjectDraft[] {
  const filtered = drafts.filter((d) => d.id !== nextDraft.id);
  return [nextDraft, ...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function filterDrafts(drafts: ProjectDraft[], query: string): ProjectDraft[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return drafts;
  return drafts.filter((draft) => {
    if (draft.title.toLowerCase().includes(normalized)) return true;
    if (draft.code.toLowerCase().includes(normalized)) return true;
    return draft.clips.some((c) => c.label.toLowerCase().includes(normalized));
  });
}
