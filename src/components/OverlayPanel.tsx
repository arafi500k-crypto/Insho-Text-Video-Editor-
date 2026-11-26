import {
  Film,
  Image as ImageIcon,
  Layers,
  Pipette,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { MediaAsset, MediaOverlay } from '../types/editor';
import { DEFAULT_CHROMA_KEY } from '../utils/timeline';

interface OverlayPanelProps {
  mediaOverlays: MediaOverlay[];
  selectedMediaOverlay: MediaOverlay | null;
  assets: MediaAsset[];
  totalDuration: number;
  chromaPickerActive: boolean;
  importingOverlay: boolean;
  onTriggerOverlayImport: () => void;
  onAddOverlayFromAsset: (asset: MediaAsset) => void;
  onSelectMediaOverlay: (id: string) => void;
  onUpdateMediaOverlay: (
    id: string,
    updater: (prev: MediaOverlay) => MediaOverlay,
  ) => void;
  onDeleteMediaOverlay: (id: string) => void;
  onToggleChromaPicker: (overlayId: string) => void;
}

const SPIN_SPEEDS = [0.5, 1, 2, 3];

export function OverlayPanel({
  mediaOverlays,
  selectedMediaOverlay,
  assets,
  totalDuration,
  chromaPickerActive,
  importingOverlay,
  onTriggerOverlayImport,
  onAddOverlayFromAsset,
  onSelectMediaOverlay,
  onUpdateMediaOverlay,
  onDeleteMediaOverlay,
  onToggleChromaPicker,
}: OverlayPanelProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm text-white">
            Video & Photo Overlays
          </h3>
          <p className="text-xs text-zinc-400">
            Resize from corners, remove background, or spin 360°
          </p>
        </div>
        <button
          type="button"
          onClick={onTriggerOverlayImport}
          disabled={totalDuration <= 0 || importingOverlay}
          data-testid="add-media-overlay-btn"
          className="min-h-[38px] px-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{importingOverlay ? 'Loading...' : 'Add Overlay'}</span>
        </button>
      </div>

      {/* Layer selector chips for all added overlays */}
      {mediaOverlays.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          {mediaOverlays.map((ov, idx) => {
            const active = ov.id === selectedMediaOverlay?.id;
            return (
              <button
                key={ov.id}
                type="button"
                onClick={() => onSelectMediaOverlay(ov.id)}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-pink-500/20 border-pink-500 text-white'
                    : 'bg-[#181822] border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                {ov.kind === 'video' ? (
                  <Film className="w-3 h-3 text-pink-400" />
                ) : (
                  <ImageIcon className="w-3 h-3 text-purple-400" />
                )}
                <span>{ov.label.slice(0, 14) || `Overlay ${idx + 1}`}</span>
              </button>
            );
          })}
        </div>
      )}

      {!selectedMediaOverlay ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-center flex flex-col items-center gap-2.5">
          <Layers className="w-6 h-6 text-pink-400" />
          <p className="text-xs text-zinc-400 leading-relaxed">
            Tap <strong className="text-white">Add Overlay</strong> to place any video or photo over your main clip.
          </p>
          {assets.length > 0 && totalDuration > 0 && (
            <div className="w-full pt-1 flex flex-wrap gap-1.5 justify-center">
              {assets.slice(0, 4).map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onAddOverlayFromAsset(asset)}
                  className="min-h-[32px] px-2.5 rounded-lg bg-[#181822] border border-white/10 hover:border-pink-400/50 text-[11px] text-zinc-200 flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3 text-pink-400" />
                  <span className="truncate max-w-[110px]">{asset.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Remove Background (Chroma Key Color Dot) */}
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Wand2 className="w-4 h-4 text-pink-400 shrink-0" />
                <span className="text-xs font-semibold text-white truncate">
                  Remove Background
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDeleteMediaOverlay(selectedMediaOverlay.id)}
                aria-label="Delete selected media overlay"
                className="min-h-[30px] px-2 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-1 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="chroma-key-trigger-btn"
                aria-pressed={chromaPickerActive || selectedMediaOverlay.chromaKey.enabled}
                onClick={() => onToggleChromaPicker(selectedMediaOverlay.id)}
                className={`flex-1 min-h-[40px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  chromaPickerActive
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 border-pink-400 text-white shadow-md'
                    : selectedMediaOverlay.chromaKey.enabled
                      ? 'bg-pink-500/20 border-pink-500 text-white'
                      : 'bg-[#121218] border-white/15 text-zinc-200 hover:border-pink-400/50'
                }`}
              >
                <Pipette className="w-3.5 h-3.5" />
                <span>
                  {selectedMediaOverlay.chromaKey.enabled
                    ? 'Chroma Key (Edit)'
                    : 'Chroma Key'}
                </span>
              </button>

              {selectedMediaOverlay.chromaKey.enabled && (
                <button
                  type="button"
                  data-testid="chroma-key-reset-btn"
                  onClick={() =>
                    onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                      ...prev,
                      chromaKey: { ...DEFAULT_CHROMA_KEY },
                    }))
                  }
                  className="min-h-[40px] px-3 rounded-xl bg-[#121218] border border-white/10 text-xs text-zinc-300 hover:text-white"
                >
                  Off
                </button>
              )}
            </div>

            {selectedMediaOverlay.chromaKey.enabled && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10 text-[11px]">
                <span className="text-zinc-400">
                  Color removed · Tap Chroma Key to tune sliders
                </span>
                <span
                  data-testid="chroma-picked-color"
                  className="flex items-center gap-1.5 font-mono-tabular text-zinc-200 shrink-0"
                >
                  <span
                    style={{ backgroundColor: selectedMediaOverlay.chromaKey.color }}
                    className="w-4 h-4 rounded-full border border-white/40 inline-block"
                  />
                  {selectedMediaOverlay.chromaKey.color}
                </span>
              </div>
            )}
          </div>

          {/* 360-Degree Auto Spin Toggle */}
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-2.5">
            <button
              type="button"
              data-testid="overlay-auto-spin-btn"
              onClick={() =>
                onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                  ...prev,
                  spinEnabled: !prev.spinEnabled,
                  spinSpeed: prev.spinSpeed ?? 1,
                  spinDirection: prev.spinDirection ?? 'cw',
                }))
              }
              aria-pressed={selectedMediaOverlay.spinEnabled}
              className={`w-full min-h-[42px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${
                selectedMediaOverlay.spinEnabled
                  ? 'bg-gradient-to-r from-pink-500 to-purple-600 border-pink-400 text-white shadow-md'
                  : 'bg-[#121218] border-white/15 text-zinc-200 hover:border-pink-500/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span>Auto Spin 360° (Full Duration)</span>
              </span>
              <span className="font-mono-tabular text-[11px] opacity-90">
                {selectedMediaOverlay.spinEnabled ? 'ON' : 'OFF'}
              </span>
            </button>

            {selectedMediaOverlay.spinEnabled && (
              <div className="grid grid-cols-[1fr_auto] gap-2 items-center pt-0.5">
                <div className="flex items-center gap-1">
                  {SPIN_SPEEDS.map((spd) => {
                    const active = (selectedMediaOverlay.spinSpeed ?? 1) === spd;
                    return (
                      <button
                        key={spd}
                        type="button"
                        onClick={() =>
                          onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                            ...prev,
                            spinSpeed: spd,
                          }))
                        }
                        className={`flex-1 min-h-[34px] rounded-lg text-[11px] font-mono-tabular font-medium border ${
                          active
                            ? 'bg-pink-500/20 border-pink-500 text-white'
                            : 'bg-[#121218] border-white/10 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {spd}x
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'cw', label: 'CW' },
                      { id: 'ccw', label: 'CCW' },
                    ] as const
                  ).map((dir) => {
                    const active = (selectedMediaOverlay.spinDirection ?? 'cw') === dir.id;
                    return (
                      <button
                        key={dir.id}
                        type="button"
                        onClick={() =>
                          onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                            ...prev,
                            spinDirection: dir.id,
                          }))
                        }
                        className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-mono-tabular font-medium border ${
                          active
                            ? 'bg-purple-600/30 border-purple-400 text-white'
                            : 'bg-[#121218] border-white/10 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {dir.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Size, Opacity & Manual 360° Angle */}
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Overlay Size</span>
                  <span
                    data-testid="overlay-scale-value"
                    className="font-mono-tabular text-zinc-200"
                  >
                    {Math.round(selectedMediaOverlay.scale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Overlay size"
                  min={0.15}
                  max={1.6}
                  step={0.02}
                  value={selectedMediaOverlay.scale}
                  onChange={(e) =>
                    onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                      ...prev,
                      scale: Number(e.target.value),
                    }))
                  }
                  className="insho-slider"
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Opacity</span>
                  <span className="font-mono-tabular text-zinc-200">
                    {Math.round(selectedMediaOverlay.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Overlay opacity"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={selectedMediaOverlay.opacity}
                  onChange={(e) =>
                    onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                      ...prev,
                      opacity: Number(e.target.value),
                    }))
                  }
                  className="insho-slider"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-400">Rotation (360°)</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono-tabular font-semibold text-pink-400">
                  {Math.round(selectedMediaOverlay.rotation || 0)}°
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                      ...prev,
                      rotation: 0,
                    }))
                  }
                  className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={360}
              step={1}
              aria-label="Overlay rotation degrees"
              value={Math.round(selectedMediaOverlay.rotation || 0)}
              onChange={(e) =>
                onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                  ...prev,
                  rotation: Number(e.target.value) % 360,
                }))
              }
              className="insho-slider"
            />

            <div className="grid grid-cols-6 gap-1">
              <button
                type="button"
                aria-label="Rotate overlay -15 degrees"
                onClick={() =>
                  onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                    ...prev,
                    rotation: (((prev.rotation || 0) - 15) % 360 + 360) % 360,
                  }))
                }
                className="min-h-[32px] rounded-lg bg-[#121218] border border-white/10 text-[11px] font-mono-tabular text-zinc-300 hover:text-white flex items-center justify-center gap-0.5"
              >
                <RotateCcw className="w-3 h-3" />
                <span>15°</span>
              </button>
              {[0, 90, 180, 270].map((deg) => {
                const active = Math.round(selectedMediaOverlay.rotation || 0) === deg;
                return (
                  <button
                    key={deg}
                    type="button"
                    onClick={() =>
                      onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                        ...prev,
                        rotation: deg,
                      }))
                    }
                    className={`min-h-[32px] rounded-lg text-[11px] font-mono-tabular font-medium border ${
                      active
                        ? 'bg-pink-500/20 border-pink-500 text-white'
                        : 'bg-[#121218] border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {deg}°
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="Rotate overlay +15 degrees"
                onClick={() =>
                  onUpdateMediaOverlay(selectedMediaOverlay.id, (prev) => ({
                    ...prev,
                    rotation: ((prev.rotation || 0) + 15) % 360,
                  }))
                }
                className="min-h-[32px] rounded-lg bg-[#121218] border border-white/10 text-[11px] font-mono-tabular text-zinc-300 hover:text-white flex items-center justify-center gap-0.5"
              >
                <RotateCw className="w-3 h-3" />
                <span>15°</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
