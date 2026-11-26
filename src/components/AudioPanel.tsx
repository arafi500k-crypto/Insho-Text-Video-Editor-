import { Music, Plus, Trash2, Upload, Volume2, VolumeX } from 'lucide-react';
import type { AudioTrackItem, TimelineClip } from '../types/editor';
import { BUILT_IN_TRACKS, type BuiltInTrackSpec } from '../utils/audioEngine';

interface AudioPanelProps {
  selectedClip: TimelineClip | null;
  audioTracks: AudioTrackItem[];
  audioError: string | null;
  onUpdateClip: (clipId: string, updater: (prev: TimelineClip) => TimelineClip) => void;
  onTriggerAudioImport: () => void;
  onAddBuiltInTrack: (spec: BuiltInTrackSpec) => void;
  onUpdateAudioTrack: (
    trackId: string,
    updater: (prev: AudioTrackItem) => AudioTrackItem,
  ) => void;
  onDeleteAudioTrack: (trackId: string) => void;
}

export function AudioPanel({
  selectedClip,
  audioTracks,
  audioError,
  onUpdateClip,
  onTriggerAudioImport,
  onAddBuiltInTrack,
  onUpdateAudioTrack,
  onDeleteAudioTrack,
}: AudioPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm text-white">
            Music & Audio
          </h3>
          <p className="text-xs text-zinc-400">
            Mix clip audio and background soundtracks
          </p>
        </div>

        <button
          type="button"
          onClick={onTriggerAudioImport}
          className="min-h-[38px] px-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import Audio</span>
        </button>
      </div>

      {audioError && (
        <div
          role="alert"
          className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-300"
        >
          {audioError}
        </div>
      )}

      {/* Selected Video Clip Original Audio */}
      {selectedClip && (
        <div className="rounded-2xl bg-[#181822] border border-white/10 p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-200 truncate">
              Clip Audio · {selectedClip.label}
            </span>
            {selectedClip.kind === 'video' ? (
              <button
                type="button"
                onClick={() =>
                  onUpdateClip(selectedClip.id, (prev) => ({
                    ...prev,
                    muted: !prev.muted,
                  }))
                }
                aria-label={selectedClip.muted ? 'Unmute clip' : 'Mute clip'}
                className={`min-h-[32px] px-2.5 rounded-lg text-xs font-medium flex items-center gap-1 border ${
                  selectedClip.muted
                    ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                    : 'bg-[#121218] border-white/10 text-zinc-300'
                }`}
              >
                {selectedClip.muted ? (
                  <>
                    <VolumeX className="w-3.5 h-3.5" />
                    <span>Muted</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-pink-400" />
                    <span>{Math.round(selectedClip.volume * 100)}%</span>
                  </>
                )}
              </button>
            ) : (
              <span className="text-[11px] text-zinc-500">Photo clip (silent)</span>
            )}
          </div>

          {selectedClip.kind === 'video' && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={selectedClip.muted}
              value={selectedClip.volume}
              onChange={(e) =>
                onUpdateClip(selectedClip.id, (prev) => ({
                  ...prev,
                  volume: Number(e.target.value),
                }))
              }
              aria-label="Clip audio volume"
              className="insho-slider disabled:opacity-35"
            />
          )}
        </div>
      )}

      {/* Active Audio Tracks */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-300">Timeline Soundtrack</span>
        {audioTracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3.5 text-xs text-zinc-400">
            No music track added yet. Import an MP3/WAV file or pick a built-in beat below.
          </div>
        ) : (
          audioTracks.map((track) => (
            <div
              key={track.id}
              className="rounded-2xl bg-[#181822] border border-white/10 p-3 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Music className="w-4 h-4 text-pink-400 shrink-0" />
                  <span className="text-xs font-medium text-white truncate">
                    {track.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateAudioTrack(track.id, (prev) => ({
                        ...prev,
                        muted: !prev.muted,
                      }))
                    }
                    aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                    className="min-w-[34px] min-h-[34px] rounded-lg bg-[#121218] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white"
                  >
                    {track.muted ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteAudioTrack(track.id)}
                    aria-label={`Remove ${track.name}`}
                    className="min-w-[34px] min-h-[34px] rounded-lg bg-[#121218] border border-white/10 flex items-center justify-center text-zinc-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Track Volume</span>
                  <span className="font-mono-tabular text-zinc-200">
                    {Math.round(track.volume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={track.muted}
                  value={track.volume}
                  onChange={(e) =>
                    onUpdateAudioTrack(track.id, (prev) => ({
                      ...prev,
                      volume: Number(e.target.value),
                    }))
                  }
                  className="insho-slider disabled:opacity-35"
                />
              </label>
            </div>
          ))
        )}
      </div>

      {/* Built-in Studio Synth Library */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-300">Built-in Studio Beats</span>
        <div className="flex flex-col gap-1.5">
          {BUILT_IN_TRACKS.map((spec) => (
            <div
              key={spec.id}
              className="rounded-xl bg-[#181822] border border-white/10 px-3 py-2 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate">
                  {spec.name}
                </div>
                <div className="text-[11px] text-zinc-400 font-mono-tabular">
                  {spec.bpm} BPM · {spec.duration}s WAV
                </div>
              </div>
              <button
                type="button"
                onClick={() => onAddBuiltInTrack(spec)}
                className="min-h-[34px] px-2.5 rounded-lg bg-purple-600/25 hover:bg-purple-600 border border-purple-400/40 text-xs font-medium text-white flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Use</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
