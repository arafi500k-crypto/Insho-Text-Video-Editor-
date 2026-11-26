import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CLIP_CROP,
  DEFAULT_CLIP_FILTER,
  buildCssFilterString,
  canvasPointToOverlayNormalized,
  clampNormalized,
  computeChromaPickerTouchPoint,
  computeClipSegments,
  computeEdgeAutoScrollVelocity,
  computeMediaOverlayBoxSize,
  computeMediaOverlaySourceTime,
  computeMediaOverlaySpinDegrees,
  computePinchRotateTransform,
  computeRotationAngleDegrees,
  computeRotationHandleCoords,
  computeTextAnimationState,
  computeTrackDragDeltaSeconds,
  deriveTimelineTimeFromVideo,
  findActiveSegmentAtTime,
  fitBoxToBounds,
  formatTimecode,
  getClipDuration,
  getExportDimensions,
  getTotalTimelineDuration,
  isPointInRotatedRect,
  mapTimelineTimeToSourceTime,
  moveOverlayTiming,
  normalizeRotationDegrees,
  pickBestAspectRatioForAsset,
  reorderClip,
  scrollLeftToTimelineTime,
  shouldHoldPlayheadForVideo,
  splitClipAtTime,
  timelineTimeToScrollLeft,
  trimClipBounds,
  trimOverlayEndTiming,
  trimOverlayStartTiming,
} from './timeline';
import type { TextOverlay, TimelineClip } from '../types/editor';

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'c1',
    assetId: 'a1',
    label: 'Clip 1',
    kind: 'video',
    sourceDuration: 10,
    trimStart: 0,
    trimEnd: 6,
    speed: 1,
    volume: 1,
    muted: false,
    filter: { ...DEFAULT_CLIP_FILTER },
    crop: { ...DEFAULT_CLIP_CROP },
    transitionIn: 'none',
    transitionDuration: 0.5,
    ...overrides,
  };
}

test('getClipDuration accounts for trim and speed', () => {
  const clip = makeClip({ trimStart: 2, trimEnd: 8, speed: 2 });
  assert.equal(getClipDuration(clip), 3);
});

test('computeClipSegments and getTotalTimelineDuration chain clips accurately', () => {
  const clips = [
    makeClip({ id: 'c1', trimStart: 0, trimEnd: 4, speed: 1 }),
    makeClip({ id: 'c2', trimStart: 1, trimEnd: 7, speed: 2 }),
  ];
  const segments = computeClipSegments(clips);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments[0].endTime, 4);
  assert.equal(segments[1].startTime, 4);
  assert.equal(segments[1].endTime, 7);
  assert.equal(getTotalTimelineDuration(clips), 7);
});

test('findActiveSegmentAtTime and mapTimelineTimeToSourceTime resolve source time', () => {
  const clips = [
    makeClip({ id: 'c1', trimStart: 1, trimEnd: 5, speed: 1 }),
    makeClip({ id: 'c2', trimStart: 2, trimEnd: 8, speed: 2 }),
  ];
  const segments = computeClipSegments(clips);
  const seg = findActiveSegmentAtTime(segments, 5.5);
  assert.ok(seg);
  assert.equal(seg.clip.id, 'c2');
  // 5.5s on timeline = 1.5s into c2 -> at 2x speed = 3.0s elapsed + trimStart 2 = 5.0s
  assert.equal(mapTimelineTimeToSourceTime(seg, 5.5), 5);
});

test('splitClipAtTime splits clip cleanly at playhead', () => {
  const clips = [
    makeClip({ id: 'c1', trimStart: 1, trimEnd: 7, speed: 1 }),
  ];
  let seq = 10;
  const result = splitClipAtTime(clips, 'c1', 2.5, () => `split-${++seq}`);
  assert.ok(result);
  assert.equal(result.length, 2);
  assert.equal(result[0].trimStart, 1);
  assert.equal(result[0].trimEnd, 3.5);
  assert.equal(result[1].trimStart, 3.5);
  assert.equal(result[1].trimEnd, 7);
});

test('splitClipAtTime rejects splits too close to clip edges', () => {
  const clips = [makeClip({ id: 'c1', trimStart: 0, trimEnd: 4, speed: 1 })];
  assert.equal(splitClipAtTime(clips, 'c1', 0.1, () => 'x'), null);
  assert.equal(splitClipAtTime(clips, 'c1', 3.9, () => 'x'), null);
});

test('trimClipBounds enforces minimum duration and source bounds', () => {
  const clip = makeClip({ sourceDuration: 8 });
  const bounds = trimClipBounds(clip, -2, 12);
  assert.equal(bounds.trimStart, 0);
  assert.equal(bounds.trimEnd, 8);

  const tight = trimClipBounds(clip, 5, 5.05);
  assert.ok(tight.trimEnd - tight.trimStart >= 0.25);
});

test('reorderClip swaps adjacent clips safely', () => {
  const clips = [makeClip({ id: 'c1' }), makeClip({ id: 'c2' }), makeClip({ id: 'c3' })];
  const movedRight = reorderClip(clips, 'c1', 'right');
  assert.deepEqual(movedRight.map((c) => c.id), ['c2', 'c1', 'c3']);
  const edge = reorderClip(clips, 'c1', 'left');
  assert.deepEqual(edge.map((c) => c.id), ['c1', 'c2', 'c3']);
});

test('formatTimecode formats MM:SS.d correctly', () => {
  assert.equal(formatTimecode(0), '00:00.0');
  assert.equal(formatTimecode(65.47), '01:05.4');
});

test('getExportDimensions returns even dimensions for 480p, 720p, and 1080p', () => {
  assert.deepEqual(getExportDimensions('9:16', '480p'), { width: 480, height: 854 });
  assert.deepEqual(getExportDimensions('9:16', '720p'), { width: 720, height: 1280 });
  assert.deepEqual(getExportDimensions('9:16', '1080p'), { width: 1080, height: 1920 });
  assert.deepEqual(getExportDimensions('16:9', '720p'), { width: 1280, height: 720 });
  assert.deepEqual(getExportDimensions('1:1', '1080p'), { width: 1080, height: 1080 });
});

test('buildCssFilterString formats active filter values', () => {
  assert.equal(buildCssFilterString(DEFAULT_CLIP_FILTER), 'none');
  const css = buildCssFilterString({
    preset: 'noir',
    brightness: 110,
    contrast: 125,
    saturation: 0,
    warmth: 0,
    blur: 2,
  });
  assert.match(css, /brightness\(110%\)/);
  assert.match(css, /contrast\(125%\)/);
  assert.match(css, /saturate\(0%\)/);
  assert.match(css, /blur\(2px\)/);
});

test('computeTextAnimationState interpolates pop entrance cleanly', () => {
  const overlay: TextOverlay = {
    id: 't1',
    text: 'Hello',
    startTime: 1,
    duration: 4,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    fontFamily: 'Outfit',
    fontSize: 56,
    color: '#ffffff',
    boxStyle: 'none',
    align: 'center',
    opacity: 1,
    animation: 'pop',
  };
  const startState = computeTextAnimationState(overlay, 1.0);
  const midState = computeTextAnimationState(overlay, 3.0);
  assert.ok(startState.scale < 1);
  assert.equal(midState.scale, 1);
  assert.equal(midState.opacity, 1);
});

test('normalizeRotationDegrees wraps negative and >360 angles cleanly', () => {
  assert.equal(normalizeRotationDegrees(0), 0);
  assert.equal(normalizeRotationDegrees(-45), 315);
  assert.equal(normalizeRotationDegrees(360), 0);
  assert.equal(normalizeRotationDegrees(405), 45);
});

test('computeRotationAngleDegrees returns 0/90/180/270 around anchor', () => {
  assert.equal(computeRotationAngleDegrees(100, 100, 100, 40), 0);
  assert.equal(computeRotationAngleDegrees(100, 100, 160, 100), 90);
  assert.equal(computeRotationAngleDegrees(100, 100, 100, 160), 180);
  assert.equal(computeRotationAngleDegrees(100, 100, 40, 100), 270);
});

test('computeRotationHandleCoords rotates top-center handle accurately', () => {
  const top = computeRotationHandleCoords(100, 100, -50, 0);
  assert.ok(Math.abs(top.x - 100) < 0.01);
  assert.ok(Math.abs(top.y - 50) < 0.01);

  const right = computeRotationHandleCoords(100, 100, -50, 90);
  assert.ok(Math.abs(right.x - 150) < 0.01);
  assert.ok(Math.abs(right.y - 100) < 0.01);
});

test('isPointInRotatedRect checks hit detection inside rotated box', () => {
  // 100x40 rect rotated 90deg -> 40x100 effectively
  assert.equal(isPointInRotatedRect(100, 140, 100, 100, 50, 20, 90), true);
  assert.equal(isPointInRotatedRect(140, 100, 100, 100, 50, 20, 90), false);
});

test('computeTextAnimationState spin-360 rotates continuously across text duration', () => {
  const overlay: TextOverlay = {
    id: 't-spin',
    text: 'Spinning',
    startTime: 1,
    duration: 4,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    fontFamily: 'Outfit',
    fontSize: 56,
    color: '#ffffff',
    boxStyle: 'none',
    align: 'center',
    opacity: 1,
    animation: 'spin-360',
    spinSpeed: 1,
    spinDirection: 'cw',
  };

  assert.equal(computeTextAnimationState(overlay, 1).rotationDeg, 0);
  assert.equal(computeTextAnimationState(overlay, 2).rotationDeg, 180);
  assert.equal(computeTextAnimationState(overlay, 3).rotationDeg, 360);
  assert.equal(computeTextAnimationState(overlay, 5).rotationDeg, 720);

  const fastCcw: TextOverlay = { ...overlay, spinSpeed: 2, spinDirection: 'ccw' };
  assert.equal(computeTextAnimationState(fastCcw, 2).rotationDeg, -360);
});

test('moveOverlayTiming shifts startTime while preserving duration and clamping to timeline bounds', () => {
  const moved = moveOverlayTiming({ startTime: 2, duration: 3 }, 1.75, 10);
  assert.deepEqual(moved, { startTime: 3.75, duration: 3 });

  const clampedStart = moveOverlayTiming({ startTime: 2, duration: 3 }, -5, 10);
  assert.deepEqual(clampedStart, { startTime: 0, duration: 3 });

  const clampedEnd = moveOverlayTiming({ startTime: 2, duration: 3 }, 12, 10);
  assert.deepEqual(clampedEnd, { startTime: 7, duration: 3 });
});

test('trimOverlayStartTiming adjusts startTime and duration inversely while preserving endTime', () => {
  const expandedLeft = trimOverlayStartTiming({ startTime: 2, duration: 3 }, -1.25);
  assert.deepEqual(expandedLeft, { startTime: 0.75, duration: 4.25 });

  const shortenedRight = trimOverlayStartTiming({ startTime: 2, duration: 3 }, 1.5);
  assert.deepEqual(shortenedRight, { startTime: 3.5, duration: 1.5 });

  const clampedPastEnd = trimOverlayStartTiming({ startTime: 2, duration: 3 }, 10);
  assert.deepEqual(clampedPastEnd, { startTime: 4.6, duration: 0.4 });
});

test('trimOverlayEndTiming extends or shortens duration with min 0.4s and timeline bound', () => {
  const extended = trimOverlayEndTiming({ startTime: 1.5, duration: 2 }, 2.25, 10);
  assert.deepEqual(extended, { startTime: 1.5, duration: 4.25 });

  const shortened = trimOverlayEndTiming({ startTime: 1.5, duration: 2 }, -1.2, 10);
  assert.deepEqual(shortened, { startTime: 1.5, duration: 0.8 });

  const clampedMin = trimOverlayEndTiming({ startTime: 1.5, duration: 2 }, -5, 10);
  assert.deepEqual(clampedMin, { startTime: 1.5, duration: 0.4 });

  const clampedMax = trimOverlayEndTiming({ startTime: 1.5, duration: 2 }, 15, 10);
  assert.deepEqual(clampedMax, { startTime: 1.5, duration: 8.5 });
});

test('timelineTimeToScrollLeft and scrollLeftToTimelineTime sync centered playhead accurately', () => {
  assert.equal(timelineTimeToScrollLeft(2.5, 64, 10.5), 160);
  assert.equal(timelineTimeToScrollLeft(-1, 64, 10.5), 0);
  assert.equal(timelineTimeToScrollLeft(20, 64, 10.5), 672);

  assert.equal(scrollLeftToTimelineTime(160, 64, 10.5), 2.5);
  assert.equal(scrollLeftToTimelineTime(-40, 64, 10.5), 0);
  assert.equal(scrollLeftToTimelineTime(9999, 64, 10.5), 10.5);
});

test('deriveTimelineTimeFromVideo maps video currentTime back to timeline time accurately', () => {
  const seg = computeClipSegments([
    makeClip({ id: 'c1', trimStart: 0, trimEnd: 4, speed: 1 }),
    makeClip({ id: 'c2', trimStart: 2, trimEnd: 8, speed: 2 }),
  ])[1];
  // seg2 starts at 4s, spans 3s (from source 2s to 8s at 2x speed)
  assert.equal(deriveTimelineTimeFromVideo(seg, 2), 4);
  assert.equal(deriveTimelineTimeFromVideo(seg, 5), 5.5);
  assert.equal(deriveTimelineTimeFromVideo(seg, 12), 7);
});

test('DEFAULT_CLIP_CROP defaults to contain so full video is visible without cropping', () => {
  assert.equal(DEFAULT_CLIP_CROP.fit, 'contain');
  assert.equal(DEFAULT_CLIP_CROP.zoom, 1);
});

test('pickBestAspectRatioForAsset matches source media orientation accurately', () => {
  assert.equal(pickBestAspectRatioForAsset(1920, 1080), '16:9');
  assert.equal(pickBestAspectRatioForAsset(320, 180), '16:9');
  assert.equal(pickBestAspectRatioForAsset(1080, 1080), '1:1');
  assert.equal(pickBestAspectRatioForAsset(1080, 1350), '4:5');
  assert.equal(pickBestAspectRatioForAsset(1080, 1920), '9:16');
});

test('fitBoxToBounds fits target aspect ratio inside viewport without overflowing', () => {
  const landscapeInPortrait = fitBoxToBounds(366, 400, 16 / 9);
  assert.equal(landscapeInPortrait.width, 366);
  assert.ok(landscapeInPortrait.height <= 206 && landscapeInPortrait.height >= 204);

  const portraitInWide = fitBoxToBounds(600, 320, 9 / 16);
  assert.equal(portraitInWide.height, 320);
  assert.equal(portraitInWide.width, 180);
});

test('computeMediaOverlaySpinDegrees spins continuously across duration when enabled', () => {
  assert.equal(
    computeMediaOverlaySpinDegrees(
      { startTime: 1, spinEnabled: false, spinSpeed: 1, spinDirection: 'cw' },
      3,
    ),
    0,
  );
  assert.equal(
    computeMediaOverlaySpinDegrees(
      { startTime: 1, spinEnabled: true, spinSpeed: 1, spinDirection: 'cw' },
      3,
    ),
    360,
  );
  assert.equal(
    computeMediaOverlaySpinDegrees(
      { startTime: 1, spinEnabled: true, spinSpeed: 2, spinDirection: 'ccw' },
      2,
    ),
    -360,
  );
});

test('computeMediaOverlaySourceTime wraps source video cleanly and computeMediaOverlayBoxSize scales proportionally', () => {
  assert.equal(computeMediaOverlaySourceTime({ startTime: 1, sourceDuration: 2 }, 3.5), 0.5);
  const landscapeBox = computeMediaOverlayBoxSize(1080, 1920, 1920, 1080, 0.5);
  assert.equal(landscapeBox.width, 540);
  assert.ok(Math.abs(landscapeBox.height - 303.75) < 0.01);
});

test('canvasPointToOverlayNormalized maps rotated canvas points to 0..1 overlay coordinates', () => {
  // Center maps to 0.5, 0.5
  assert.deepEqual(
    canvasPointToOverlayNormalized(200, 300, 200, 300, 100, 50, 0),
    { nx: 0.5, ny: 0.5 },
  );
  // Rotated 90deg clockwise: point below center (+50 on Y) maps to right edge in local space? Wait: rotated +90deg -> local +X points down (+Y)
  const rightEdge = canvasPointToOverlayNormalized(200, 380, 200, 300, 100, 50, 90);
  assert.ok(rightEdge.nx > 0.85 && Math.abs(rightEdge.ny - 0.5) < 0.01);
});

test('clampNormalized allows moving overlays to all 4 edges (0 to 1)', () => {
  assert.equal(clampNormalized(-0.2), 0);
  assert.equal(clampNormalized(0), 0);
  assert.equal(clampNormalized(1), 1);
  assert.equal(clampNormalized(1.4), 1);
});

test('computePinchRotateTransform scales, rotates 360deg, and pans midpoint cleanly', () => {
  const res = computePinchRotateTransform({
    startX: 0.5,
    startY: 0.5,
    startScale: 0.5,
    startRotation: 10,
    startMidNx: 0.5,
    startMidNy: 0.5,
    currentMidNx: 0.7,
    currentMidNy: 0.25,
    startDist: 100,
    currentDist: 160,
    startAngleRad: 0,
    currentAngleRad: Math.PI / 2,
  });
  assert.equal(res.scale, 0.8);
  assert.equal(res.rotation, 100);
  assert.equal(res.x, 0.7);
  assert.equal(res.y, 0.25);
});

test('computeChromaPickerTouchPoint offsets sampling hole visibly beside finger touch', () => {
  const pt = computeChromaPickerTouchPoint(200, 300, 2);
  assert.equal(pt.x, 148);
  assert.equal(pt.y, 232);
  // Stays strictly to the upper-left side of the touch point
  assert.ok(pt.x < 200 && pt.y < 300);
});

test('computeEdgeAutoScrollVelocity triggers smoothly near left and right edges and stays zero in center', () => {
  // Center is stationary
  assert.equal(computeEdgeAutoScrollVelocity(195, 0, 390, 56, 360), 0);
  // Near right edge scrolls forward (+), stronger closer to edge
  const mildRight = computeEdgeAutoScrollVelocity(360, 0, 390, 56, 360);
  const hardRight = computeEdgeAutoScrollVelocity(390, 0, 390, 56, 360);
  assert.ok(mildRight > 0);
  assert.ok(hardRight > mildRight);
  // Near left edge scrolls backward (-)
  const hardLeft = computeEdgeAutoScrollVelocity(0, 0, 390, 56, 360);
  assert.ok(hardLeft < 0);
  assert.equal(Math.abs(hardLeft), hardRight);
});

test('computeTrackDragDeltaSeconds combines finger travel and timeline auto-scroll distance', () => {
  // Finger moved +120px to edge, then held stationary while scrollLeft advanced +240px at 60 px/s
  const deltaSec = computeTrackDragDeltaSeconds(150, 270, 0, 240, 60);
  assert.equal(deltaSec, 6);
});

test('shouldHoldPlayheadForVideo freezes clock while buffering/seeking and resumes paused mid-clip video', () => {
  assert.deepEqual(
    shouldHoldPlayheadForVideo({
      readyState: 1,
      seeking: false,
      ended: false,
      paused: false,
      currentTime: 2,
      trimEnd: 10,
    }),
    { holdClock: true, needsResumePlay: false },
  );
  assert.deepEqual(
    shouldHoldPlayheadForVideo({
      readyState: 4,
      seeking: true,
      ended: false,
      paused: false,
      currentTime: 2,
      trimEnd: 10,
    }),
    { holdClock: true, needsResumePlay: false },
  );
  assert.deepEqual(
    shouldHoldPlayheadForVideo({
      readyState: 4,
      seeking: false,
      ended: false,
      paused: true,
      currentTime: 4,
      trimEnd: 10,
    }),
    { holdClock: true, needsResumePlay: true },
  );
  assert.deepEqual(
    shouldHoldPlayheadForVideo({
      readyState: 4,
      seeking: false,
      ended: false,
      paused: false,
      currentTime: 4,
      trimEnd: 10,
    }),
    { holdClock: false, needsResumePlay: false },
  );
});

