import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fs from 'fs-extra';
import * as fileManager from '../server/fileManager.js';
import {
  getState, initStorage, markPhotosViewed, saveAnnotations, saveNote, setConfig,
  setPhotoTriage, toggleFavorite, togglePhotoInVirtualAlbum,
} from '../server/storage.js';

async function makeCollection(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-move-undo-'));
  t.after(() => fs.remove(temp));
  const root = path.join(temp, 'photos');
  await fs.ensureDir(path.join(root, 'source'));
  await fs.ensureDir(path.join(root, 'target'));
  await initStorage({ dataDir: path.join(temp, 'data'), photosDir: root });
  return { root, temp };
}

test('undo restores original paths and current photo metadata after a suffixed move', async t => {
  const { root } = await makeCollection(t);
  await fs.writeFile(path.join(root, 'source/photo.jpg'), 'original photo');
  await fs.writeFile(path.join(root, 'target/photo.jpg'), 'existing photo');
  await markPhotosViewed(['source/photo.jpg']);
  await toggleFavorite('source/photo.jpg', true);
  await setPhotoTriage('source/photo.jpg', 'pick');
  await saveAnnotations('source/photo.jpg', [{ id: 'annotation' }]);
  await togglePhotoInVirtualAlbum('table', 'source/photo.jpg');

  const moved = await fileManager.movePhotos(root, ['source/photo.jpg', 'missing.jpg'], 'target');
  assert.equal(moved.movedCount, 1);
  assert.equal(moved.results[0].newPath, 'target/photo_1.jpg');
  assert.equal(moved.results[1].success, false);
  assert.equal(typeof moved.undoToken, 'string');
  await saveNote('target/photo_1.jpg', 'edited after move');

  const undone = await fileManager.undoPhotoMove(root, moved.undoToken);
  assert.equal(undone.movedCount, 1);
  assert.equal(undone.remainingCount, 0);
  assert.equal(await fs.readFile(path.join(root, 'source/photo.jpg'), 'utf8'), 'original photo');
  assert.equal(await fs.readFile(path.join(root, 'target/photo.jpg'), 'utf8'), 'existing photo');
  assert.equal(await fs.pathExists(path.join(root, 'target/photo_1.jpg')), false);
  const state = getState();
  assert.ok(state.viewed['source/photo.jpg']);
  assert.equal(state.favorites['source/photo.jpg'], true);
  assert.equal(state.triage['source/photo.jpg'], 'pick');
  assert.deepEqual(state.annotations['source/photo.jpg'], [{ id: 'annotation' }]);
  assert.equal(state.notes['source/photo.jpg'], 'edited after move');
  assert.deepEqual(state.virtualAlbums.table.photos, ['source/photo.jpg']);
  assert.equal(state.notes['target/photo_1.jpg'], undefined);
  assert.equal(await fileManager.undoPhotoMove(root, moved.undoToken), null);
});

test('undo leaves an occupied original path intact and retries only blocked entries', async t => {
  const { root } = await makeCollection(t);
  await fs.writeFile(path.join(root, 'source/a.jpg'), 'a');
  await fs.writeFile(path.join(root, 'source/b.jpg'), 'b');
  const { undoToken } = await fileManager.movePhotos(root, ['source/a.jpg', 'source/b.jpg'], 'target');
  assert.equal(typeof undoToken, 'string');
  await fs.writeFile(path.join(root, 'source/a.jpg'), 'other photo');

  const first = await fileManager.undoPhotoMove(root, undoToken);
  assert.equal(first.movedCount, 1);
  assert.equal(first.remainingCount, 1);
  assert.equal(first.results.find(r => r.newPath === 'source/a.jpg').success, false);
  assert.equal(await fs.readFile(path.join(root, 'source/a.jpg'), 'utf8'), 'other photo');
  assert.equal(await fs.readFile(path.join(root, 'target/a.jpg'), 'utf8'), 'a');
  assert.equal(await fs.readFile(path.join(root, 'source/b.jpg'), 'utf8'), 'b');

  await fs.unlink(path.join(root, 'source/a.jpg'));
  const second = await fileManager.undoPhotoMove(root, undoToken);
  assert.equal(second.movedCount, 1);
  assert.equal(second.remainingCount, 0);
  assert.equal(second.results.length, 1);
  assert.equal(await fs.readFile(path.join(root, 'source/a.jpg'), 'utf8'), 'a');
});

test('undo rejects moved photos that were replaced or edited', async t => {
  const { root } = await makeCollection(t);
  await fs.writeFile(path.join(root, 'source/a.jpg'), 'original a');
  await fs.writeFile(path.join(root, 'source/b.jpg'), 'original b');
  const { undoToken } = await fileManager.movePhotos(root, ['source/a.jpg', 'source/b.jpg'], 'target');
  assert.equal(typeof undoToken, 'string');
  await fs.unlink(path.join(root, 'target/a.jpg'));
  await fs.writeFile(path.join(root, 'target/a.jpg'), 'other file');
  await fs.writeFile(path.join(root, 'target/b.jpg'), 'edited now');

  const undone = await fileManager.undoPhotoMove(root, undoToken);
  assert.equal(undone.movedCount, 0);
  assert.equal(undone.remainingCount, 0);
  assert.equal(undone.results.every(r => !r.success && r.error), true);
  assert.deepEqual(await fs.readdir(path.join(root, 'source')), []);
  assert.equal(await fs.readFile(path.join(root, 'target/a.jpg'), 'utf8'), 'other file');
  assert.equal(await fs.readFile(path.join(root, 'target/b.jpg'), 'utf8'), 'edited now');
});

test('undo is collection scoped and concurrent uses restore a photo once', async t => {
  const { root, temp } = await makeCollection(t);
  await fs.writeFile(path.join(root, 'source/a.jpg'), 'original a');
  const { undoToken } = await fileManager.movePhotos(root, ['source/a.jpg'], 'target');
  assert.equal(typeof undoToken, 'string');
  const secondRoot = path.join(temp, 'other-photos');
  await fs.ensureDir(path.join(secondRoot, 'target'));
  await fs.writeFile(path.join(secondRoot, 'target/a.jpg'), 'unrelated');
  await setConfig({ photosDir: secondRoot });
  assert.equal(await fileManager.undoPhotoMove(secondRoot, undoToken), null);
  assert.equal(await fs.readFile(path.join(secondRoot, 'target/a.jpg'), 'utf8'), 'unrelated');
  await setConfig({ photosDir: root });

  const responses = await Promise.all([
    fileManager.undoPhotoMove(root, undoToken), fileManager.undoPhotoMove(root, undoToken),
  ]);
  assert.equal(responses.filter(r => r?.movedCount === 1).length, 1);
  assert.equal(responses.filter(r => r === null).length, 1);
  assert.equal(await fs.readFile(path.join(root, 'source/a.jpg'), 'utf8'), 'original a');
});

test('undo refuses to restore through a redirected original folder', async t => {
  const { root } = await makeCollection(t);
  await fs.writeFile(path.join(root, 'source/a.jpg'), 'original a');
  const { undoToken } = await fileManager.movePhotos(root, ['source/a.jpg'], 'target');
  assert.equal(typeof undoToken, 'string');
  await fs.rmdir(path.join(root, 'source'));
  await fs.ensureDir(path.join(root, 'unrelated'));
  await fs.symlink(path.join(root, 'unrelated'), path.join(root, 'source'), 'junction');

  const undone = await fileManager.undoPhotoMove(root, undoToken);
  assert.equal(undone.movedCount, 0);
  assert.deepEqual(await fs.readdir(path.join(root, 'unrelated')), []);
  assert.equal(await fs.readFile(path.join(root, 'target/a.jpg'), 'utf8'), 'original a');
});

test('undo preserves a new file that replaces its cross-device copy before commit', async t => {
  const { root } = await makeCollection(t);
  const originalFile = path.join(root, 'source/a.jpg');
  const movedFile = path.join(root, 'target/a.jpg');
  await fs.writeFile(originalFile, 'original a');
  // The test sandbox is on a single volume. Exercise the actual exclusive
  // copying code by simulating the error from a cross-device hard link.
  t.mock.method(fs, 'linkSync', () => {
    throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
  });
  const { undoToken } = await fileManager.movePhotos(root, ['source/a.jpg'], 'target');
  assert.equal(typeof undoToken, 'string');

  const open = fs.promises.open;
  const openMock = t.mock.method(fs.promises, 'open', async (file, flags, ...args) => {
    const handle = await open(file, flags, ...args);
    if (file === originalFile && flags === 'wx') {
      await fs.unlink(originalFile);
      await fs.writeFile(originalFile, 'unrelated photo');
    }
    return handle;
  });

  const first = await fileManager.undoPhotoMove(root, undoToken);
  assert.equal(first.movedCount, 0);
  assert.equal(first.remainingCount, 1);
  assert.equal(await fs.readFile(originalFile, 'utf8'), 'unrelated photo');
  assert.equal(await fs.readFile(movedFile, 'utf8'), 'original a');

  openMock.mock.restore();
  await fs.unlink(originalFile);
  const second = await fileManager.undoPhotoMove(root, undoToken);
  assert.equal(second.movedCount, 1);
  assert.equal(await fs.readFile(originalFile, 'utf8'), 'original a');
  assert.equal(await fs.pathExists(movedFile), false);
});

test('grouped moves create each folder and share one undo token', async t => {
  const { root } = await makeCollection(t);
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) await fs.writeFile(path.join(root, 'source', name), name);

  const moved = await fileManager.movePhotoGroups(root, [
    { files: ['source/a.jpg', 'source/b.jpg'], targetFolder: 'Anh_Cong' },
    { files: ['source/c.jpg'], targetFolder: 'Album' },
  ]);
  assert.equal(moved.movedCount, 3);
  assert.equal(await fs.readFile(path.join(root, 'Anh_Cong/b.jpg'), 'utf8'), 'b.jpg');
  assert.equal(await fs.readFile(path.join(root, 'Album/c.jpg'), 'utf8'), 'c.jpg');

  const undone = await fileManager.undoPhotoMove(root, moved.undoToken);
  assert.equal(undone.movedCount, 3);
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) assert.ok(await fs.pathExists(path.join(root, 'source', name)));
});

test('grouped moves reject an unsafe destination before moving anything', async t => {
  const { root } = await makeCollection(t);
  await fs.writeFile(path.join(root, 'source/a.jpg'), 'a');
  await assert.rejects(fileManager.movePhotoGroups(root, [
    { files: ['source/a.jpg'], targetFolder: 'ok' },
    { files: ['source/a.jpg'], targetFolder: '../outside' },
  ]));
  assert.ok(await fs.pathExists(path.join(root, 'source/a.jpg')));
});
