import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectBurstGroups, packPhotoBursts } from '../server/fileManager.js';

test('the compact response sends one complete path list per burst, including filtered-out photos', () => {
  const [first, second, third, single] = detectBurstGroups([
    { name: 'IMG_001.jpg', relPath: 'IMG_001.jpg' },
    { name: 'IMG_002.jpg', relPath: 'IMG_002.jpg' },
    { name: 'IMG_003.jpg', relPath: 'IMG_003.jpg' },
    { name: 'single.jpg', relPath: 'single.jpg' },
  ]);
  const packed = packPhotoBursts({ photos: [first, third, single], totalCount: 4 });
  assert.equal(packed.totalCount, 4);
  assert.deepEqual(Object.keys(packed.burstGroups), [first.burstId]);
  assert.deepEqual(packed.burstGroups[first.burstId], [first.relPath, second.relPath, third.relPath]);
  assert.deepEqual(packed.photos.map(photo => photo.burstIndex), [1, 3, undefined]);
  assert.ok(packed.photos.every(photo => !Object.hasOwn(photo, 'burstPhotos')));
  assert.deepEqual(first.burstPhotos, packed.burstGroups[first.burstId]);
});
