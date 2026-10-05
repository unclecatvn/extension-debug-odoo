import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SIZE, MIN_SIZE, clampSize, maxSize, placeFrame, readSize, resized } from '../../../../src/entrypoints/launcher/geometry.ts';

const vp = { w: 1400, h: 900 };
const GAP = 8;
const max = maxSize(vp, GAP);

test('the frame goes beside the button, away from the window edge it is near', () => {
  // button bottom right: frame on its left, bottom edges aligned
  assert.deepEqual(placeFrame({ x: 1344, y: 852, size: 40 }, { w: 420, h: 720 }, vp, GAP), { left: 916, top: 172, side: 'left', anchor: 'bottom' });
  // button top left: frame on its right, top edges aligned
  assert.deepEqual(placeFrame({ x: 20, y: 30, size: 40 }, { w: 420, h: 720 }, vp, GAP), { left: 68, top: 30, side: 'right', anchor: 'top' });
  // too tall for where it is: kept inside the window
  assert.equal(placeFrame({ x: 20, y: 300, size: 40 }, { w: 420, h: 800 }, vp, GAP).top, 92);
});

test('dragging a grip moves the free edge with the pointer', () => {
  const start = { w: 420, h: 720 };
  // frame left of the button: its left edge is free, dragging it left (dx < 0) widens it
  assert.deepEqual(resized(start, -100, 0, 'x', 'left', 'bottom', max), { w: 520, h: 720 });
  // frame right of the button: its right edge is free
  assert.deepEqual(resized(start, -100, 0, 'x', 'right', 'top', max), { w: MIN_SIZE.w, h: 720 }); // 320 < the minimum
  // anchored at the bottom: the top edge is free, dragging it up (dy < 0) heightens it
  assert.deepEqual(resized(start, 0, -50, 'y', 'left', 'bottom', max), { w: 420, h: 770 });
  // anchored at the top: the bottom edge is free
  assert.deepEqual(resized(start, 0, -50, 'y', 'left', 'top', max), { w: 420, h: 670 });
  // the corner moves both
  assert.deepEqual(resized(start, -30, -40, 'xy', 'left', 'bottom', max), { w: 450, h: 760 });
});

test('sizes stay between the minimum and the window', () => {
  assert.deepEqual(clampSize({ w: 10, h: 10 }, max), MIN_SIZE);
  assert.deepEqual(clampSize({ w: 5000, h: 5000 }, max), { w: 1384, h: 884 });
  assert.deepEqual(clampSize({ w: 400.6, h: 500.2 }, max), { w: 401, h: 500 });
});

test('a saved size, or the default', () => {
  assert.deepEqual(readSize('{"w":600,"h":800}'), { w: 600, h: 800 });
  assert.deepEqual(readSize(null), DEFAULT_SIZE);
  assert.deepEqual(readSize('{"w":"x"}'), DEFAULT_SIZE);
  assert.deepEqual(readSize('not json'), DEFAULT_SIZE);
});
