import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getState, initStorage, setPhotoAlbumMembership, togglePhotoInVirtualAlbum } from '../server/storage.js';

test('batch album assignment reports only changed photos so undo preserves pre-existing members', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-album-batch-'));
  try {
    const options = { dataDir: path.join(root, 'data'), photosDir: path.join(root, 'photos') };
    await initStorage(options);
    await togglePhotoInVirtualAlbum('table', 'already.jpg');

    const result = await setPhotoAlbumMembership('table', ['already.jpg', 'a.jpg', 'a.jpg', 'sub/b.jpg'], true);
    assert.deepEqual(result.changedFiles, ['a.jpg', 'sub/b.jpg']);
    assert.deepEqual(result.photos, ['already.jpg', 'a.jpg', 'sub/b.jpg']);

    await initStorage(options);
    assert.deepEqual(getState().virtualAlbums.table.photos, result.photos);
    const undo = await setPhotoAlbumMembership('table', result.changedFiles, false);
    assert.deepEqual(undo.photos, ['already.jpg']);
    assert.deepEqual((await setPhotoAlbumMembership('table', result.changedFiles, false)).changedFiles, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
