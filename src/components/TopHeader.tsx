import { ArrowLeft, Download, Undo2 } from 'lucide-react';
import type { AspectRatioPreset } from '../types/editor';

interface TopHeaderProps {
  aspectRatio: AspectRatioPreset;
  onChangeAspectRatio: (ratio: AspectRatioPreset) => void;
  canUndo: boolean;
  onUndo: () => void;
  onOpenExport: () => void;
  onBackHome: () => void;
  hasClips: boolean;
}

const ASPECT_OPTIONS: AspectRatioPreset[] = ['9:16', '16:9', '1:1', '4:5'];

export function TopHeader({
  aspectRatio,
  onChangeAspectRatio,
  canUndo,
  onUndo,
  onOpenExport,
  onBackHome,
  hasClips,
}: TopHeaderProps) {
  return (
    <header className="h-12 sm:h-13 shrink-0 px-2.5 sm:px-5 border-b border-white/10 bg-[#08080b]/95 backdrop-blur-md flex items-center justify-between gap-1.5 sm:gap-3 z-30">
      {/* Zone 1: Back to Home + Brand mark & wordmark */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <button
          type="button"
          onClick={onBackHome}
          aria-label="Back to home screen"
          data-testid="editor-back-home"
          title="Save draft & go home"
          className="min-w-[34px] min-h-[34px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl bg-[#121218] border border-white/10 hover:bg-[#1c1c26] flex items-center justify-center text-zinc-200 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <img
          src="/assets/aistudio/f7d23a18-1001-41d3-98ba-e6c030dcc218_28c615c6.png"
          alt="Insho Text Logo"
          draggable="false"
          onContextMenu={(e) => e.preventDefault()}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-cover shadow-sm shrink-0"
        />
        <span className="font-display font-bold text-sm sm:text-lg tracking-tight text-white whitespace-nowrap truncate">
          Insho Text
        </span>
      </div>

      {/* Zone 2: Aspect ratio segmented control + Undo */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <div
          role="group"
          aria-label="Canvas aspect ratio"
          className="hidden sm:flex items-center gap-0.5 p-1 rounded-xl bg-[#121218] border border-white/10"
        >
          {ASPECT_OPTIONS.map((ratio) => {
            const active = aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => onChangeAspectRatio(ratio)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {ratio}
              </button>
            );
          })}
        </div>

        <select
          aria-label="Aspect ratio"
          value={aspectRatio}
          onChange={(e) => onChangeAspectRatio(e.target.value as AspectRatioPreset)}
          className="sm:hidden h-9 px-1.5 rounded-xl bg-[#121218] border border-white/10 text-[11px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
        >
          {ASPECT_OPTIONS.map((ratio) => (
            <option key={ratio} value={ratio} className="bg-[#121218] text-white">
              {ratio}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo last edit"
          title="Undo"
          className="min-w-[34px] min-h-[34px] sm:min-w-[40px] sm:min-h-[40px] px-2 sm:px-2.5 rounded-xl bg-[#121218] border border-white/10 flex items-center justify-center text-zinc-200 hover:bg-[#1c1c26] disabled:opacity-35 disabled:pointer-events-none transition-colors shrink-0"
        >
          <Undo2 className="w-4 h-4" />
        </button>

        {/* Zone 3: Primary Export CTA */}
        <button
          type="button"
          data-testid="top-export-btn"
          onClick={onOpenExport}
          disabled={!hasClips}
          className="min-h-[34px] sm:min-h-[40px] px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 disabled:pointer-events-none transition-all active:scale-[0.98]"
        >
          <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
}
