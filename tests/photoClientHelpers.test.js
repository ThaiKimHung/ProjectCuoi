import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoImageUrl } from '../client/src/api.js';
import { countPhotoStats } from '../client/src/photoStats.js';

test('image URLs change when the photo file changes, so the browser cache cannot serve an old version', () => {
  const before = photoImageUrl('thumbnail', { relPath: 'Lễ cưới/IMG 01.jpg', mtime: 1700000000000.25 });
  const after = photoImageUrl('thumbnail', { relPath: 'Lễ cưới/IMG 01.jpg', mtime: 1700000099000.5 });
  assert.notEqual(before, after);
  const url = new URL(before, 'http://local');
  assert.equal(url.pathname, '/api/thumbnail');
  assert.equal(url.searchParams.get('path'), 'Lễ cưới/IMG 01.jpg');
  assert.equal(new URL(photoImageUrl('original', { relPath: 'a.jpg' }), 'http://local').pathname, '/api/original');
});

test('folder counters computed in the browser match the server definitions', () => {
  const stats = countPhotoStats([
    { isViewed: true, isFavorite: true, triage: 'pick', albums: [] },
    { isViewed: true, triage: 'pick', albums: ['album'] },
    { isViewed: false, triage: 'maybe', note: '  ' },
    { isViewed: true, triage: 'reject', note: 'làm mịn da' },
    { isViewed: false, annotations: [{ id: 1 }], burstTotal: 2 },
    { isViewed: false, burstTotal: 2 },
  ]);
  assert.deepEqual(stats, {
    totalCount: 6,
    viewedCount: 3,
    favoriteCount: 1,
    pickedCount: 2,
    maybeCount: 1,
    rejectedCount: 1,
    unassignedPickCount: 1,
    notedCount: 2,
    burstCount: 2,
  });
});
