import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  getState, initStorage, removeMetadataOnFolderDelete, saveSession,
  saveNote, setPhotoTriage, toggleFavorite, togglePhotoInVirtualAlbum,
  updateMetadataOnFolderRename, updateMetadataOnMove,
} from '../server/storage.js';

test('a saved review checkpoint follows an image move, undo, folder rename, and deletion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-review-test-'));
  try {
    const options = { dataDir: path.join(root, 'data'), photosDir: path.join(root, 'photos') };
    await initStorage(options);
    await saveSession({
      activeFolder: 'original',
      activeFilter: 'pick',
      lastActivePhoto: null,
      reviewCheckpoint: {
        photoPath: 'original/a.jpg', folder: 'original', filter: 'pick', sort: 'name-desc',
        searchQuery: 'a', scrollTop: 700, anchorPath: 'original/b.jpg', anchorOffset: -20, photoIndex: 4,
      },
    });

    await initStorage(options);
    assert.equal(getState().session.reviewCheckpoint.photoPath, 'original/a.jpg');
    assert.equal(getState().session.reviewCheckpoint.scrollTop, 700);

    await updateMetadataOnMove('original/a.jpg', 'other/a_1.jpg');
    assert.deepEqual(getState().session.reviewCheckpoint, {
      photoPath: 'other/a_1.jpg', folder: 'other', filter: 'pick', sort: 'name-desc',
      searchQuery: 'a', scrollTop: 0, anchorPath: null, anchorOffset: 0, photoIndex: 0,
    });
    await updateMetadataOnMove('other/a_1.jpg', 'original/a.jpg');

    await updateMetadataOnFolderRename('original', 'renamed');
    assert.equal(getState().session.activeFolder, 'renamed');
    assert.equal(getState().session.reviewCheckpoint.folder, 'renamed');
    assert.equal(getState().session.reviewCheckpoint.photoPath, 'renamed/a.jpg');

    await removeMetadataOnFolderDelete('renamed');
    assert.equal(getState().session.activeFolder, '');
    assert.equal(getState().session.reviewCheckpoint, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an older session request cannot replace a newer review checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-review-version-'));
  try {
    await initStorage({ dataDir: path.join(root, 'data'), photosDir: path.join(root, 'photos') });
    await saveSession({ clientUpdatedAt: 200, reviewCheckpoint: { photoPath: 'newer.jpg' } });
    await saveSession({ clientUpdatedAt: 100, reviewCheckpoint: { photoPath: 'older.jpg' } });
    assert.equal(getState().session.reviewCheckpoint.photoPath, 'newer.jpg');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moving an untagged photo clears metadata left by a deleted destination photo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-review-move-'));
  try {
    await initStorage({ dataDir: path.join(root, 'data'), photosDir: path.join(root, 'photos') });
    await toggleFavorite('target/a.jpg', true);
    await saveNote('target/a.jpg', 'old photo note');
    await setPhotoTriage(['target/a.jpg'], 'pick');
    await togglePhotoInVirtualAlbum('table', 'target/a.jpg');
    await updateMetadataOnMove('source/a.jpg', 'target/a.jpg');
    const state = getState();
    assert.equal(state.favorites['target/a.jpg'], undefined);
    assert.equal(state.notes['target/a.jpg'], undefined);
    assert.equal(state.triage['target/a.jpg'], undefined);
    assert.equal(state.viewed['target/a.jpg'], undefined);
    assert.deepEqual(state.virtualAlbums.table.photos, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
