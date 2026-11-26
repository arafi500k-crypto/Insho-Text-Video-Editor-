import {
  ALL_FORMATS,
  BlobSource,
  Input,
  UrlSource,
  VideoSample,
  VideoSampleSink,
} from 'mediabunny';
import type {
  MediaAsset,
  MediaOverlay,
  TimelineClip,
  TimelineSegment,
} from '../types/editor';
import type { OverrideVideoFrame } from './canvasRenderer';
import type { ExportFrameSchedule } from './exportHelpers';
import {
  computeMediaOverlaySourceTime,
  findActiveSegmentAtTime,
  mapTimelineTimeToSourceTime,
} from './timeline';

interface StreamCursor {
  key: string;
  assetId: string;
  timestamps: number[];
  nextIdx: number;
  generator: AsyncGenerator<VideoSample | null, void, unknown> | null;
  currentSample: VideoSample | null;
  scratchCanvas: HTMLCanvasElement | null;
  scratchKey: string;
  failed: boolean;
}

export interface ExportVideoFrameReader {
  hasAssetReader: (assetId: string) => boolean;
  prepareFrameOverrides: (
    frameIndex: number,
    timelineTime: number,
  ) => Promise<Map<string, OverrideVideoFrame>>;
  dispose: () => Promise<void>;
}

interface OpenedVideoInput {
  input: Input;
  sink: VideoSampleSink;
  duration: number;
}

function makeOverrideFrame(
  sample: VideoSample,
  sourceKey: string,
  cursor: StreamCursor,
): OverrideVideoFrame {
  const w = Math.max(2, sample.displayWidth || sample.codedWidth || 720);
  const h = Math.max(2, sample.displayHeight || sample.codedHeight || 1280);
  return {
    width: w,
    height: h,
    sourceKey,
    timestamp: sample.timestamp,
    draw: (ctx, dx, dy, dw, dh) => {
      sample.draw(ctx, dx, dy, dw, dh);
    },
    asCanvasSource: () => {
      const targetMax = 300;
      const scale = Math.min(1, targetMax / Math.max(w, h));
      const cw = Math.max(2, Math.round(w * scale));
      const ch = Math.max(2, Math.round(h * scale));
      const sig = `${sample.timestamp}:${cw}x${ch}`;
      if (!cursor.scratchCanvas) {
        cursor.scratchCanvas = document.createElement('canvas');
      }
      if (cursor.scratchCanvas.width !== cw || cursor.scratchCanvas.height !== ch) {
        cursor.scratchCanvas.width = cw;
        cursor.scratchCanvas.height = ch;
        cursor.scratchKey = '';
      }
      if (cursor.scratchKey !== sig) {
        const sctx = cursor.scratchCanvas.getContext('2d', { willReadFrequently: true });
        if (!sctx) return null;
        sctx.clearRect(0, 0, cw, ch);
        sample.draw(sctx, 0, 0, cw, ch);
        cursor.scratchKey = sig;
      }
      return cursor.scratchCanvas;
    },
  };
}

async function openVideoInput(src: string): Promise<OpenedVideoInput | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  let input: Input | null = null;
  try {
    let source: BlobSource | UrlSource;
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const resp = await fetch(src);
      const blob = await resp.blob();
      source = new BlobSource(blob);
    } else {
      source = new UrlSource(src);
    }
    input = new Input({
      formats: ALL_FORMATS,
      source,
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      input.dispose();
      return null;
    }
    const decodable = await videoTrack.canDecode();
    if (!decodable) {
      input.dispose();
      return null;
    }
    const duration = await videoTrack.computeDuration().catch(() => 0);
    const sink = new VideoSampleSink(videoTrack, {
      hardwareAcceleration: 'no-preference',
    });
    return { input, sink, duration };
  } catch {
    if (input) {
      try {
        input.dispose();
      } catch {
        // ignore
      }
    }
    return null;
  }
}

/**
 * Decodes video frames sequentially in a single linear WebCodecs VideoDecoder pass
 * using mediabunny's monotonic VideoSampleSink.samplesAtTimestamps pipeline.
 * Avoids random-access HTMLVideoElement.currentTime seeking during export.
 */
export async function createExportVideoFrameReader(params: {
  clips: TimelineClip[];
  segments: TimelineSegment[];
  assetsById: Map<string, MediaAsset>;
  mediaOverlays: MediaOverlay[];
  schedule: ExportFrameSchedule;
  totalDuration: number;
  signal: AbortSignal;
}): Promise<ExportVideoFrameReader> {
  const { segments, assetsById, mediaOverlays, schedule, totalDuration, signal } = params;

  const uniqueVideoAssets = new Map<string, MediaAsset>();
  for (const seg of segments) {
    const asset = assetsById.get(seg.clip.assetId);
    if (asset?.kind === 'video') {
      uniqueVideoAssets.set(asset.id, asset);
    }
  }
  for (const ov of mediaOverlays) {
    if (ov.kind !== 'video') continue;
    const asset = assetsById.get(ov.assetId);
    if (asset?.kind === 'video') {
      uniqueVideoAssets.set(asset.id, asset);
    }
  }

  const openedInputs = new Map<string, OpenedVideoInput>();
  if (uniqueVideoAssets.size > 0 && typeof VideoDecoder !== 'undefined') {
    await Promise.all(
      Array.from(uniqueVideoAssets.values()).map(async (asset) => {
        if (signal.aborted) return;
        const opened = await openVideoInput(asset.src);
        if (opened) {
          openedInputs.set(asset.id, opened);
        }
      }),
    );
  }

  // Precompute monotonic timestamp arrays per segment & per overlay loop cycle
  const cursors = new Map<string, StreamCursor>();
  const frameMainKeys: Array<{ activeKey: string | null; prevHoldKey: string | null }> = [];
  const frameOverlayKeys: Array<Array<{ assetOverrideKey: string; streamKey: string }>> = [];

  const ensureCursor = (streamKey: string, assetId: string): StreamCursor => {
    let c = cursors.get(streamKey);
    if (!c) {
      c = {
        key: streamKey,
        assetId,
        timestamps: [],
        nextIdx: 0,
        generator: null,
        currentSample: null,
        scratchCanvas: null,
        scratchKey: '',
        failed: !openedInputs.has(assetId),
      };
      cursors.set(streamKey, c);
    }
    return c;
  };

  for (let i = 0; i < schedule.totalFrames; i++) {
    const timelineTime = Math.min(totalDuration - 0.002, i * schedule.frameDurationSec);
    const activeSeg = findActiveSegmentAtTime(segments, timelineTime);
    let activeKey: string | null = null;
    let prevHoldKey: string | null = null;

    if (activeSeg) {
      const asset = assetsById.get(activeSeg.clip.assetId);
      if (asset?.kind === 'video' && openedInputs.has(asset.id)) {
        const opened = openedInputs.get(asset.id)!;
        const maxTs = opened.duration > 0 ? Math.max(0, opened.duration - 0.015) : Infinity;
        const srcTime = Math.min(maxTs, mapTimelineTimeToSourceTime(activeSeg, timelineTime));
        activeKey = `seg:${activeSeg.clip.id}`;
        const cur = ensureCursor(activeKey, asset.id);
        cur.timestamps.push(srcTime);
      }

      const prevSeg = activeSeg.index > 0 ? segments[activeSeg.index - 1] : null;
      if (prevSeg && activeSeg.clip.transitionIn !== 'none') {
        const localTime = timelineTime - activeSeg.startTime;
        const transDur = Math.min(
          activeSeg.clip.transitionDuration,
          activeSeg.duration * 0.65,
          prevSeg.duration * 0.65,
        );
        if (transDur > 0 && localTime < transDur) {
          const prevAsset = assetsById.get(prevSeg.clip.assetId);
          if (prevAsset?.kind === 'video' && openedInputs.has(prevAsset.id)) {
            const opened = openedInputs.get(prevAsset.id)!;
            const maxTs = opened.duration > 0 ? Math.max(0, opened.duration - 0.015) : Infinity;
            const holdSrcTime = Math.min(
              maxTs,
              mapTimelineTimeToSourceTime(prevSeg, prevSeg.endTime - 0.01),
            );
            prevHoldKey = `hold:${prevSeg.clip.id}`;
            const cur = ensureCursor(prevHoldKey, prevAsset.id);
            if (cur.timestamps.length === 0) {
              cur.timestamps.push(holdSrcTime);
            }
          }
        }
      }
    }

    const ovKeysForFrame: Array<{ assetOverrideKey: string; streamKey: string }> = [];
    for (const ov of mediaOverlays) {
      if (
        ov.kind === 'video' &&
        timelineTime >= ov.startTime &&
        timelineTime <= ov.startTime + ov.duration
      ) {
        const ovAsset = assetsById.get(ov.assetId);
        if (ovAsset && openedInputs.has(ovAsset.id)) {
          const opened = openedInputs.get(ovAsset.id)!;
          const srcDur = Math.max(0.2, ov.sourceDuration || opened.duration || 1);
          const elapsed = Math.max(0, timelineTime - ov.startTime);
          const cycle = Math.floor(elapsed / srcDur);
          const maxTs = opened.duration > 0 ? Math.max(0, opened.duration - 0.015) : Infinity;
          const ovSrcTime = Math.min(maxTs, computeMediaOverlaySourceTime(ov, timelineTime));
          const streamKey = `ov:${ov.id}:c${cycle}`;
          const cur = ensureCursor(streamKey, ovAsset.id);
          // Enforce monotonic order in case of floating boundary rounding
          const lastTs = cur.timestamps.length > 0 ? cur.timestamps[cur.timestamps.length - 1] : -1;
          cur.timestamps.push(Math.max(lastTs, ovSrcTime));
          ovKeysForFrame.push({
            assetOverrideKey: `overlay:${ov.id}`,
            streamKey,
          });
        }
      }
    }

    frameMainKeys.push({ activeKey, prevHoldKey });
    frameOverlayKeys.push(ovKeysForFrame);
  }

  // Kick off monotonic generators lazily on first access, and eagerly retire finished ones
  const advanceCursor = async (streamKey: string): Promise<VideoSample | null> => {
    const cursor = cursors.get(streamKey);
    if (!cursor || cursor.failed) return null;

    if (streamKey.startsWith('hold:') && cursor.currentSample) {
      return cursor.currentSample;
    }

    if (!cursor.generator) {
      const opened = openedInputs.get(cursor.assetId);
      if (!opened || cursor.timestamps.length === 0) {
        cursor.failed = true;
        return null;
      }
      cursor.generator = opened.sink.samplesAtTimestamps(cursor.timestamps);
    }

    if (cursor.nextIdx >= cursor.timestamps.length) {
      return cursor.currentSample;
    }

    try {
      const step = await cursor.generator.next();
      cursor.nextIdx += 1;
      if (step.done) {
        return cursor.currentSample;
      }
      if (step.value) {
        if (cursor.currentSample && cursor.currentSample !== step.value) {
          cursor.currentSample.close();
        }
        cursor.currentSample = step.value;
      }
      return cursor.currentSample;
    } catch {
      cursor.failed = true;
      return null;
    }
  };

  return {
    hasAssetReader: (assetId: string) => openedInputs.has(assetId),

    prepareFrameOverrides: async (frameIndex: number) => {
      const overrides = new Map<string, OverrideVideoFrame>();
      const mainInfo = frameMainKeys[frameIndex];
      const ovInfos = frameOverlayKeys[frameIndex] ?? [];

      const tasks: Array<Promise<void>> = [];

      if (mainInfo?.activeKey) {
        const cursor = cursors.get(mainInfo.activeKey);
        if (cursor) {
          tasks.push(
            advanceCursor(mainInfo.activeKey).then((sample) => {
              if (sample) {
                overrides.set(
                  cursor.assetId,
                  makeOverrideFrame(sample, cursor.assetId, cursor),
                );
              }
            }),
          );
        }
      }

      if (mainInfo?.prevHoldKey) {
        const holdCursor = cursors.get(mainInfo.prevHoldKey);
        if (holdCursor) {
          const holdKey = mainInfo.prevHoldKey;
          tasks.push(
            advanceCursor(holdKey).then((sample) => {
              if (sample) {
                overrides.set(holdKey, makeOverrideFrame(sample, holdKey, holdCursor));
              }
            }),
          );
        }
      }

      for (const ov of ovInfos) {
        const ovCursor = cursors.get(ov.streamKey);
        if (ovCursor) {
          tasks.push(
            advanceCursor(ov.streamKey).then((sample) => {
              if (sample) {
                overrides.set(
                  ov.assetOverrideKey,
                  makeOverrideFrame(sample, ov.assetOverrideKey, ovCursor),
                );
              }
            }),
          );
        }
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }

      return overrides;
    },

    dispose: async () => {
      for (const cursor of cursors.values()) {
        if (cursor.currentSample) {
          try {
            cursor.currentSample.close();
          } catch {
            // ignore
          }
          cursor.currentSample = null;
        }
        if (cursor.generator) {
          try {
            await cursor.generator.return();
          } catch {
            // ignore
          }
          cursor.generator = null;
        }
      }
      cursors.clear();
      for (const opened of openedInputs.values()) {
        try {
          opened.input.dispose();
        } catch {
          // ignore
        }
      }
      openedInputs.clear();
    },
  };
}
