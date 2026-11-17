import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as storage from '../server/storage.js';

test('clearing viewed state persists for one collection and keeps its other photo metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-reset-viewed-'));
  try {
    const dataDir = path.join(root, 'data');
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await storage.initStorage({ dataDir, photosDir: first });
    await storage.markPhotosViewed(['one.jpg', 'nested/two.jpg']);
    await storage.setPhotoTriage(['one.jpg'], 'pick');
    await storage.toggleFavorite('one.jpg', true);
    await storage.saveNote('one.jpg', 'retouch note');
    await storage.togglePhotoInVirtualAlbum('album', 'one.jpg');
    await storage.saveSession({ reviewCheckpoint: { photoPath: 'one.jpg' } });
    const firstId = storage.getState().collectionId;

    await storage.initStorage({ dataDir, photosDir: second });
    await storage.markPhotosViewed(['one.jpg']);
    await assert.rejects(() => storage.resetCollectionViewed(firstId), { status: 409 });
    assert.equal(Object.keys(storage.getState().viewed).length, 1);

    await storage.initStorage({ dataDir, photosDir: first });
    assert.deepEqual(await storage.resetCollectionViewed(firstId), { count: 2 });
    assert.deepEqual(await storage.resetCollectionViewed(firstId), { count: 0 });
    await storage.initStorage({ dataDir, photosDir: first });
    const current = storage.getState();
    assert.deepEqual(current.viewed, {});
    assert.equal(current.triage['one.jpg'], 'pick');
    assert.equal(current.favorites['one.jpg'], true);
    assert.equal(current.notes['one.jpg'], 'retouch note');
    assert.deepEqual(current.virtualAlbums.album.photos, ['one.jpg']);
    assert.equal(current.session.reviewCheckpoint.photoPath, 'one.jpg');

    await storage.initStorage({ dataDir, photosDir: second });
    assert.equal(Object.keys(storage.getState().viewed).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
