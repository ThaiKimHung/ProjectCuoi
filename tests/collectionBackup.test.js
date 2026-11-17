import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as storage from '../server/storage.js';

const matchingPhoto = 'Đám cưới/a.jpg';
const missingPhoto = 'missing.jpg';
const note = 'Giữ ảnh này';
const annotation = { id: 'anno_1', number: 1, x: 14, y: 25, radius: 4, text: 'Sửa váy' };
const checkpoint = {
  photoPath: matchingPhoto,
  folder: 'Đám cưới',
  filter: 'album:extras',
  sort: 'name-desc',
  searchQuery: 'a',
  photoIndex: 2,
  scrollTop: 440,
  anchorPath: missingPhoto,
  anchorOffset: -10,
};

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  const dataDir = path.join(root, 'data');
  for (const dir of [source, target]) {
    await mkdir(path.join(dir, 'Đám cưới'), { recursive: true });
    await writeFile(path.join(dir, matchingPhoto), 'photo contents');
  }
  await writeFile(path.join(source, missingPhoto), 'missing in target');
  await writeFile(path.join(source, 'link.jpg'), 'symlink in target');
  await symlink(path.join(source, 'link.jpg'), path.join(target, 'link.jpg'));

  await storage.initStorage({ dataDir, photosDir: source });
  await storage.setConfig({ photosDir: target });
  await storage.saveNote('other-collection.jpg', 'other collection only');
  await storage.setConfig({ photosDir: source });
  await storage.markPhotosViewed([matchingPhoto]);
  await storage.toggleFavorite(matchingPhoto, true);
  await storage.setPhotoTriage(matchingPhoto, 'pick');
  await storage.saveNote(matchingPhoto, note);
  await storage.saveNote(missingPhoto, 'missing note');
  await storage.saveNote('link.jpg', 'source symlink name');
  await storage.saveNote(path.join(root, 'absolute.jpg'), 'invalid path');
  await storage.saveAnnotations(matchingPhoto, [annotation]);
  await storage.updateAlbumQuota('album', 42);
  await storage.createVirtualAlbum('extras', 'Ảnh thêm', 6);
  await storage.togglePhotoInVirtualAlbum('extras', matchingPhoto);
  await storage.togglePhotoInVirtualAlbum('extras', missingPhoto);
  await storage.saveSession({ reviewCheckpoint: checkpoint, clientUpdatedAt: 10, lastActivePhoto: matchingPhoto });
  return { dataDir, source, target };
}

test('export includes only active collection review metadata and safe relative paths', async t => {
  const { source } = await setup(t);
  assert.equal(typeof storage.exportCollectionBackup, 'function');
  const backup = storage.exportCollectionBackup(storage.getCollectionId(source));

  assert.equal(backup.format, 'wedding-photo-curator/collection-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.photos[matchingPhoto].viewed, storage.getState().viewed[matchingPhoto]);
  assert.deepEqual(backup.photos[matchingPhoto], {
    viewed: storage.getState().viewed[matchingPhoto],
    favorites: true, notes: note, annotations: [annotation], triage: 'pick',
  });
  assert.deepEqual(backup.albums.find(album => album.id === 'extras'), {
    id: 'extras', name: 'Ảnh thêm', quota: 6, photos: [matchingPhoto, missingPhoto],
  });
  assert.deepEqual(backup.reviewCheckpoint, checkpoint);
  const portable = JSON.stringify(backup);
  assert.ok(!portable.includes(source));
  assert.ok(!portable.includes('other collection only'));
  assert.ok(!portable.includes('invalid path'));
  assert.ok(!portable.includes('photo contents'));
});

test('restore matches real photos, fills fresh quotas and checkpoint, and is durable', async t => {
  const { source, target, dataDir } = await setup(t);
  assert.equal(typeof storage.previewCollectionRestore, 'function');
  const backup = storage.exportCollectionBackup(storage.getCollectionId(source));
  await storage.setConfig({ photosDir: target });
  await storage.saveNote('other-collection.jpg', '');
  const collectionId = storage.getCollectionId(target);
  const { summary, previewToken } = await storage.previewCollectionRestore(backup, collectionId);
  assert.equal(summary.matchedPhotos, 1);
  assert.equal(summary.skippedPhotos, 2);
  assert.deepEqual(summary.skippedPaths, ['link.jpg', missingPhoto]);
  assert.equal(summary.checkpoint, 'restored');
  assert.equal(storage.getState().notes[matchingPhoto], undefined);

  const result = await storage.restoreCollectionBackup(backup, collectionId, previewToken);
  assert.equal(result.success, true);
  assert.deepEqual(result.session.reviewCheckpoint, { ...checkpoint, anchorPath: null, anchorOffset: 0 });
  assert.equal(result.session.lastActivePhoto, null);

  await storage.initStorage({ dataDir, photosDir: target });
  const current = storage.getState();
  assert.equal(current.notes[matchingPhoto], note);
  assert.equal(current.notes[missingPhoto], undefined);
  assert.equal(current.notes['link.jpg'], undefined);
  assert.equal(current.favorites[matchingPhoto], true);
  assert.equal(current.triage[matchingPhoto], 'pick');
  assert.deepEqual(current.annotations[matchingPhoto], [annotation]);
  assert.equal(current.virtualAlbums.album.quota, 42);
  assert.equal(current.virtualAlbums.extras.quota, 6);
  assert.deepEqual(current.virtualAlbums.extras.photos, [matchingPhoto]);
  assert.deepEqual(current.session.reviewCheckpoint, result.session.reviewCheckpoint);
  assert.equal(await readFile(path.join(target, matchingPhoto), 'utf8'), 'photo contents');

  const repeated = await storage.previewCollectionRestore(backup, collectionId);
  assert.equal(repeated.summary.changes, 0);
});

test('restore keeps existing conflicting fields and resolves custom album identities', async t => {
  const { source, target } = await setup(t);
  assert.equal(typeof storage.restoreCollectionBackup, 'function');
  const sourceId = storage.getCollectionId(source);
  await storage.createVirtualAlbum('other', 'Ảnh mở rộng', 8);
  await storage.togglePhotoInVirtualAlbum('other', matchingPhoto);
  const backup = storage.exportCollectionBackup(sourceId);
  const targetId = storage.getCollectionId(target);
  await storage.setConfig({ photosDir: target });
  await storage.saveNote(matchingPhoto, 'ghi chú hiện tại');
  await storage.setPhotoTriage(matchingPhoto, 'reject');
  await storage.updateAlbumQuota('album', 38);
  await storage.createVirtualAlbum('keep', 'ẢNH THÊM', 12);
  await storage.createVirtualAlbum('other', 'Album hiện tại', 3);
  await storage.saveSession({ reviewCheckpoint: { ...checkpoint, filter: 'all' }, clientUpdatedAt: 100 });

  const { summary, previewToken } = await storage.previewCollectionRestore(backup, targetId);
  assert.equal(summary.conflictingPhotos, 1);
  assert.equal(summary.checkpoint, 'kept');
  assert.ok(summary.albumConflicts.some(album => album.kind === 'sameName' && album.targetName === 'ẢNH THÊM'));
  assert.ok(summary.albumConflicts.some(album => album.kind === 'sameId' && album.targetName === 'Ảnh mở rộng'));
  await storage.restoreCollectionBackup(backup, targetId, previewToken);

  const current = storage.getState();
  assert.equal(current.notes[matchingPhoto], 'ghi chú hiện tại');
  assert.equal(current.triage[matchingPhoto], 'reject');
  assert.equal(current.favorites[matchingPhoto], true);
  assert.equal(current.virtualAlbums.album.quota, 38);
  assert.equal(current.virtualAlbums.keep.quota, 12);
  assert.deepEqual(current.virtualAlbums.keep.photos, [matchingPhoto]);
  assert.equal(current.virtualAlbums.extras, undefined);
  assert.equal(current.virtualAlbums.other.name, 'Album hiện tại');
  assert.deepEqual(current.virtualAlbums.other_restored.photos, [matchingPhoto]);
  assert.equal(current.session.reviewCheckpoint.filter, 'all');
});

test('malformed backups, traversal and prototype keys fail before preview', async t => {
  const { source } = await setup(t);
  assert.equal(typeof storage.previewCollectionRestore, 'function');
  const collectionId = storage.getCollectionId(source);
  const backup = storage.exportCollectionBackup(collectionId);
  const malformed = [
    { ...backup, version: 999 },
    { ...backup, photos: { '../outside.jpg': { notes: 'traversal' } } },
    { ...backup, photos: { 'C:/outside.jpg': { notes: 'absolute' } } },
    { ...backup, photos: { 'C:outside.jpg': { notes: 'drive-relative' } } },
    { ...backup, photos: JSON.parse('{"__proto__":{"notes":"polluted"}}') },
    { ...backup, photos: { [matchingPhoto]: { annotations: [{ ...annotation, constructor: {} }] } } },
    { ...backup, albums: [{ id: 'constructor', name: 'Custom', quota: 2, photos: [] }] },
    { ...backup, reviewCheckpoint: { ...checkpoint, anchorPath: '/outside.jpg' } },
    { ...backup, photos: { [matchingPhoto]: { annotations: [{ ...annotation, x: 'unsafe' }] } } },
    { ...backup, photos: { [matchingPhoto]: { favorites: 'true' } } },
  ];

  for (const value of malformed) {
    await assert.rejects(storage.previewCollectionRestore(value, collectionId), { status: 400 });
  }
  assert.equal(({}).polluted, undefined);
  assert.equal(storage.getState().notes[matchingPhoto], note);
});

test('restore requires a current preview for the same collection and file matches', async t => {
  const { source, target } = await setup(t);
  assert.equal(typeof storage.restoreCollectionBackup, 'function');
  const sourceId = storage.getCollectionId(source);
  const targetId = storage.getCollectionId(target);
  const backup = storage.exportCollectionBackup(sourceId);
  await storage.setConfig({ photosDir: target });
  const first = await storage.previewCollectionRestore(backup, targetId);
  await storage.setConfig({ photosDir: source });
  await assert.rejects(storage.restoreCollectionBackup(backup, targetId, first.previewToken), { status: 409 });
  await storage.setConfig({ photosDir: target });
  await assert.rejects(storage.restoreCollectionBackup(backup, targetId, first.previewToken), { status: 409 });

  const second = await storage.previewCollectionRestore(backup, targetId);
  await rename(path.join(target, matchingPhoto), path.join(target, 'new.jpg'));
  await assert.rejects(storage.restoreCollectionBackup(backup, targetId, second.previewToken), { status: 409 });
  assert.equal(storage.getState().notes[matchingPhoto], undefined);
});

test('restore requires a new preview if the current checkpoint photo disappeared', async t => {
  const { source, target } = await setup(t);
  const backup = storage.exportCollectionBackup(storage.getCollectionId(source));
  const collectionId = storage.getCollectionId(target);
  await storage.setConfig({ photosDir: target });
  await writeFile(path.join(target, 'current-review.jpg'), 'review');
  await storage.saveSession({ reviewCheckpoint: { photoPath: 'current-review.jpg' } });
  const { summary, previewToken } = await storage.previewCollectionRestore(backup, collectionId);
  assert.equal(summary.checkpoint, 'kept');
  await rm(path.join(target, 'current-review.jpg'));
  await assert.rejects(storage.restoreCollectionBackup(backup, collectionId, previewToken), { status: 409 });
});

test('a failed restore write leaves memory unchanged and can be retried', async t => {
  const { source, target, dataDir } = await setup(t);
  assert.equal(typeof storage.restoreCollectionBackup, 'function');
  const backup = storage.exportCollectionBackup(storage.getCollectionId(source));
  await storage.setConfig({ photosDir: target });
  const collectionId = storage.getCollectionId(target);
  const { previewToken } = await storage.previewCollectionRestore(backup, collectionId);

  const relocated = dataDir + '-temporary';
  await rename(dataDir, relocated);
  try {
    await assert.rejects(storage.restoreCollectionBackup(backup, collectionId, previewToken), { code: 'ENOENT' });
    assert.equal(storage.getState().notes[matchingPhoto], undefined);
    assert.equal(storage.getState().virtualAlbums.extras, undefined);
  } finally {
    await rename(relocated, dataDir);
  }

  await storage.restoreCollectionBackup(backup, collectionId, previewToken);
  assert.equal(storage.getState().notes[matchingPhoto], note);
});
