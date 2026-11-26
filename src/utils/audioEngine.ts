import type { AudioTrackItem } from '../types/editor';

export interface BuiltInTrackSpec {
  id: string;
  name: string;
  bpm: number;
  duration: number;
  style: 'neon-pulse' | 'midnight-lofi' | 'velvet-chord';
}

export const BUILT_IN_TRACKS: BuiltInTrackSpec[] = [
  {
    id: 'builtin-neon-pulse',
    name: 'Neon Pulse (Synth)',
    bpm: 110,
    duration: 16,
    style: 'neon-pulse',
  },
  {
    id: 'builtin-midnight-lofi',
    name: 'Midnight Lo-Fi',
    bpm: 84,
    duration: 16,
    style: 'midnight-lofi',
  },
  {
    id: 'builtin-velvet-chord',
    name: 'Velvet Horizon',
    bpm: 96,
    duration: 16,
    style: 'velvet-chord',
  },
];

const decodedBufferCache = new Map<string, AudioBuffer | null>();
const wavUrlCache = new Map<string, string>();

function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function createBuiltInAudioTrack(spec: BuiltInTrackSpec): AudioTrackItem {
  let url = wavUrlCache.get(spec.id);
  if (!url) {
    const sampleRate = 22050;
    const totalSamples = Math.floor(spec.duration * sampleRate);
    const pcm = new Float32Array(totalSamples);
    const beatSec = 60 / spec.bpm;

    const chordProgression =
      spec.style === 'neon-pulse'
        ? [
            [220, 261.63, 329.63],
            [174.61, 220, 261.63],
            [196, 246.94, 293.66],
            [164.81, 196, 246.94],
          ]
        : spec.style === 'midnight-lofi'
          ? [
              [196, 233.08, 293.66],
              [174.61, 207.65, 261.63],
              [155.56, 196, 233.08],
              [146.83, 174.61, 220],
            ]
          : [
              [261.63, 329.63, 392.0],
              [220, 261.63, 329.63],
              [174.61, 220, 261.63],
              [196, 246.94, 293.66],
            ];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const barIndex = Math.floor(t / (beatSec * 4)) % chordProgression.length;
      const chord = chordProgression[barIndex];
      const beatPhase = (t % beatSec) / beatSec;

      // Soft warm pad chord
      let pad = 0;
      for (const freq of chord) {
        pad += Math.sin(2 * Math.PI * freq * t) * 0.08;
      }

      // Gentle rhythmic pulse / kick
      const kickEnv = Math.exp(-beatPhase * 12);
      const kick =
        spec.style === 'midnight-lofi'
          ? Math.sin(2 * Math.PI * (55 + 40 * kickEnv) * t) * kickEnv * 0.16
          : Math.sin(2 * Math.PI * (62 + 60 * kickEnv) * t) * kickEnv * 0.22;

      // Subtle melodic pluck on offbeats
      const arpNote = chord[Math.floor((t / (beatSec / 2)) % chord.length)] * 2;
      const arpPhase = (t % (beatSec / 2)) / (beatSec / 2);
      const arpEnv = Math.exp(-arpPhase * 6);
      const arp = Math.sin(2 * Math.PI * arpNote * t) * arpEnv * 0.07;

      // Fade in/out edges
      const edgeFade = Math.min(1, t / 0.3, (spec.duration - t) / 0.5);
      pcm[i] = (pad + kick + arp) * Math.max(0, edgeFade);
    }

    const blob = encodeWavFromFloat32(pcm, sampleRate);
    url = URL.createObjectURL(blob);
    wavUrlCache.set(spec.id, url);
  }

  return {
    id: spec.id,
    name: spec.name,
    src: url,
    duration: spec.duration,
    volume: 0.75,
    muted: false,
    startTime: 0,
    isBuiltIn: true,
  };
}

export async function importAudioFile(file: File, id: string): Promise<AudioTrackItem> {
  if (!file.type.startsWith('audio/')) {
    throw new Error(`Unsupported audio file: ${file.name}`);
  }
  const src = URL.createObjectURL(file);
  const audio = new Audio();
  audio.src = src;

  const duration = await new Promise<number>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 10);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not decode audio file.'));
    };
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
    };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('error', onError);
  });

  return {
    id,
    name: file.name.replace(/\.[^/.]+$/, '') || 'Imported Audio',
    src,
    duration: Number(duration.toFixed(2)),
    volume: 0.85,
    muted: false,
    startTime: 0,
  };
}

export async function decodeAudioSrcToBuffer(
  src: string,
  audioCtx: BaseAudioContext,
): Promise<AudioBuffer | null> {
  if (decodedBufferCache.has(src)) {
    return decodedBufferCache.get(src) ?? null;
  }
  try {
    const res = await fetch(src);
    const arr = await res.arrayBuffer();
    const buffer = await audioCtx.decodeAudioData(arr);
    decodedBufferCache.set(src, buffer);
    return buffer;
  } catch {
    decodedBufferCache.set(src, null);
    return null;
  }
}
