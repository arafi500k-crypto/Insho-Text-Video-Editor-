import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectDraft,
  deriveDraftTitle,
  filterDrafts,
  formatDraftCode,
  upsertDraftRecord,
} from './drafts';
import { DEFAULT_CLIP_CROP, DEFAULT_CLIP_FILTER } from './timeline';
import type { MediaAsset, TimelineClip } from '../types/editor';

function makeClip(id: string, label: string, assetId = 'a1'): TimelineClip {
  return {
    id,
    assetId,
    label,
    kind: 'video',
    sourceDuration: 10,
    trimStart: 0,
    trimEnd: 4,
    speed: 1,
    volume: 1,
    muted: false,
    filter: { ...DEFAULT_CLIP_FILTER },
    crop: { ...DEFAULT_CLIP_CROP },
    transitionIn: 'none',
    transitionDuration: 0.5,
  };
}

test('formatDraftCode formats MMDD-HHmm code cleanly', () => {
  const ts = new Date(2026, 10, 24, 9, 5).getTime();
  assert.equal(formatDraftCode(ts), '1124-0905');
});

test('deriveDraftTitle derives single and multi-clip titles', () => {
  assert.equal(deriveDraftTitle([]), 'Untitled Cut');
  assert.equal(deriveDraftTitle([makeClip('c1', 'Sunset')]), 'Sunset');
  assert.equal(
    deriveDraftTitle([makeClip('c1', 'Sunset'), makeClip('c2', 'Beach')]),
    'Sunset +1',
  );
});

test('buildProjectDraft, upsertDraftRecord, and filterDrafts manage drafts accurately', () => {
  const assetsById = new Map<string, MediaAsset>([
    [
      'a1',
      {
        id: 'a1',
        name: 'Sunset',
        kind: 'image',
        src: 'blob:1',
        duration: 10,
        width: 1080,
        height: 1920,
        thumbnails: ['data:image/jpeg;base64,thumb1'],
      },
    ],
  ]);

  const d1 = buildProjectDraft({
    id: 'draft-1',
    updatedAt: new Date(2026, 10, 24, 10, 0).getTime(),
    aspectRatio: '9:16',
    clips: [makeClip('c1', 'Sunset', 'a1')],
    overlays: [],
    audioTracks: [],
    assetsById,
  });

  const d2 = buildProjectDraft({
    id: 'draft-2',
    updatedAt: new Date(2026, 10, 24, 11, 30).getTime(),
    aspectRatio: '16:9',
    clips: [makeClip('c2', 'City Night', 'a2')],
    overlays: [],
    audioTracks: [],
    assetsById,
  });

  const list = upsertDraftRecord([d1], d2);
  assert.deepEqual(
    list.map((d) => d.id),
    ['draft-2', 'draft-1'],
  );
  assert.equal(d1.thumbnail, 'data:image/jpeg;base64,thumb1');
  assert.equal(d1.totalDuration, 4);

  const updatedD1 = { ...d1, updatedAt: new Date(2026, 10, 24, 12, 0).getTime() };
  const reordered = upsertDraftRecord(list, updatedD1);
  assert.deepEqual(
    reordered.map((d) => d.id),
    ['draft-1', 'draft-2'],
  );

  assert.equal(filterDrafts(reordered, 'city').length, 1);
  assert.equal(filterDrafts(reordered, '1124-1000').length, 1);
  assert.equal(filterDrafts(reordered, 'nonexistent').length, 0);
  assert.equal(filterDrafts(reordered, '').length, 2);
});
