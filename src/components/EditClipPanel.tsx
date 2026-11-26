import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Maximize2,
  Minimize2,
  RotateCcw,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { CropFitMode, TimelineClip } from '../types/editor';
import { DEFAULT_CLIP_CROP, getClipDuration, trimClipBounds } from '../utils/timeline';

interface EditClipPanelProps {
  clip: TimelineClip | null;
  clipIndex: number;
  totalClips: number;
  canSplit: boolean;
  onUpdateClip: (clipId: string, updater: (prev: TimelineClip) => TimelineClip) => void;
  onSplitAtPlayhead: () => void;
  onDuplicateClip: (clipId: string) => void;
  onReorderClip: (clipId: string, direction: 'left' | 'right') => void;
  onDeleteClip: (clipId: string) => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

export function EditClipPanel({
  clip,
  clipIndex,
  totalClips,
  canSplit,
  onUpdateClip,
  onSplitAtPlayhead,
  onDuplicateClip,
  onReorderClip,
  onDeleteClip,
}: EditClipPanelProps) {
  if (!clip) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-xs text-zinc-400">
        Select a clip on the timeline to trim, split, crop, or change playback speed.
      </div>
    );
  }

  const effectiveDuration = getClipDuration(clip);

  const handleTrimStartChange = (nextStart: number) => {
    onUpdateClip(clip.id, (prev) => {
      const bounds = trimClipBounds(prev, nextStart, prev.trimEnd);
      return { ...prev, ...bounds };
    });
  };

  const handleTrimEndChange = (nextEnd: number) => {
    onUpdateClip(clip.id, (prev) => {
      const bounds = trimClipBounds(prev, prev.trimStart, nextEnd);
      return { ...prev, ...bounds };
    });
  };

  const setFitMode = (fit: CropFitMode) => {
    onUpdateClip(clip.id, (prev) => ({
      ...prev,
      crop: { ...prev.crop, fit },
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-sm text-white truncate">
            {clip.label}
          </h3>
          <p className="text-xs text-zinc-400 font-mono-tabular">
            Duration {effectiveDuration.toFixed(1)}s · {clip.speed}x speed
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onReorderClip(clip.id, 'left')}
            disabled={clipIndex <= 0}
            aria-label="Move clip earlier"
            className="min-w-[36px] min-h-[36px] rounded-lg bg-[#1a1a24] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onReorderClip(clip.id, 'right')}
            disabled={clipIndex >= totalClips - 1}
            aria-label="Move clip later"
            className="min-w-[36px] min-h-[36px] rounded-lg bg-[#1a1a24] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary Clip Actions */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onSplitAtPlayhead}
          disabled={!canSplit}
          className="min-h-[42px] px-2.5 rounded-xl bg-[#1a1a24] border border-white/10 hover:border-purple-400/50 text-xs font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-35 whitespace-nowrap"
        >
          <Scissors className="w-3.5 h-3.5 text-purple-400" />
          <span>Split</span>
        </button>

        <button
          type="button"
          onClick={() => onDuplicateClip(clip.id)}
          className="min-h-[42px] px-2.5 rounded-xl bg-[#1a1a24] border border-white/10 hover:border-white/30 text-xs font-medium text-white flex items-center justify-center gap-1.5 whitespace-nowrap"
        >
          <Copy className="w-3.5 h-3.5 text-zinc-300" />
          <span>Duplicate</span>
        </button>

        <button
          type="button"
          onClick={() => onDeleteClip(clip.id)}
          className="min-h-[42px] px-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 text-xs font-medium text-rose-300 flex items-center justify-center gap-1.5 whitespace-nowrap"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
      </div>

      {/* Trim Start / End */}
      <div className="rounded-2xl bg-[#181822] border border-white/10 p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-zinc-200">Trim Clip</span>
          <span className="font-mono-tabular text-zinc-400">
            {clip.trimStart.toFixed(2)}s – {clip.trimEnd.toFixed(2)}s
          </span>
        </div>

        <label className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>In Point</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.trimStart.toFixed(2)}s
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0.25, clip.trimEnd - 0.25)}
            step={0.05}
            value={clip.trimStart}
            onChange={(e) => handleTrimStartChange(Number(e.target.value))}
            className="insho-slider"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Out Point</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.trimEnd.toFixed(2)}s
            </span>
          </div>
          <input
            type="range"
            min={Math.min(clip.sourceDuration, clip.trimStart + 0.25)}
            max={clip.sourceDuration}
            step={0.05}
            value={clip.trimEnd}
            onChange={(e) => handleTrimEndChange(Number(e.target.value))}
            className="insho-slider"
          />
        </label>
      </div>

      {/* Playback Speed */}
      <div className="rounded-2xl bg-[#181822] border border-white/10 p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-zinc-200">Playback Speed</span>
          <span className="font-mono-tabular text-pink-400 font-semibold">
            {clip.speed}x
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {SPEED_OPTIONS.map((spd) => {
            const active = clip.speed === spd;
            return (
              <button
                key={spd}
                type="button"
                onClick={() =>
                  onUpdateClip(clip.id, (prev) => ({ ...prev, speed: spd }))
                }
                className={`min-h-[36px] rounded-lg text-[11px] font-mono-tabular font-medium transition-colors ${
                  active
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white'
                    : 'bg-[#121218] text-zinc-400 hover:text-white border border-white/5'
                }`}
              >
                {spd}x
              </button>
            );
          })}
        </div>
      </div>

      {/* Crop & Framing */}
      <div className="rounded-2xl bg-[#181822] border border-white/10 p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-200">Crop & Framing</span>
          <button
            type="button"
            onClick={() =>
              onUpdateClip(clip.id, (prev) => ({
                ...prev,
                crop: { ...DEFAULT_CLIP_CROP },
              }))
            }
            className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setFitMode('contain')}
            className={`min-h-[38px] rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 border ${
              clip.crop.fit === 'contain'
                ? 'bg-pink-500/20 border-pink-500 text-white'
                : 'bg-[#121218] border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>Full Video</span>
          </button>
          <button
            type="button"
            onClick={() => setFitMode('cover')}
            className={`min-h-[38px] rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 border ${
              clip.crop.fit === 'cover'
                ? 'bg-pink-500/20 border-pink-500 text-white'
                : 'bg-[#121218] border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Fill Frame</span>
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Crop Zoom</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.crop.zoom.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={2.4}
            step={0.05}
            value={clip.crop.zoom}
            onChange={(e) =>
              onUpdateClip(clip.id, (prev) => ({
                ...prev,
                crop: { ...prev.crop, zoom: Number(e.target.value) },
              }))
            }
            className="insho-slider"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-zinc-400">Pan X</span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.02}
              value={clip.crop.panX}
              onChange={(e) =>
                onUpdateClip(clip.id, (prev) => ({
                  ...prev,
                  crop: { ...prev.crop, panX: Number(e.target.value) },
                }))
              }
              className="insho-slider"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-zinc-400">Pan Y</span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.02}
              value={clip.crop.panY}
              onChange={(e) =>
                onUpdateClip(clip.id, (prev) => ({
                  ...prev,
                  crop: { ...prev.crop, panY: Number(e.target.value) },
                }))
              }
              className="insho-slider"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
