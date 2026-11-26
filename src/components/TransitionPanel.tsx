import type { TimelineClip, TransitionType } from '../types/editor';

interface TransitionPanelProps {
  clip: TimelineClip | null;
  clipIndex: number;
  onUpdateClip: (clipId: string, updater: (prev: TimelineClip) => TimelineClip) => void;
  onApplyTransitionToAll: (type: TransitionType, duration: number) => void;
}

const TRANSITION_OPTIONS: Array<{ id: TransitionType; label: string; desc: string }> = [
  { id: 'none', label: 'Cut', desc: 'Instant hard cut' },
  { id: 'dissolve', label: 'Dissolve', desc: 'Smooth cross-fade' },
  { id: 'fade-black', label: 'Fade Black', desc: 'Dip to black' },
  { id: 'slide-left', label: 'Slide', desc: 'Horizontal push' },
  { id: 'zoom-in', label: 'Zoom', desc: 'Dynamic punch-in' },
];

export function TransitionPanel({
  clip,
  clipIndex,
  onUpdateClip,
  onApplyTransitionToAll,
}: TransitionPanelProps) {
  if (!clip) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-xs text-zinc-400">
        Select a clip on the timeline to configure its incoming transition.
      </div>
    );
  }

  if (clipIndex === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-xs text-zinc-400">
        The first clip starts at <strong className="text-white">00:00.0</strong>. Select the second or later clip (or tap the junction icon between clips) to add a transition.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm text-white">
            Clip Transition
          </h3>
          <p className="text-xs text-zinc-400">
            Transition into {clip.label}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onApplyTransitionToAll(clip.transitionIn, clip.transitionDuration)
          }
          className="min-h-[34px] px-2.5 rounded-lg bg-[#1a1a24] border border-white/10 text-[11px] font-medium text-zinc-200 hover:text-white whitespace-nowrap"
        >
          Apply to All
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
        {TRANSITION_OPTIONS.map((opt) => {
          const active = clip.transitionIn === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                onUpdateClip(clip.id, (prev) => ({
                  ...prev,
                  transitionIn: opt.id,
                }))
              }
              className={`rounded-xl p-3 border text-left transition-all ${
                active
                  ? 'bg-pink-500/15 border-pink-500 text-white'
                  : 'bg-[#181822] border-white/10 text-zinc-300 hover:border-white/25'
              }`}
            >
              <div className="text-xs font-semibold">{opt.label}</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">{opt.desc}</div>
            </button>
          );
        })}
      </div>

      {clip.transitionIn !== 'none' && (
        <div className="rounded-2xl bg-[#181822] border border-white/10 p-3.5">
          <label className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-zinc-300">
              <span>Transition Duration</span>
              <span className="font-mono-tabular text-pink-400 font-semibold">
                {clip.transitionDuration.toFixed(2)}s
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1.2}
              step={0.05}
              value={clip.transitionDuration}
              onChange={(e) =>
                onUpdateClip(clip.id, (prev) => ({
                  ...prev,
                  transitionDuration: Number(e.target.value),
                }))
              }
              className="insho-slider"
            />
          </label>
        </div>
      )}
    </div>
  );
}
