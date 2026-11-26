import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from 'webm-muxer';
import type {
  AspectRatioPreset,
  AudioTrackItem,
  ExportResolution,
  MediaAsset,
  MediaOverlay,
  TextOverlay,
  TimelineClip,
} from '../types/editor';
import { decodeAudioSrcToBuffer } from './audioEngine';
import {
  pauseAllCachedVideos,
  renderTimelineFrame,
  syncVideoElementsForTime,
} from './canvasRenderer';
import {
  buildWebCodecsEncoderCandidates,
  computeExportFrameSchedule,
  getExportProgressUpdateStep,
  getExportTargetBitrate,
  selectMediaRecorderMimeCandidates,
  shouldPreferMediaRecorderMp4,
  type WebCodecsEncoderCandidate,
} from './exportHelpers';
import { getOrCreateVideoElement, loadImageElement } from './mediaLoader';
import { createExportVideoFrameReader } from './videoFrameReader';
import {
  clamp,
  computeClipSegments,
  computeMediaOverlaySourceTime,
  findActiveSegmentAtTime,
  getExportDimensions,
  getTotalTimelineDuration,
  mapTimelineTimeToSourceTime,
} from './timeline';

export interface ExportOptions {
  clips: TimelineClip[];
  assetsById: Map<string, MediaAsset>;
  overlays: TextOverlay[];
  mediaOverlays?: MediaOverlay[];
  audioTracks: AudioTrackItem[];
  aspectRatio: AspectRatioPreset;
  resolution: ExportResolution;
  fps: 30 | 60;
  signal: AbortSignal;
  onProgress: (progressPercent: number, currentSec: number, totalSec: number) => void;
}

export interface ExportResult {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: 'mp4' | 'webm';
  width: number;
  height: number;
  duration: number;
  durationMs: number;
  engine: 'webcodecs' | 'mediarecorder';
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const yieldToUi = (): Promise<void> =>
  typeof MessageChannel !== 'undefined'
    ? new Promise<void>((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve();
        ch.port2.postMessage(undefined);
      })
    : sleep(0);

async function waitForVideoEncoderSlot(
  encoder: VideoEncoder,
  maxQueueSize: number,
  signal: AbortSignal,
  getFailure: () => Error | null,
): Promise<void> {
  if (encoder.encodeQueueSize <= maxQueueSize) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let safetyTimer = 0;
    const cleanup = () => {
      encoder.removeEventListener('dequeue', check);
      signal.removeEventListener('abort', check);
      window.clearTimeout(safetyTimer);
    };
    const check = () => {
      if (settled) return;
      if (signal.aborted) {
        settled = true;
        cleanup();
        reject(new Error('Export cancelled.'));
        return;
      }
      const err = getFailure();
      if (err) {
        settled = true;
        cleanup();
        reject(err);
        return;
      }
      if (encoder.encodeQueueSize <= maxQueueSize) {
        settled = true;
        cleanup();
        resolve();
        return;
      }
      window.clearTimeout(safetyTimer);
      safetyTimer = window.setTimeout(check, 250);
    };
    encoder.addEventListener('dequeue', check);
    signal.addEventListener('abort', check, { once: true });
    check();
  });
}

async function waitForVideoReady(
  video: HTMLVideoElement,
  timeoutMs = 3500,
): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) {
    return;
  }
  if (video.readyState === 0) {
    try {
      video.load();
    } catch {
      // ignore
    }
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', onCheck);
      video.removeEventListener('canplay', onCheck);
      video.removeEventListener('error', finish);
      resolve();
    };
    const onCheck = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        finish();
      }
    };
    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener('loadeddata', onCheck);
    video.addEventListener('canplay', onCheck);
    video.addEventListener('error', finish, { once: true });
    onCheck();
  });
}

async function prewarmExportAssets(
  clips: TimelineClip[],
  assetsById: Map<string, MediaAsset>,
  mediaOverlays: MediaOverlay[],
  shouldSkipVideoAsset?: (assetId: string) => boolean,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  const seenAssets = new Set<string>();

  for (const clip of clips) {
    const asset = assetsById.get(clip.assetId);
    if (!asset || seenAssets.has(asset.id)) continue;
    seenAssets.add(asset.id);
    if (asset.kind === 'image') {
      tasks.push(loadImageElement(asset.id, asset.src).then(() => undefined).catch(() => undefined));
    } else if (!shouldSkipVideoAsset?.(asset.id)) {
      const video = getOrCreateVideoElement(asset.id, asset.src);
      video.preload = 'auto';
      tasks.push(waitForVideoReady(video, 3500));
    }
  }

  for (const ov of mediaOverlays) {
    const asset = assetsById.get(ov.assetId);
    if (!asset) continue;
    if (asset.kind === 'image') {
      if (!seenAssets.has(asset.id)) {
        seenAssets.add(asset.id);
        tasks.push(loadImageElement(asset.id, asset.src).then(() => undefined).catch(() => undefined));
      }
    } else if (!shouldSkipVideoAsset?.(asset.id)) {
      const ovVideo = getOrCreateVideoElement(`overlay:${ov.id}`, asset.src);
      ovVideo.preload = 'auto';
      ovVideo.muted = true;
      tasks.push(waitForVideoReady(ovVideo, 3500));
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function seekVideoDeterministically(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs = 800,
): Promise<void> {
  if (!video.paused) {
    try {
      video.pause();
    } catch {
      // ignore
    }
  }
  const safeTarget = clamp(
    targetTime,
    0,
    Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.02) : targetTime,
  );
  if (
    video.readyState >= 2 &&
    !video.seeking &&
    video.videoWidth > 0 &&
    Math.abs(video.currentTime - safeTarget) <= 0.025
  ) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let seekedFired = false;
    let pollTimer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(pollTimer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onFrameReady);
      video.removeEventListener('canplay', onFrameReady);
      resolve();
    };

    const onFrameReady = () => {
      if ((seekedFired || !video.seeking) && video.readyState >= 2 && video.videoWidth > 0) {
        finish();
      }
    };

    const onSeeked = () => {
      seekedFired = true;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        finish();
      } else if (!pollTimer) {
        pollTimer = window.setInterval(onFrameReady, 16);
      }
    };

    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', onFrameReady);
    video.addEventListener('canplay', onFrameReady);
    try {
      video.currentTime = safeTarget;
    } catch {
      finish();
      return;
    }
    // HTMLMediaElement sets .seeking = true synchronously when a real seek begins;
    // if .seeking remains false and a decoded frame is ready, no seeked event will fire.
    if (!video.seeking && video.readyState >= 2 && video.videoWidth > 0) {
      finish();
    }
  });
}

async function syncOfflineVideosAtTime(
  clips: TimelineClip[],
  assetsById: Map<string, MediaAsset>,
  timelineTime: number,
  mediaOverlays: MediaOverlay[],
  shouldSkipVideoAsset?: (assetId: string) => boolean,
): Promise<void> {
  const segments = computeClipSegments(clips);
  const activeSeg = findActiveSegmentAtTime(segments, timelineTime);
  const tasks: Promise<void>[] = [];

  if (activeSeg) {
    const asset = assetsById.get(activeSeg.clip.assetId);
    if (asset && asset.kind === 'video' && !shouldSkipVideoAsset?.(asset.id)) {
      const video = getOrCreateVideoElement(asset.id, asset.src);
      const sourceTime = mapTimelineTimeToSourceTime(activeSeg, timelineTime);
      tasks.push(seekVideoDeterministically(video, sourceTime));
    }
  }

  for (const ov of mediaOverlays) {
    if (
      ov.kind === 'video' &&
      timelineTime >= ov.startTime &&
      timelineTime <= ov.startTime + ov.duration
    ) {
      const asset = assetsById.get(ov.assetId);
      if (asset && !shouldSkipVideoAsset?.(asset.id)) {
        const ovVideo = getOrCreateVideoElement(`overlay:${ov.id}`, asset.src);
        const ovSourceTime = computeMediaOverlaySourceTime(ov, timelineTime);
        tasks.push(seekVideoDeterministically(ovVideo, ovSourceTime));
      }
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function renderMixedOfflineAudioBuffer(
  clips: TimelineClip[],
  assetsById: Map<string, MediaAsset>,
  audioTracks: AudioTrackItem[],
  totalDuration: number,
  mediaOverlays: MediaOverlay[] = [],
): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;

  const activeAudioTracks = audioTracks.filter((t) => !t.muted && t.volume > 0);
  const segments = computeClipSegments(clips);
  const unmutedVideoSegments = segments.filter((seg) => {
    const asset = assetsById.get(seg.clip.assetId);
    return asset?.kind === 'video' && !seg.clip.muted && seg.clip.volume > 0;
  });
  const unmutedMediaOverlays = mediaOverlays.filter((ov) => {
    const asset = assetsById.get(ov.assetId);
    return ov.kind === 'video' && asset?.kind === 'video' && !ov.muted && (ov.volume ?? 1) > 0;
  });

  if (
    activeAudioTracks.length === 0 &&
    unmutedVideoSegments.length === 0 &&
    unmutedMediaOverlays.length === 0
  ) {
    return null;
  }

  const sampleRate = 48_000;
  const frameCount = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
  let hasAnySource = false;

  for (const track of activeAudioTracks) {
    const buffer = await decodeAudioSrcToBuffer(track.src, offlineCtx);
    if (!buffer || buffer.duration <= 0.05) continue;
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = offlineCtx.createGain();
    gain.gain.value = clamp(track.volume, 0, 1);
    source.connect(gain);
    gain.connect(offlineCtx.destination);
    source.start(Math.max(0, track.startTime));
    hasAnySource = true;
  }

  for (const seg of unmutedVideoSegments) {
    const asset = assetsById.get(seg.clip.assetId);
    if (!asset) continue;
    const buffer = await decodeAudioSrcToBuffer(asset.src, offlineCtx);
    if (!buffer || buffer.duration <= 0.05) continue;
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = clamp(seg.clip.speed, 0.25, 4);
    const gain = offlineCtx.createGain();
    gain.gain.value = clamp(seg.clip.volume, 0, 1);
    source.connect(gain);
    gain.connect(offlineCtx.destination);

    const offset = clamp(seg.clip.trimStart, 0, Math.max(0, buffer.duration - 0.02));
    const maxPlayable = Math.max(0.02, buffer.duration - offset);
    const sourceSpan = Math.min(maxPlayable, seg.duration * seg.clip.speed);
    source.start(seg.startTime, offset, sourceSpan);
    hasAnySource = true;
  }

  for (const ov of unmutedMediaOverlays) {
    const asset = assetsById.get(ov.assetId);
    if (!asset) continue;
    const buffer = await decodeAudioSrcToBuffer(asset.src, offlineCtx);
    if (!buffer || buffer.duration <= 0.05) continue;
    const gain = offlineCtx.createGain();
    gain.gain.value = clamp(ov.volume ?? 1, 0, 1);
    gain.connect(offlineCtx.destination);

    let elapsedSpan = 0;
    while (elapsedSpan < ov.duration) {
      const chunkDur = Math.min(buffer.duration, ov.duration - elapsedSpan);
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(ov.startTime + elapsedSpan, 0, chunkDur);
      elapsedSpan += buffer.duration;
      hasAnySource = true;
    }
  }

  if (!hasAnySource) return null;
  try {
    return await offlineCtx.startRendering();
  } catch {
    return null;
  }
}

interface ResolvedWebCodecsSpec {
  videoCandidate: WebCodecsEncoderCandidate;
  audioCodec: 'mp4a.40.2' | 'opus' | null;
}

function canMediaRecorderUseMp4(hasAudio: boolean): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  return selectMediaRecorderMimeCandidates(hasAudio).some(
    (c) => c.extension === 'mp4' && MediaRecorder.isTypeSupported(c.mimeType),
  );
}

async function resolveSupportedWebCodecsSpec(
  width: number,
  height: number,
  fps: 30 | 60,
  resolution: ExportResolution,
  hasMixedAudio: boolean,
): Promise<ResolvedWebCodecsSpec | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }

  const candidates = buildWebCodecsEncoderCandidates({
    width,
    height,
    fps,
    resolution,
  });

  const videoSupported: Array<{
    candidate: WebCodecsEncoderCandidate;
    audioCodec: 'mp4a.40.2' | 'opus' | null;
  }> = [];
  let cachedAacSupported: boolean | null = null;
  let cachedOpusSupported: boolean | null = null;

  const checkAudioCodec = async (audioCodecToTest: 'mp4a.40.2' | 'opus'): Promise<boolean> => {
    if (!hasMixedAudio || typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
      return false;
    }
    if (audioCodecToTest === 'mp4a.40.2' && cachedAacSupported !== null) return cachedAacSupported;
    if (audioCodecToTest === 'opus' && cachedOpusSupported !== null) return cachedOpusSupported;
    let supported = false;
    try {
      const audioCheck = await AudioEncoder.isConfigSupported({
        codec: audioCodecToTest,
        numberOfChannels: 2,
        sampleRate: 48_000,
        bitrate: 128_000,
      });
      supported = Boolean(audioCheck.supported);
    } catch {
      supported = false;
    }
    if (audioCodecToTest === 'mp4a.40.2') cachedAacSupported = supported;
    else cachedOpusSupported = supported;
    return supported;
  };

  for (const cand of candidates) {
    try {
      const check = await VideoEncoder.isConfigSupported({
        codec: cand.codec,
        width,
        height,
        bitrate: cand.videoBitrate,
        framerate: fps,
        hardwareAcceleration: cand.hardwareAcceleration ?? 'no-preference',
        latencyMode: cand.latencyMode ?? 'realtime',
        ...(cand.avcFormat ? { avc: { format: cand.avcFormat } } : {}),
      });
      if (!check.supported) continue;

      let supportedAudioCodec: 'mp4a.40.2' | 'opus' | null = null;
      if (hasMixedAudio) {
        const audioCodecToTest = cand.container === 'mp4' ? 'mp4a.40.2' : 'opus';
        if (await checkAudioCodec(audioCodecToTest)) {
          supportedAudioCodec = audioCodecToTest;
        }
      }

      // Short-circuit immediately on the first ideal MP4 match to avoid probing all candidates
      if (cand.container === 'mp4' && (!hasMixedAudio || supportedAudioCodec !== null)) {
        return {
          videoCandidate: cand,
          audioCodec: supportedAudioCodec,
        };
      }

      videoSupported.push({ candidate: cand, audioCodec: supportedAudioCodec });
    } catch {
      // Try next encoder candidate
    }
  }

  if (videoSupported.length === 0) return null;

  const chosen =
    (hasMixedAudio ? videoSupported.find((entry) => entry.audioCodec !== null) : undefined) ??
    videoSupported[0];

  if (
    shouldPreferMediaRecorderMp4({
      hasMixedAudio,
      webCodecsContainer: chosen.candidate.container,
      mediaRecorderMp4Supported: canMediaRecorderUseMp4(true),
    })
  ) {
    return null;
  }

  return {
    videoCandidate: chosen.candidate,
    audioCodec: chosen.audioCodec,
  };
}

async function encodeAudioBufferToEncoder(
  audioBuffer: AudioBuffer,
  audioEncoder: AudioEncoder,
  signal: AbortSignal,
): Promise<void> {
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = audioBuffer.length;
  const chunkFrames = 1024;
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

  for (let offset = 0; offset < totalSamples; offset += chunkFrames) {
    if (signal.aborted) {
      throw new Error('Export cancelled.');
    }
    const count = Math.min(chunkFrames, totalSamples - offset);
    const planar = new Float32Array(count * 2);
    planar.set(left.subarray(offset, offset + count), 0);
    planar.set(right.subarray(offset, offset + count), count);

    const timestampUs = Math.round((offset / sampleRate) * 1_000_000);
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: 2,
      timestamp: timestampUs,
      data: planar,
    });
    audioEncoder.encode(audioData);
    audioData.close();

    if (audioEncoder.encodeQueueSize > 16) {
      await sleep(2);
    }
  }
}

async function exportViaWebCodecs(
  opts: ExportOptions,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  totalDuration: number,
  startPerfMs: number,
): Promise<ExportResult> {
  const {
    clips,
    assetsById,
    overlays,
    mediaOverlays = [],
    audioTracks,
    fps,
    resolution,
    signal,
    onProgress,
  } = opts;

  const segments = computeClipSegments(clips);
  const schedule = computeExportFrameSchedule(totalDuration, fps);

  const [mixedAudio, reader] = await Promise.all([
    renderMixedOfflineAudioBuffer(clips, assetsById, audioTracks, totalDuration),
    createExportVideoFrameReader({
      clips,
      segments,
      assetsById,
      mediaOverlays,
      schedule,
      totalDuration,
      signal,
    }),
  ]);

  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

  try {
    if (signal.aborted) throw new Error('Export cancelled.');

    const spec = await resolveSupportedWebCodecsSpec(
      width,
      height,
      fps,
      resolution,
      Boolean(mixedAudio),
    );
    if (!spec) {
      throw new Error('WebCodecs encoder not supported on this device.');
    }

    const { videoCandidate, audioCodec } = spec;
    const useAudio = Boolean(mixedAudio && audioCodec);

    let videoChunkCount = 0;
    let sawAvcDecoderConfig = false;
    let encoderFailure: Error | null = null;
    let finalizeBuffer: () => ArrayBuffer;
    let addVideoChunkFn: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
    let addAudioChunkFn: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void;

    if (videoCandidate.container === 'mp4') {
      const target = new Mp4ArrayBufferTarget();
      const muxer = new Mp4Muxer({
        target,
        video: {
          codec: 'avc',
          width,
          height,
          frameRate: fps,
        },
        ...(useAudio && mixedAudio
          ? {
              audio: {
                codec: 'aac',
                numberOfChannels: 2,
                sampleRate: mixedAudio.sampleRate,
              },
            }
          : {}),
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      addVideoChunkFn = (chunk, meta) => {
        videoChunkCount += 1;
        if (meta?.decoderConfig?.description && meta.decoderConfig.description.byteLength > 0) {
          sawAvcDecoderConfig = true;
        }
        muxer.addVideoChunk(chunk, meta);
      };
      addAudioChunkFn = (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      };
      finalizeBuffer = () => {
        muxer.finalize();
        return target.buffer;
      };
    } else {
      const target = new WebmArrayBufferTarget();
      const muxer = new WebmMuxer({
        target,
        video: {
          codec: videoCandidate.muxerVideoCodec,
          width,
          height,
          frameRate: fps,
        },
        ...(useAudio && mixedAudio
          ? {
              audio: {
                codec: 'A_OPUS',
                numberOfChannels: 2,
                sampleRate: mixedAudio.sampleRate,
              },
            }
          : {}),
        firstTimestampBehavior: 'offset',
      });
      addVideoChunkFn = (chunk, meta) => {
        videoChunkCount += 1;
        muxer.addVideoChunk(chunk, meta);
      };
      addAudioChunkFn = (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      };
      finalizeBuffer = () => {
        muxer.finalize();
        return target.buffer;
      };
    }

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => addVideoChunkFn(chunk, meta),
      error: (err) => {
        encoderFailure = err instanceof Error ? err : new Error(String(err));
      },
    });

    if (useAudio && mixedAudio && audioCodec) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => addAudioChunkFn(chunk, meta),
        error: (err) => {
          encoderFailure = err instanceof Error ? err : new Error(String(err));
        },
      });
    }

    videoEncoder.configure({
      codec: videoCandidate.codec,
      width,
      height,
      bitrate: videoCandidate.videoBitrate,
      framerate: fps,
      hardwareAcceleration: videoCandidate.hardwareAcceleration ?? 'no-preference',
      latencyMode: videoCandidate.latencyMode ?? 'realtime',
      ...(videoCandidate.avcFormat ? { avc: { format: videoCandidate.avcFormat } } : {}),
    });

    if (audioEncoder && audioCodec && mixedAudio) {
      audioEncoder.configure({
        codec: audioCodec,
        numberOfChannels: 2,
        sampleRate: mixedAudio.sampleRate,
        bitrate: 128_000,
      });
      await encodeAudioBufferToEncoder(mixedAudio, audioEncoder, signal);
    }

    await prewarmExportAssets(clips, assetsById, mediaOverlays, (assetId) =>
      reader.hasAssetReader(assetId),
    );
    if (signal.aborted) {
      throw new Error('Export cancelled.');
    }

    pauseAllCachedVideos();
    const progressStep = getExportProgressUpdateStep(schedule.totalFrames);
    const needsFallbackDomVideo =
      segments.some((seg) => {
        const asset = assetsById.get(seg.clip.assetId);
        return Boolean(asset?.kind === 'video' && !reader.hasAssetReader(asset.id));
      }) ||
      mediaOverlays.some((ov) => {
        if (ov.kind !== 'video') return false;
        const asset = assetsById.get(ov.assetId);
        return Boolean(asset && !reader.hasAssetReader(asset.id));
      });

    for (let i = 0; i < schedule.totalFrames; i++) {
      if (signal.aborted) {
        throw new Error('Export cancelled.');
      }
      if (encoderFailure) {
        throw encoderFailure;
      }

      const timelineTime = Math.min(totalDuration - 0.002, i * schedule.frameDurationSec);
      const videoFrameOverrides = await reader.prepareFrameOverrides(i, timelineTime);
      if (needsFallbackDomVideo) {
        await syncOfflineVideosAtTime(clips, assetsById, timelineTime, mediaOverlays, (assetId) =>
          reader.hasAssetReader(assetId),
        );
      }

      renderTimelineFrame({
        ctx,
        width,
        height,
        clips,
        assetsById,
        overlays,
        mediaOverlays,
        timelineTime,
        showSelectionGuide: false,
        chromaMaxDim: 300,
        precomputedSegments: segments,
        skipSnapshotCache: true,
        imageSmoothingQuality: 'low',
        videoFrameOverrides,
      });

      await waitForVideoEncoderSlot(videoEncoder, 24, signal, () => encoderFailure);

      const timestampUs = i * schedule.frameDurationUs;
      const frame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: schedule.frameDurationUs,
      });
      try {
        videoEncoder.encode(frame, { keyFrame: i === 0 || i % fps === 0 });
      } finally {
        frame.close();
      }

      if (i % progressStep === 0 || i === schedule.totalFrames - 1) {
        const pct = Math.min(96, Math.round(((i + 1) / schedule.totalFrames) * 96));
        onProgress(pct, Math.min(totalDuration, timelineTime), totalDuration);
        await yieldToUi();
      }
    }

    if (encoderFailure) throw encoderFailure;
    await videoEncoder.flush();
    if (audioEncoder) {
      await audioEncoder.flush();
    }
    if (encoderFailure) throw encoderFailure;
    if (videoCandidate.container === 'mp4' && !sawAvcDecoderConfig) {
      throw new Error('MP4 encoder omitted AVC decoder config.');
    }

    const buffer = finalizeBuffer();
    if (videoChunkCount === 0 || buffer.byteLength === 0) {
      throw new Error('Encoded video output was empty.');
    }

    const blob = new Blob([buffer], { type: videoCandidate.mimeType });
    const url = URL.createObjectURL(blob);
    onProgress(100, totalDuration, totalDuration);

    return {
      blob,
      url,
      mimeType: videoCandidate.mimeType,
      extension: videoCandidate.extension,
      width,
      height,
      duration: totalDuration,
      durationMs: Math.max(50, Math.round(performance.now() - startPerfMs)),
      engine: 'webcodecs',
    };
  } finally {
    pauseAllCachedVideos();
    await reader.dispose();
    try {
      if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // ignore
    }
    try {
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // ignore
    }
  }
}

function createMediaRecorderWithFallback(
  stream: MediaStream,
  hasAudio: boolean,
  videoBitsPerSecond: number,
): { recorder: MediaRecorder; mimeType: string; extension: 'mp4' | 'webm' } {
  const candidates = selectMediaRecorderMimeCandidates(hasAudio);
  for (const item of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(item.mimeType)
    ) {
      try {
        const recorder = new MediaRecorder(stream, {
          mimeType: item.mimeType,
          videoBitsPerSecond,
        });
        return { recorder, mimeType: item.mimeType, extension: item.extension };
      } catch {
        // Try next candidate
      }
    }
  }

  const fallbackRecorder = new MediaRecorder(stream);
  const actualType = fallbackRecorder.mimeType || 'video/webm';
  const ext: 'mp4' | 'webm' = actualType.includes('mp4') ? 'mp4' : 'webm';
  return { recorder: fallbackRecorder, mimeType: actualType, extension: ext };
}

async function exportViaMediaRecorder(
  opts: ExportOptions,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  totalDuration: number,
  startPerfMs: number,
): Promise<ExportResult> {
  const {
    clips,
    assetsById,
    overlays,
    mediaOverlays = [],
    audioTracks,
    resolution,
    fps,
    signal,
    onProgress,
  } = opts;

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Video export is not supported in this browser (MediaRecorder unavailable).');
  }

  await prewarmExportAssets(clips, assetsById, mediaOverlays);
  await syncOfflineVideosAtTime(clips, assetsById, 0, mediaOverlays);
  renderTimelineFrame({
    ctx,
    width,
    height,
    clips,
    assetsById,
    overlays,
    mediaOverlays,
    timelineTime: 0,
    showSelectionGuide: false,
    chromaMaxDim: 300,
  });

  const canvasStream = canvas.captureStream(fps);
  const canvasVideoTrack = canvasStream.getVideoTracks()[0] as
    | (MediaStreamTrack & { requestFrame?: () => void })
    | undefined;
  canvasVideoTrack?.requestFrame?.();
  let exportAudioCtx: AudioContext | null = null;
  const scheduledSources: AudioBufferSourceNode[] = [];
  const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

  const activeAudioTracks = audioTracks.filter((t) => !t.muted && t.volume > 0);
  if (activeAudioTracks.length > 0 && typeof AudioContext !== 'undefined') {
    try {
      exportAudioCtx = new AudioContext();
      const dest = exportAudioCtx.createMediaStreamDestination();
      for (const track of activeAudioTracks) {
        const buffer = await decodeAudioSrcToBuffer(track.src, exportAudioCtx);
        if (buffer) {
          const source = exportAudioCtx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const gain = exportAudioCtx.createGain();
          gain.gain.value = track.volume;
          source.connect(gain);
          gain.connect(dest);
          scheduledSources.push(source);
        }
      }
      if (scheduledSources.length > 0) {
        combinedTracks.push(...dest.stream.getAudioTracks());
      }
    } catch {
      // Proceed with video-only stream cleanly
    }
  }

  const finalStream = new MediaStream(combinedTracks);
  const hasAudio = combinedTracks.some((t) => t.kind === 'audio');
  const videoBitsPerSecond = getExportTargetBitrate(resolution, fps);
  const { recorder, mimeType, extension } = createMediaRecorderWithFallback(
    finalStream,
    hasAudio,
    videoBitsPerSecond,
  );

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return await new Promise<ExportResult>((resolve, reject) => {
    let rafOrTimer = 0;
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(rafOrTimer);
      pauseAllCachedVideos();
      scheduledSources.forEach((s) => {
        try {
          s.stop();
        } catch {
          // ignore
        }
      });
      if (exportAudioCtx) {
        exportAudioCtx.close().catch(() => {});
      }
      finalStream.getTracks().forEach((t) => t.stop());
    };

    const handleAbort = () => {
      if (settled) return;
      settled = true;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      cleanup();
      reject(new Error('Export cancelled.'));
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });

    recorder.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Video encoder encountered an error. Try 720p mode.'));
    };

    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size === 0) {
        reject(new Error('Exported video file was empty. Please try again.'));
        return;
      }
      const url = URL.createObjectURL(blob);
      onProgress(100, totalDuration, totalDuration);
      resolve({
        blob,
        url,
        mimeType,
        extension,
        width,
        height,
        duration: totalDuration,
        durationMs: Math.max(100, Math.round(performance.now() - startPerfMs)),
        engine: 'mediarecorder',
      });
    };

    recorder.start(250);
    if (exportAudioCtx) {
      const startAt = exportAudioCtx.currentTime;
      scheduledSources.forEach((s) => s.start(startAt));
    }

    const startWallMs = performance.now();
    const frameIntervalMs = 1000 / fps;

    const tick = async () => {
      if (signal.aborted || settled) return;
      const elapsedSec = (performance.now() - startWallMs) / 1000;

      if (elapsedSec >= totalDuration) {
        renderTimelineFrame({
          ctx,
          width,
          height,
          clips,
          assetsById,
          overlays,
          mediaOverlays,
          timelineTime: Math.max(0, totalDuration - 0.01),
          showSelectionGuide: false,
          chromaMaxDim: 300,
        });
        canvasVideoTrack?.requestFrame?.();
        onProgress(99, totalDuration, totalDuration);
        window.setTimeout(() => {
          if (recorder.state === 'recording') {
            try {
              recorder.requestData();
            } catch {
              // ignore
            }
          }
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }, 120);
        return;
      }

      await syncVideoElementsForTime(clips, assetsById, elapsedSec, true, mediaOverlays);
      renderTimelineFrame({
        ctx,
        width,
        height,
        clips,
        assetsById,
        overlays,
        mediaOverlays,
        timelineTime: elapsedSec,
        showSelectionGuide: false,
        chromaMaxDim: 300,
      });
      canvasVideoTrack?.requestFrame?.();

      const pct = Math.min(98, Math.round((elapsedSec / totalDuration) * 100));
      onProgress(pct, elapsedSec, totalDuration);

      rafOrTimer = window.setTimeout(tick, frameIntervalMs);
    };

    rafOrTimer = window.setTimeout(tick, 0);
  });
}

export async function exportTimelineVideo(opts: ExportOptions): Promise<ExportResult> {
  const { clips, aspectRatio, resolution, signal } = opts;

  const totalDuration = getTotalTimelineDuration(clips);
  if (totalDuration <= 0.05) {
    throw new Error('Add at least one clip to the timeline before exporting.');
  }
  if (signal.aborted) {
    throw new Error('Export cancelled.');
  }

  const startPerfMs = performance.now();
  const { width, height } = getExportDimensions(aspectRatio, resolution);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently forces synchronous CPU rasterization so VideoFrame/captureStream
  // never captures an unsynchronized blank GPU backing texture on mobile devices.
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not initialize 2D export canvas.');
  }
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, width, height);

  // Primary ultra-fast path: offline WebCodecs encoding (faster than real-time, deterministic frames)
  if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
    try {
      return await exportViaWebCodecs(
        opts,
        canvas,
        ctx,
        width,
        height,
        totalDuration,
        startPerfMs,
      );
    } catch (err) {
      if (signal.aborted) {
        throw err instanceof Error ? err : new Error('Export cancelled.');
      }
      // Fall back transparently to hardened MediaRecorder path
    }
  }

  return await exportViaMediaRecorder(
    opts,
    canvas,
    ctx,
    width,
    height,
    totalDuration,
    startPerfMs,
  );
}
