import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChromaKeySignature,
  computeChromaKeyAlpha,
  parseHexColor,
  rgbToHex,
  shouldReuseChromaCache,
} from './chromaKey';

test('parseHexColor and rgbToHex round-trip hex colors accurately', () => {
  assert.deepEqual(parseHexColor('#00ff55'), { r: 0, g: 255, b: 85 });
  assert.deepEqual(parseHexColor('ec4899'), { r: 236, g: 72, b: 153 });
  assert.equal(rgbToHex(16, 200, 96), '#10c860');
});

test('computeChromaKeyAlpha removes matching key colors and preserves unrelated colors', () => {
  // Exact green screen match -> transparent (0)
  assert.equal(computeChromaKeyAlpha(0, 255, 0, 0, 255, 0, 40, 20), 0);

  // Close green shade within threshold -> transparent (0)
  assert.equal(computeChromaKeyAlpha(20, 225, 18, 0, 255, 0, 40, 20), 0);

  // Edge feathering -> partial alpha between 1 and 254
  const edgeAlpha = computeChromaKeyAlpha(75, 200, 40, 0, 255, 0, 40, 20);
  assert.ok(edgeAlpha > 0 && edgeAlpha < 255);

  // Pink foreground subject far from green key -> fully opaque (255)
  assert.equal(computeChromaKeyAlpha(236, 72, 153, 0, 255, 0, 40, 20), 255);

  // Dark green shadow pixel removed when shadow cleanup is raised
  const withoutShadow = computeChromaKeyAlpha(5, 70, 5, 0, 255, 0, 20, 10, 0, 0);
  const withShadow = computeChromaKeyAlpha(5, 70, 5, 0, 255, 0, 20, 10, 80, 0);
  assert.ok(withShadow < withoutShadow);

  // Semi-transparent fringe pixel tightened when edgeCleanup is raised
  const softEdge = computeChromaKeyAlpha(75, 200, 40, 0, 255, 0, 40, 20, 0, 0);
  const cleanedEdge = computeChromaKeyAlpha(75, 200, 40, 0, 255, 0, 40, 20, 0, 80);
  assert.ok(cleanedEdge < softEdge);
});

test('chroma key cache reuses static photo overlays across spin frames and avoids duplicate video-frame keying', () => {
  const baseKey = {
    enabled: true,
    color: '#00ff55',
    similarity: 34,
    smoothness: 18,
    shadow: 0,
    edgeCleanup: 0,
    pickerX: 0.1,
    pickerY: 0.1,
  };
  const sigA = buildChromaKeySignature(1080, 1080, baseKey, 260, 'blob:photo-1');
  const sigB = buildChromaKeySignature(1080, 1080, { ...baseKey, similarity: 50 }, 260, 'blob:photo-1');

  // Static photo overlay: reuses cached canvas regardless of rotation/spin angle
  assert.equal(shouldReuseChromaCache(sigA, sigA, false, null, null), true);
  // Parameter edit invalidates cache immediately
  assert.equal(shouldReuseChromaCache(sigA, sigB, false, null, null), false);

  // Video overlay: reuses same decoded timestamp across 60Hz ticks, invalidates on next decoded frame
  assert.equal(shouldReuseChromaCache(sigA, sigA, true, 1.2, 1.2004), true);
  assert.equal(shouldReuseChromaCache(sigA, sigA, true, 1.2, 1.233), false);
});

