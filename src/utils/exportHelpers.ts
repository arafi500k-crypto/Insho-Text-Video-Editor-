import type { ExportResolution } from '../types/editor';

export interface MediaRecorderMimeCandidate {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export interface WebCodecsEncoderCandidate {
  container: 'mp4' | 'webm';
  extension: 'mp4' | 'webm';
  mimeType: string;
  codec: string;
  muxerVideoCodec: 'avc' | 'V_VP8' | 'V_VP9';
  avcFormat?: 'avc';
  videoBitrate: number;
  hardwareAcceleration?: 'prefer-hardware' | 'no-preference';
  latencyMode?: 'realtime' | 'quality';
}

export interface ExportFrameSchedule {
  totalFrames: number;
  frameDurationSec: number;
  frameDurationUs: number;
  fps: 30 | 60;
}

/**
 * Selects ordered MediaRecorder MIME candidates matching whether the stream
 * actually carries an audio track. Passing audio codecs (e.g. `,opus` or `,mp4a`)
 * into MediaRecorder with a video-only MediaStream throws NotSupportedError on
 * several Chromium / Android WebView builds, and VP8 encodes much faster than VP9.
 */
export function selectMediaRecorderMimeCandidates(
  hasAudio: boolean,
): MediaRecorderMimeCandidate[] {
  if (hasAudio) {
    return [
      { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
      { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
      { mimeType: 'video/mp4', extension: 'mp4' },
      { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
      { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
      { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
      { mimeType: 'video/webm', extension: 'webm' },
    ];
  }

  return [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
}

export function getExportTargetBitrate(
  resolution: ExportResolution,
  fps: 30 | 60,
): number {
  const base =
    resolution === '1080p' ? 6_200_000 : resolution === '480p' ? 1_800_000 : 3_000_000;
  return fps === 60 ? Math.round(base * 1.35) : base;
}

/**
 * Returns WebCodecs VideoEncoder candidates sorted by speed & mobile compatibility:
 * Hardware-accelerated Constrained Baseline H.264 MP4 -> Software/default H.264 MP4 -> VP8 WebM -> VP9 WebM.
 */
export function buildWebCodecsEncoderCandidates(params: {
  width: number;
  height: number;
  fps: 30 | 60;
  resolution: ExportResolution;
}): WebCodecsEncoderCandidate[] {
  const { width, height, fps, resolution } = params;
  const pixelCount = width * height;
  const videoBitrate = getExportTargetBitrate(resolution, fps);

  const avcCodecs =
    pixelCount <= 921_600
      ? ['avc1.42E01F', 'avc1.42001f', 'avc1.4d001f', 'avc1.64001f']
      : pixelCount <= 2_073_600
        ? ['avc1.42E028', 'avc1.4d002a', 'avc1.64002a', 'avc1.42002a']
        : ['avc1.640032', 'avc1.4d0032'];

  const mp4Candidates: WebCodecsEncoderCandidate[] = [];
  // Prefer hardware MediaCodec first for the primary Constrained Baseline profile (10x faster on Android)
  mp4Candidates.push({
    container: 'mp4',
    extension: 'mp4',
    mimeType: 'video/mp4',
    codec: avcCodecs[0],
    muxerVideoCodec: 'avc',
    avcFormat: 'avc',
    videoBitrate,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime',
  });

  for (const codec of avcCodecs) {
    mp4Candidates.push({
      container: 'mp4',
      extension: 'mp4',
      mimeType: 'video/mp4',
      codec,
      muxerVideoCodec: 'avc',
      avcFormat: 'avc',
      videoBitrate,
      hardwareAcceleration: 'no-preference',
      latencyMode: 'realtime',
    });
  }

  return [
    ...mp4Candidates,
    {
      container: 'webm',
      extension: 'webm',
      mimeType: 'video/webm',
      codec: 'vp8',
      muxerVideoCodec: 'V_VP8',
      videoBitrate,
      latencyMode: 'realtime',
    },
    {
      container: 'webm',
      extension: 'webm',
      mimeType: 'video/webm',
      codec: 'vp09.00.10.08',
      muxerVideoCodec: 'V_VP9',
      videoBitrate,
      latencyMode: 'realtime',
    },
  ];
}

/**
 * When audio is mixed in and WebCodecs falls back to WebM (because AAC AudioEncoder
 * is missing on some Chromium/Android builds), prefer MediaRecorder MP4 if supported
 * so phone gallery & social apps play the exported file cleanly without black frames.
 */
export function shouldPreferMediaRecorderMp4(opts: {
  hasMixedAudio: boolean;
  webCodecsContainer: 'mp4' | 'webm';
  mediaRecorderMp4Supported: boolean;
}): boolean {
  return (
    opts.hasMixedAudio &&
    opts.webCodecsContainer === 'webm' &&
    opts.mediaRecorderMp4Supported
  );
}

export function computeExportFrameSchedule(
  totalDurationSec: number,
  fps: 30 | 60,
): ExportFrameSchedule {
  const safeDur = Math.max(0.05, Number.isFinite(totalDurationSec) ? totalDurationSec : 0.05);
  const totalFrames = Math.max(2, Math.ceil(safeDur * fps));
  const frameDurationSec = 1 / fps;
  const frameDurationUs = Math.round(1_000_000 / fps);
  return {
    totalFrames,
    frameDurationSec,
    frameDurationUs,
    fps,
  };
}

/**
 * Limits React UI progress bar re-renders to ~16 updates across the entire export
 * so DOM layout transitions never stall the tight WebCodecs render loop.
 */
export function getExportProgressUpdateStep(totalFrames: number): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 16) return 1;
  return Math.max(4, Math.ceil(totalFrames / 16));
}

export function buildExportFileName(
  resolution: ExportResolution,
  extension: 'mp4' | 'webm',
): string {
  return `insho-text-${resolution}.${extension}`;
}
