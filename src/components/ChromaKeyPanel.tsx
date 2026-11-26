import { Check, RotateCcw } from 'lucide-react';
import type { MediaOverlay } from '../types/editor';
import { DEFAULT_CHROMA_KEY } from '../utils/timeline';

interface ChromaKeyPanelProps {
  overlay: MediaOverlay;
  pickerActive: boolean;
  onTogglePicker: () => void;
  onUpdateOverlay: (
    id: string,
    updater: (prev: MediaOverlay) => MediaOverlay,
  ) => void;
  onDone: () => void;
}

export function ChromaKeyPanel({
  overlay,
  pickerActive,
  onTogglePicker,
  onUpdateOverlay,
  onDone,
}: ChromaKeyPanelProps) {
  const ck = overlay.chromaKey;
  const shadowVal = ck.shadow ?? 0;
  const edgeCleanupVal = ck.edgeCleanup ?? 0;

  return (
    <section
      aria-label="Chroma key controls"
      data-testid="chroma-key-studio-panel"
      className="bg-[#111116] border-t border-white/10 px-3 pt-2 pb-2.5 sm:px-4 sm:pt-2.5 sm:pb-4 flex flex-col gap-2 sm:gap-3 select-none"
    >
      {/* Top Header: Reset | Chroma key | Checkmark */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="chroma-key-reset-btn"
          onClick={() =>
            onUpdateOverlay(overlay.id, (prev) => ({
              ...prev,
              chromaKey: { ...DEFAULT_CHROMA_KEY },
            }))
          }
          className="min-h-[34px] px-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Reset</span>
        </button>

        <h3 className="font-display font-semibold text-sm text-white">
          Chroma key
        </h3>

        <button
          type="button"
          data-testid="chroma-key-done-btn"
          aria-label="Done chroma key"
          onClick={onDone}
          className="min-w-[36px] min-h-[34px] rounded-lg flex items-center justify-center text-white hover:bg-white/10"
        >
          <Check className="w-5 h-5 text-pink-400" />
        </button>
      </div>

      {/* Centered Circular Color Picker Button */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          data-testid="chroma-color-picker-circle-btn"
          aria-pressed={pickerActive}
          onClick={onTogglePicker}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border flex items-center justify-center transition-all ${
            pickerActive
              ? 'border-pink-400 bg-pink-500/15 ring-2 ring-pink-500/40 scale-105'
              : 'border-white/20 bg-[#1a1a24] hover:border-pink-400/60'
          }`}
        >
          <span
            className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center"
            style={{ borderColor: ck.enabled ? ck.color : '#ec4899' }}
          >
            <span
              className="w-2 h-2 rounded-[2px]"
              style={{ backgroundColor: ck.enabled ? ck.color : '#ec4899' }}
            />
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] sm:text-xs font-medium ${
              pickerActive ? 'text-pink-400' : 'text-zinc-300'
            }`}
          >
            Color picker
          </span>
          {ck.enabled && (
            <span
              data-testid="chroma-picked-color"
              className="text-[11px] font-mono-tabular text-zinc-400"
            >
              {ck.color}
            </span>
          )}
        </div>
      </div>

      {/* 4 CapCut-style Real-Time Sliders */}
      <div className="flex flex-col gap-2 sm:gap-2.5 max-w-md w-full mx-auto">
        <label className="grid grid-cols-[90px_1fr_30px] sm:grid-cols-[106px_1fr_34px] items-center gap-2 sm:gap-2.5">
          <span className="text-xs text-zinc-200 font-medium">Intensity</span>
          <input
            type="range"
            aria-label="Chroma key intensity"
            min={0}
            max={100}
            step={1}
            value={ck.enabled ? ck.similarity : 0}
            onChange={(e) =>
              onUpdateOverlay(overlay.id, (prev) => ({
                ...prev,
                chromaKey: {
                  ...prev.chromaKey,
                  enabled: true,
                  similarity: Number(e.target.value),
                },
              }))
            }
            className="insho-slider"
          />
          <span className="text-[11px] font-mono-tabular text-zinc-400 text-right">
            {ck.enabled ? ck.similarity : 0}
          </span>
        </label>

        <label className="grid grid-cols-[90px_1fr_30px] sm:grid-cols-[106px_1fr_34px] items-center gap-2 sm:gap-2.5">
          <span className="text-xs text-zinc-200 font-medium">Shadow</span>
          <input
            type="range"
            aria-label="Chroma key shadow"
            min={0}
            max={100}
            step={1}
            value={shadowVal}
            onChange={(e) =>
              onUpdateOverlay(overlay.id, (prev) => ({
                ...prev,
                chromaKey: {
                  ...prev.chromaKey,
                  enabled: true,
                  shadow: Number(e.target.value),
                },
              }))
            }
            className="insho-slider"
          />
          <span className="text-[11px] font-mono-tabular text-zinc-400 text-right">
            {shadowVal}
          </span>
        </label>

        <label className="grid grid-cols-[90px_1fr_30px] sm:grid-cols-[106px_1fr_34px] items-center gap-2 sm:gap-2.5">
          <span className="text-xs text-zinc-200 font-medium">Feather edge</span>
          <input
            type="range"
            aria-label="Chroma key feather edge"
            min={0}
            max={100}
            step={1}
            value={ck.smoothness}
            onChange={(e) =>
              onUpdateOverlay(overlay.id, (prev) => ({
                ...prev,
                chromaKey: {
                  ...prev.chromaKey,
                  enabled: true,
                  smoothness: Number(e.target.value),
                },
              }))
            }
            className="insho-slider"
          />
          <span className="text-[11px] font-mono-tabular text-zinc-400 text-right">
            {ck.smoothness}
          </span>
        </label>

        <label className="grid grid-cols-[90px_1fr_30px] sm:grid-cols-[106px_1fr_34px] items-center gap-2 sm:gap-2.5">
          <span className="text-xs text-zinc-200 font-medium">Clean up edge</span>
          <input
            type="range"
            aria-label="Chroma key clean up edge"
            min={0}
            max={100}
            step={1}
            value={edgeCleanupVal}
            onChange={(e) =>
              onUpdateOverlay(overlay.id, (prev) => ({
                ...prev,
                chromaKey: {
                  ...prev.chromaKey,
                  enabled: true,
                  edgeCleanup: Number(e.target.value),
                },
              }))
            }
            className="insho-slider"
          />
          <span className="text-[11px] font-mono-tabular text-zinc-400 text-right">
            {edgeCleanupVal}
          </span>
        </label>
      </div>
    </section>
  );
}
