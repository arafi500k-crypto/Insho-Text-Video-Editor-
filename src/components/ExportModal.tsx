import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Film, Share2, X } from 'lucide-react';
import type {
  AspectRatioPreset,
  AudioTrackItem,
  ExportResolution,
  MediaAsset,
  MediaOverlay,
  TextOverlay,
  TimelineClip,
} from '../types/editor';
import { buildExportFileName } from '../utils/exportHelpers';
import { getExportDimensions, getTotalTimelineDuration } from '../utils/timeline';
import { exportTimelineVideo, type ExportResult } from '../utils/videoExporter';

interface ExportModalProps {
  open: boolean;
  clips: TimelineClip[];
  assetsById: Map<string, MediaAsset>;
  overlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  audioTracks: AudioTrackItem[];
  aspectRatio: AspectRatioPreset;
  onClose: () => void;
}

export function ExportModal({
  open,
  clips,
  assetsById,
  overlays,
  mediaOverlays,
  audioTracks,
  aspectRatio,
  onClose,
}: ExportModalProps) {
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [fps, setFps] = useState<30 | 60>(30);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [renderedSec, setRenderedSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      setStatus('idle');
      setProgress(0);
      setRenderedSec(0);
      setErrorMessage(null);
    }
  }, [open]);

  // Revoke object URL on result replacement/unmount
  useEffect(() => {
    return () => {
      if (result?.url) {
        URL.revokeObjectURL(result.url);
      }
    };
  }, [result]);

  if (!open) return null;

  const totalDuration = getTotalTimelineDuration(clips);
  const dims = getExportDimensions(aspectRatio, resolution);

  const handleStartExport = async () => {
    if (result?.url) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('rendering');
    setProgress(0);
    setRenderedSec(0);
    setErrorMessage(null);

    try {
      const exported = await exportTimelineVideo({
        clips,
        assetsById,
        overlays,
        mediaOverlays,
        audioTracks,
        aspectRatio,
        resolution,
        fps,
        signal: controller.signal,
        onProgress: (pct, sec) => {
          setProgress(pct);
          setRenderedSec(sec);
        },
      });
      setResult(exported);
      setStatus('done');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to export video.',
        );
        setStatus('error');
      }
    }
  };

  const handleCancelRender = () => {
    abortRef.current?.abort();
    setStatus('idle');
  };

  const handleShareResult = async () => {
    if (!result || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      return;
    }
    const filename = buildExportFileName(resolution, result.extension);
    try {
      const file = new File([result.blob], filename, { type: result.mimeType });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Insho Text Video' });
      }
    } catch {
      // Ignore user share cancellation
    }
  };

  const sizeMb = result ? (result.blob.size / (1024 * 1024)).toFixed(2) : null;
  const canShareFile =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="insho-export-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#121218] border border-white/15 p-4 sm:p-5 pb-safe flex flex-col gap-3.5 sm:gap-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="insho-export-title" className="font-display font-semibold text-base text-white truncate">
                Export Video
              </h2>
              <p className="text-xs text-zinc-400 font-mono-tabular truncate">
                {dims.width} × {dims.height} · {fps} fps · {totalDuration.toFixed(1)}s
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="min-w-[38px] min-h-[38px] rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {status === 'idle' || status === 'error' ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-zinc-300">Resolution</span>
              <div className="grid grid-cols-3 gap-2">
                {(['480p', '720p', '1080p'] as const).map((res) => {
                  const resDims = getExportDimensions(aspectRatio, res);
                  const active = resolution === res;
                  return (
                    <button
                      key={res}
                      type="button"
                      data-testid={`export-res-${res}`}
                      onClick={() => setResolution(res)}
                      className={`rounded-xl p-2 sm:p-2.5 border text-left transition-all ${
                        active
                          ? 'bg-pink-500/15 border-pink-500 text-white'
                          : 'bg-[#181822] border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                    >
                      <div className="text-xs font-semibold truncate">
                        {res === '480p' ? '480p Fast' : res === '720p' ? '720p HD' : '1080p Full'}
                      </div>
                      <div className="text-[10px] sm:text-[11px] font-mono-tabular text-zinc-400 mt-0.5 truncate">
                        {resDims.width}×{resDims.height}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-zinc-300">Frame Rate</span>
              <div className="grid grid-cols-2 gap-2">
                {([30, 60] as const).map((rate) => {
                  const active = fps === rate;
                  return (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setFps(rate)}
                      className={`min-h-[40px] sm:min-h-[42px] rounded-xl border text-xs font-mono-tabular font-semibold transition-all ${
                        active
                          ? 'bg-purple-600/25 border-purple-400 text-white'
                          : 'bg-[#181822] border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {rate} FPS
                    </button>
                  );
                })}
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-300"
              >
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              data-testid="start-export-btn"
              onClick={handleStartExport}
              className="w-full min-h-[46px] sm:min-h-[48px] rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              <Download className="w-4 h-4" />
              <span>Start Export ({resolution})</span>
            </button>
          </>
        ) : status === 'rendering' ? (
          <div className="rounded-2xl bg-[#181822] border border-white/10 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white font-medium">Fast rendering timeline…</span>
              <span className="font-mono-tabular text-pink-400 font-semibold">
                {progress}%
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div
                style={{ width: `${progress}%` }}
                className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-100"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono-tabular text-zinc-400">
              <span>
                {renderedSec.toFixed(1)}s / {totalDuration.toFixed(1)}s
              </span>
              <span>{resolution} · {fps}fps</span>
            </div>

            <button
              type="button"
              onClick={handleCancelRender}
              className="mt-1 w-full min-h-[42px] rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-200"
            >
              Cancel Export
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              data-testid="export-ready-banner"
              className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center gap-2.5 text-xs text-emerald-200"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-mono-tabular">
                Export ready · {result?.width}×{result?.height} · {sizeMb} MB ·{' '}
                {result ? `${(result.durationMs / 1000).toFixed(1)}s` : ''}
              </span>
            </div>

            {result && (
              <>
                <video
                  data-testid="exported-video-preview"
                  src={result.url}
                  controls
                  playsInline
                  className="w-full max-h-44 sm:max-h-56 rounded-xl bg-black border border-white/10 object-contain"
                />
                <div className="flex flex-wrap gap-2">
                  <a
                    data-testid="save-exported-video-link"
                    href={result.url}
                    download={buildExportFileName(resolution, result.extension)}
                    className="flex-1 min-w-[160px] min-h-[44px] px-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Save Video (.{result.extension})</span>
                  </a>
                  {canShareFile && (
                    <button
                      type="button"
                      onClick={() => void handleShareResult()}
                      aria-label="Share exported video"
                      className="min-h-[44px] px-3 rounded-xl bg-[#1a1a24] border border-white/10 text-xs font-medium text-zinc-100 flex items-center gap-1.5"
                    >
                      <Share2 className="w-4 h-4 text-pink-400" />
                      <span>Share</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStatus('idle')}
                    className="min-h-[44px] px-3.5 rounded-xl bg-[#1a1a24] border border-white/10 text-xs font-medium text-zinc-200"
                  >
                    New
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
