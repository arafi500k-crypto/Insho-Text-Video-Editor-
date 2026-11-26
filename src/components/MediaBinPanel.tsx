import { Film, Image as ImageIcon, Plus, Sparkles, Upload } from 'lucide-react';
import type { MediaAsset } from '../types/editor';

interface MediaBinPanelProps {
  assets: MediaAsset[];
  importing: boolean;
  importError: string | null;
  onTriggerImport: () => void;
  onAddAssetToTimeline: (asset: MediaAsset) => void;
  onLoadSampleProject: () => void;
  onClearProject: () => void;
  hasClips: boolean;
}

export function MediaBinPanel({
  assets,
  importing,
  importError,
  onTriggerImport,
  onAddAssetToTimeline,
  onLoadSampleProject,
  onClearProject,
  hasClips,
}: MediaBinPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm text-white">Media Gallery</h3>
          <p className="text-xs text-zinc-400">
            Import videos or photos from device storage
          </p>
        </div>
        {hasClips && (
          <button
            type="button"
            onClick={onClearProject}
            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors whitespace-nowrap shrink-0"
          >
            Clear Timeline
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onTriggerImport}
          disabled={importing}
          className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 whitespace-nowrap"
        >
          <Upload className="w-4 h-4" />
          <span>{importing ? 'Importing…' : 'Import Video / Photo'}</span>
        </button>

        <button
          type="button"
          onClick={onLoadSampleProject}
          title="Load sample clips"
          className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#1a1a24] border border-white/10 hover:bg-[#232330] text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Sample</span>
        </button>
      </div>

      {importError && (
        <div
          role="alert"
          className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-300"
        >
          {importError}
        </div>
      )}

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center text-xs text-zinc-400">
          No media imported yet. Tap <strong className="text-white">Import Video / Photo</strong> to pick clips from your gallery.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2.5">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="rounded-xl bg-[#181822] border border-white/10 overflow-hidden flex flex-col"
            >
              <div className="relative aspect-[16/10] bg-black overflow-hidden">
                {asset.thumbnails[0] ? (
                  <img
                    src={asset.thumbnails[0]}
                    alt={asset.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-500">
                    {asset.kind === 'video' ? (
                      <Film className="w-5 h-5" />
                    ) : (
                      <ImageIcon className="w-5 h-5" />
                    )}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <span className="absolute bottom-1.5 left-2 text-[10px] font-mono-tabular text-zinc-200">
                  {asset.kind === 'video' ? `${asset.duration.toFixed(1)}s` : 'Photo'}
                </span>
              </div>

              <div className="p-2 flex items-center justify-between gap-1.5">
                <span className="text-xs font-medium text-zinc-200 truncate">
                  {asset.name}
                </span>
                <button
                  type="button"
                  onClick={() => onAddAssetToTimeline(asset)}
                  aria-label={`Add ${asset.name} to timeline`}
                  className="min-w-[32px] min-h-[32px] rounded-lg bg-pink-500/20 hover:bg-pink-500 text-pink-300 hover:text-white flex items-center justify-center transition-colors shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
