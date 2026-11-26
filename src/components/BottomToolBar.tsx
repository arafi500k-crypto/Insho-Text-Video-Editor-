import {
  ArrowLeft,
  ArrowLeftRight,
  FolderPlus,
  Layers,
  Music,
  Pipette,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';
import type { EditorTool, MediaOverlay } from '../types/editor';

interface BottomToolBarProps {
  activeTool: EditorTool;
  drawerOpen: boolean;
  selectedMediaOverlay: MediaOverlay | null;
  onSelectTool: (tool: EditorTool) => void;
  onBackFromOverlayBar: () => void;
  onOpenChromaKey: () => void;
  onToggleOverlaySpin: () => void;
  onOpenOverlayDrawer: () => void;
  onTriggerOverlayImport: () => void;
  onDeleteSelectedOverlay: () => void;
}

export const TOOL_ITEMS: Array<{
  id: EditorTool;
  label: string;
  icon: typeof FolderPlus;
}> = [
  { id: 'media', label: 'Media', icon: FolderPlus },
  { id: 'edit', label: 'Edit', icon: SlidersHorizontal },
  { id: 'overlay', label: 'Overlay', icon: Layers },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'filter', label: 'Filter', icon: Sparkles },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'transition', label: 'Transit', icon: ArrowLeftRight },
];

export function BottomToolBar({
  activeTool,
  drawerOpen,
  selectedMediaOverlay,
  onSelectTool,
  onBackFromOverlayBar,
  onOpenChromaKey,
  onToggleOverlaySpin,
  onOpenOverlayDrawer,
  onTriggerOverlayImport,
  onDeleteSelectedOverlay,
}: BottomToolBarProps) {
  if (selectedMediaOverlay) {
    return (
      <nav
        aria-label="Overlay actions"
        data-testid="overlay-bottom-action-bar"
        className="lg:hidden shrink-0 h-13 sm:h-14 border-t border-white/10 bg-[#121218]/95 backdrop-blur-md grid grid-cols-6 items-center px-0.5 sm:px-1 z-30"
      >
        <button
          type="button"
          onClick={onBackFromOverlayBar}
          aria-label="Back to main tools"
          className="min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl text-zinc-300 hover:text-white transition-colors min-w-0"
        >
          <ArrowLeft className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
            Back
          </span>
        </button>

        <button
          type="button"
          data-testid="bottom-chroma-key-btn"
          onClick={onOpenChromaKey}
          aria-pressed={selectedMediaOverlay.chromaKey.enabled}
          className={`min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors min-w-0 ${
            selectedMediaOverlay.chromaKey.enabled
              ? 'text-pink-400 bg-pink-500/15'
              : 'text-zinc-200 hover:text-pink-400 hover:bg-white/5'
          }`}
        >
          <Pipette className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
            Chroma
          </span>
        </button>

        <button
          type="button"
          data-testid="bottom-overlay-spin-btn"
          onClick={onToggleOverlaySpin}
          aria-pressed={selectedMediaOverlay.spinEnabled}
          className={`min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors min-w-0 ${
            selectedMediaOverlay.spinEnabled
              ? 'text-pink-400 bg-pink-500/15'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          <RefreshCw className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
            Spin 360°
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenOverlayDrawer}
          aria-pressed={drawerOpen && activeTool === 'overlay'}
          className={`min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors min-w-0 ${
            drawerOpen && activeTool === 'overlay'
              ? 'text-pink-400 bg-pink-500/10'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
            Adjust
          </span>
        </button>

        <button
          type="button"
          onClick={onTriggerOverlayImport}
          className="min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl text-zinc-300 hover:text-white transition-colors min-w-0"
        >
          <Plus className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
            Add
          </span>
        </button>

        <button
          type="button"
          onClick={onDeleteSelectedOverlay}
          aria-label="Delete selected overlay"
          className="min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors min-w-0"
        >
          <Trash2 className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
            Delete
          </span>
        </button>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Editor tools"
      className="lg:hidden shrink-0 h-13 sm:h-14 border-t border-white/10 bg-[#121218]/95 backdrop-blur-md grid grid-cols-7 items-center px-0.5 sm:px-1 z-30"
    >
      {TOOL_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = drawerOpen && activeTool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTool(item.id)}
            aria-pressed={isActive}
            className={`min-h-[42px] px-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors min-w-0 ${
              isActive
                ? 'text-pink-400 bg-pink-500/10'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <Icon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            <span className="text-[9.5px] sm:text-[10px] font-medium tracking-tight leading-none truncate max-w-full">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
