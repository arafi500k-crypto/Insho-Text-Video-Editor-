import { RotateCcw } from 'lucide-react';
import type { ClipFilter, TimelineClip } from '../types/editor';
import { DEFAULT_CLIP_FILTER, FILTER_PRESETS } from '../utils/timeline';

interface FilterPanelProps {
  clip: TimelineClip | null;
  onUpdateClip: (clipId: string, updater: (prev: TimelineClip) => TimelineClip) => void;
  onApplyFilterToAll: (filter: ClipFilter) => void;
}

export function FilterPanel({
  clip,
  onUpdateClip,
  onApplyFilterToAll,
}: FilterPanelProps) {
  if (!clip) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-xs text-zinc-400">
        Select a clip on the timeline to apply color presets and adjustments.
      </div>
    );
  }

  const updateFilter = (patch: Partial<ClipFilter>) => {
    onUpdateClip(clip.id, (prev) => ({
      ...prev,
      filter: { ...prev.filter, ...patch },
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm text-white">
            Filters & Color
          </h3>
          <p className="text-xs text-zinc-400">
            Adjusting {clip.label}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onApplyFilterToAll({ ...clip.filter })}
            className="min-h-[34px] px-2.5 rounded-lg bg-[#1a1a24] border border-white/10 text-[11px] font-medium text-zinc-200 hover:text-white whitespace-nowrap"
          >
            Apply to All
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdateClip(clip.id, (prev) => ({
                ...prev,
                filter: { ...DEFAULT_CLIP_FILTER },
              }))
            }
            aria-label="Reset clip filter"
            className="min-w-[34px] min-h-[34px] rounded-lg bg-[#1a1a24] border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Presets Grid */}
      <div className="grid grid-cols-4 gap-2">
        {FILTER_PRESETS.map((preset) => {
          const active = clip.filter.preset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                onUpdateClip(clip.id, (prev) => ({
                  ...prev,
                  filter: { ...preset.filter },
                }))
              }
              className={`rounded-xl p-1.5 border flex flex-col items-center gap-1.5 transition-all ${
                active
                  ? 'border-pink-500 bg-pink-500/15'
                  : 'border-white/10 bg-[#181822] hover:border-white/25'
              }`}
            >
              <div
                className={`w-full h-9 rounded-lg bg-gradient-to-br ${preset.swatchGradient}`}
              />
              <span className="text-[10px] font-medium text-zinc-200 truncate w-full text-center">
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Fine Sliders */}
      <div className="rounded-2xl bg-[#181822] border border-white/10 p-3.5 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Brightness</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.filter.brightness}%
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={150}
            step={1}
            value={clip.filter.brightness}
            onChange={(e) => updateFilter({ brightness: Number(e.target.value) })}
            className="insho-slider"
          />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Contrast</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.filter.contrast}%
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={150}
            step={1}
            value={clip.filter.contrast}
            onChange={(e) => updateFilter({ contrast: Number(e.target.value) })}
            className="insho-slider"
          />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Saturation</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.filter.saturation}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={2}
            value={clip.filter.saturation}
            onChange={(e) => updateFilter({ saturation: Number(e.target.value) })}
            className="insho-slider"
          />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Warmth</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.filter.warmth}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={80}
            step={1}
            value={clip.filter.warmth}
            onChange={(e) => updateFilter({ warmth: Number(e.target.value) })}
            className="insho-slider"
          />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Soft Blur</span>
            <span className="font-mono-tabular text-zinc-200">
              {clip.filter.blur}px
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={8}
            step={0.5}
            value={clip.filter.blur}
            onChange={(e) => updateFilter({ blur: Number(e.target.value) })}
            className="insho-slider"
          />
        </label>
      </div>
    </div>
  );
}
