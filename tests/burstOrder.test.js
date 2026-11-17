import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fs from 'fs-extra';

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-burst-order-'));
process.env.CURATOR_CACHE_DIR = path.join(sandbox, 'cache');
const { getPhotosInFolder } = await import('../server/fileManager.js');
const { initStorage } = await import('../server/storage.js');

test('the root view keeps a burst together when a subfolder sorts between its shots', async t => {
  t.after(() => fs.remove(sandbox));
  const photos = path.join(sandbox, 'photos');
  // "IMG_0001_edits" sorts between IMG_0001.jpg and IMG_0002.jpg.
  for (const file of ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0001_edits/other.jpg']) {
    await fs.outputFile(path.join(photos, file), 'not a real jpeg');
  }
  await initStorage({ dataDir: path.join(sandbox, 'data'), photosDir: photos });

  const { photos: listed } = await getPhotosInFolder(photos, '', 'all', 'name-asc');
  const byPath = Object.fromEntries(listed.map(photo => [photo.relPath, photo]));
  assert.ok(byPath['IMG_0001.jpg'].burstId);
  assert.equal(byPath['IMG_0002.jpg'].burstId, byPath['IMG_0001.jpg'].burstId);
  assert.deepEqual(byPath['IMG_0001.jpg'].burstPhotos, ['IMG_0001.jpg', 'IMG_0002.jpg']);
  assert.equal(byPath['IMG_0001_edits/other.jpg'].burstId, undefined);
});
