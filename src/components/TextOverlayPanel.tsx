import { useId } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import type {
  TextAnimation,
  TextBoxStyle,
  TextFontFamily,
  TextOverlay,
} from '../types/editor';

interface TextOverlayPanelProps {
  overlays: TextOverlay[];
  selectedOverlay: TextOverlay | null;
  totalDuration: number;
  onAddOverlay: () => void;
  onSelectOverlay: (id: string) => void;
  onUpdateOverlay: (id: string, updater: (prev: TextOverlay) => TextOverlay) => void;
  onDeleteOverlay: (id: string) => void;
}

const FONT_OPTIONS: TextFontFamily[] = [
  'Plus Jakarta Sans',
  'Outfit',
  'Oswald',
  'Playfair Display',
  'JetBrains Mono',
];

const COLOR_SWATCHES = [
  '#ffffff',
  '#09090d',
  '#ec4899',
  '#a855f7',
  '#facc15',
  '#22d3ee',
];

const BOX_STYLES: Array<{ id: TextBoxStyle; label: string }> = [
  { id: 'none', label: 'Clean' },
  { id: 'obsidian', label: 'Dark Box' },
  { id: 'white-pill', label: 'White Box' },
  { id: 'pink-purple', label: 'Insho Grad' },
  { id: 'outline', label: 'Outline' },
];

const ANIMATIONS: Array<{ id: TextAnimation; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'spin-360', label: '360° Spin' },
];

const SPIN_SPEEDS = [0.5, 1, 2, 3];

export function TextOverlayPanel({
  overlays,
  selectedOverlay,
  totalDuration,
  onAddOverlay,
  onSelectOverlay,
  onUpdateOverlay,
  onDeleteOverlay,
}: TextOverlayPanelProps) {
  const captionInputId = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm text-white">
            Text & Captions
          </h3>
          <p className="text-xs text-zinc-400">
            Drag text to move or use top knob to rotate 360°
          </p>
        </div>
        <button
          type="button"
          onClick={onAddOverlay}
          disabled={totalDuration <= 0}
          className="min-h-[38px] px-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Text</span>
        </button>
      </div>

      {/* Layer selector if overlays exist */}
      {overlays.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {overlays.map((ov, idx) => {
            const active = ov.id === selectedOverlay?.id;
            return (
              <button
                key={ov.id}
                type="button"
                onClick={() => onSelectOverlay(ov.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                  active
                    ? 'bg-pink-500/20 border-pink-500 text-white'
                    : 'bg-[#181822] border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                {ov.text.trim() ? ov.text.slice(0, 14) : `Text ${idx + 1}`}
              </button>
            );
          })}
        </div>
      )}

      {!selectedOverlay ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center text-xs text-zinc-400">
          Tap <strong className="text-white">Add Text</strong> to insert a caption or title at the current playhead.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Text input + delete */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor={captionInputId}
                className="text-xs font-medium text-zinc-300"
              >
                Caption Content
              </label>
              <button
                type="button"
                onClick={() => onDeleteOverlay(selectedOverlay.id)}
                aria-label="Delete selected text overlay"
                className="min-h-[32px] px-2 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            </div>
            <textarea
              id={captionInputId}
              rows={2}
              value={selectedOverlay.text}
              onChange={(e) =>
                onUpdateOverlay(selectedOverlay.id, (prev) => ({
                  ...prev,
                  text: e.target.value,
                }))
              }
              placeholder="Enter headline or caption..."
              className="w-full rounded-xl bg-[#181822] border border-white/15 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500 resize-none"
            />
          </div>

          {/* Font & Alignment */}
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-zinc-400">Font Family</span>
              <select
                value={selectedOverlay.fontFamily}
                onChange={(e) =>
                  onUpdateOverlay(selectedOverlay.id, (prev) => ({
                    ...prev,
                    fontFamily: e.target.value as TextFontFamily,
                  }))
                }
                className="h-10 rounded-xl bg-[#181822] border border-white/15 px-2.5 text-xs text-white focus:outline-none focus:border-pink-500"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f} className="bg-[#121218]">
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-1 bg-[#181822] border border-white/10 p-1 rounded-xl">
              {(
                [
                  { id: 'left', icon: AlignLeft },
                  { id: 'center', icon: AlignCenter },
                  { id: 'right', icon: AlignRight },
                ] as const
              ).map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`Align text ${id}`}
                  onClick={() =>
                    onUpdateOverlay(selectedOverlay.id, (prev) => ({
                      ...prev,
                      align: id,
                    }))
                  }
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    selectedOverlay.align === id
                      ? 'bg-pink-500 text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </div>

          {/* Box Style */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-zinc-400">Style</span>
            <div className="grid grid-cols-5 gap-1">
              {BOX_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() =>
                    onUpdateOverlay(selectedOverlay.id, (prev) => ({
                      ...prev,
                      boxStyle: style.id,
                    }))
                  }
                  className={`min-h-[34px] px-1 rounded-lg text-[11px] font-medium border truncate ${
                    selectedOverlay.boxStyle === style.id
                      ? 'bg-pink-500/20 border-pink-500 text-white'
                      : 'bg-[#181822] border-white/10 text-zinc-400 hover:text-white'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color Swatches & Size */}
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-400">Text Color</span>
              <div className="flex items-center gap-1.5">
                {COLOR_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Set text color ${hex}`}
                    onClick={() =>
                      onUpdateOverlay(selectedOverlay.id, (prev) => ({
                        ...prev,
                        color: hex,
                      }))
                    }
                    style={{ backgroundColor: hex }}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      selectedOverlay.color.toLowerCase() === hex
                        ? 'border-pink-400 scale-110'
                        : 'border-white/25'
                    }`}
                  />
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Font Size</span>
                <span className="font-mono-tabular text-zinc-200">
                  {selectedOverlay.fontSize}px
                </span>
              </div>
              <input
                type="range"
                min={28}
                max={120}
                step={2}
                value={selectedOverlay.fontSize}
                onChange={(e) =>
                  onUpdateOverlay(selectedOverlay.id, (prev) => ({
                    ...prev,
                    fontSize: Number(e.target.value),
                  }))
                }
                className="insho-slider"
              />
            </label>
          </div>

          {/* 360-Degree Rotation */}
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-400">Rotation (360°)</span>
              <div className="flex items-center gap-2">
                <span
                  data-testid="text-rotation-value"
                  className="text-xs font-mono-tabular font-semibold text-pink-400"
                >
                  {Math.round(selectedOverlay.rotation || 0)}°
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateOverlay(selectedOverlay.id, (prev) => ({
                      ...prev,
                      rotation: 0,
                    }))
                  }
                  aria-label="Reset text rotation"
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
              aria-label="Text rotation degrees"
              value={Math.round(selectedOverlay.rotation || 0)}
              onChange={(e) =>
                onUpdateOverlay(selectedOverlay.id, (prev) => ({
                  ...prev,
                  rotation: Number(e.target.value) % 360,
                }))
              }
              className="insho-slider"
            />

            <div className="grid grid-cols-6 gap-1">
              <button
                type="button"
                aria-label="Rotate text -15 degrees"
                onClick={() =>
                  onUpdateOverlay(selectedOverlay.id, (prev) => ({
                    ...prev,
                    rotation: (((prev.rotation || 0) - 15) % 360 + 360) % 360,
                  }))
                }
                className="min-h-[34px] rounded-lg bg-[#121218] border border-white/10 text-[11px] font-mono-tabular text-zinc-300 hover:text-white flex items-center justify-center gap-0.5"
              >
                <RotateCcw className="w-3 h-3" />
                <span>15°</span>
              </button>
              {[0, 90, 180, 270].map((deg) => {
                const active = Math.round(selectedOverlay.rotation || 0) === deg;
                return (
                  <button
                    key={deg}
                    type="button"
                    onClick={() =>
                      onUpdateOverlay(selectedOverlay.id, (prev) => ({
                        ...prev,
                        rotation: deg,
                      }))
                    }
                    className={`min-h-[34px] rounded-lg text-[11px] font-mono-tabular font-medium border ${
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
                aria-label="Rotate text +15 degrees"
                onClick={() =>
                  onUpdateOverlay(selectedOverlay.id, (prev) => ({
                    ...prev,
                    rotation: ((prev.rotation || 0) + 15) % 360,
                  }))
                }
                className="min-h-[34px] rounded-lg bg-[#121218] border border-white/10 text-[11px] font-mono-tabular text-zinc-300 hover:text-white flex items-center justify-center gap-0.5"
              >
                <RotateCw className="w-3 h-3" />
                <span>15°</span>
              </button>
            </div>
          </div>

          {/* Animation & Timing */}
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-3">
            {/* One-click Auto Spin 360° Toggle */}
            <button
              type="button"
              onClick={() =>
                onUpdateOverlay(selectedOverlay.id, (prev) => ({
                  ...prev,
                  animation: prev.animation === 'spin-360' ? 'none' : 'spin-360',
                  spinSpeed: prev.spinSpeed ?? 1,
                  spinDirection: prev.spinDirection ?? 'cw',
                }))
              }
              aria-pressed={selectedOverlay.animation === 'spin-360'}
              className={`w-full min-h-[42px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${
                selectedOverlay.animation === 'spin-360'
                  ? 'bg-gradient-to-r from-pink-500 to-purple-600 border-pink-400 text-white shadow-md'
                  : 'bg-[#121218] border-white/15 text-zinc-200 hover:border-pink-500/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span>Auto Spin 360° (Full Duration)</span>
              </span>
              <span className="font-mono-tabular text-[11px] opacity-90">
                {selectedOverlay.animation === 'spin-360' ? 'ON' : 'OFF'}
              </span>
            </button>

            {selectedOverlay.animation === 'spin-360' && (
              <div className="grid grid-cols-[1fr_auto] gap-2 items-center pt-0.5">
                <div className="flex items-center gap-1">
                  {SPIN_SPEEDS.map((spd) => {
                    const active = (selectedOverlay.spinSpeed ?? 1) === spd;
                    return (
                      <button
                        key={spd}
                        type="button"
                        onClick={() =>
                          onUpdateOverlay(selectedOverlay.id, (prev) => ({
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
                    const active = (selectedOverlay.spinDirection ?? 'cw') === dir.id;
                    return (
                      <button
                        key={dir.id}
                        type="button"
                        onClick={() =>
                          onUpdateOverlay(selectedOverlay.id, (prev) => ({
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

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-zinc-400">Motion Animation</span>
              <div className="grid grid-cols-5 gap-1">
                {ANIMATIONS.map((anim) => (
                  <button
                    key={anim.id}
                    type="button"
                    onClick={() =>
                      onUpdateOverlay(selectedOverlay.id, (prev) => ({
                        ...prev,
                        animation: anim.id,
                      }))
                    }
                    className={`min-h-[34px] px-1 rounded-lg text-[11px] font-medium border truncate ${
                      selectedOverlay.animation === anim.id
                        ? 'bg-purple-600/30 border-purple-400 text-white'
                        : 'bg-[#121218] border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {anim.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Start</span>
                  <span className="font-mono-tabular text-zinc-200">
                    {selectedOverlay.startTime.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, totalDuration - 0.3)}
                  step={0.1}
                  value={selectedOverlay.startTime}
                  onChange={(e) =>
                    onUpdateOverlay(selectedOverlay.id, (prev) => ({
                      ...prev,
                      startTime: Number(e.target.value),
                    }))
                  }
                  className="insho-slider"
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Duration</span>
                  <span className="font-mono-tabular text-zinc-200">
                    {selectedOverlay.duration.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={Math.max(0.5, totalDuration)}
                  step={0.1}
                  value={selectedOverlay.duration}
                  onChange={(e) =>
                    onUpdateOverlay(selectedOverlay.id, (prev) => ({
                      ...prev,
                      duration: Number(e.target.value),
                    }))
                  }
                  className="insho-slider"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
