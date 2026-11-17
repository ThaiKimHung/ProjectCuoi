import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import fs from 'fs-extra';
import sharp from 'sharp';

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-exif-'));
process.env.CURATOR_CACHE_DIR = path.join(sandbox, 'cache');
const { getPhotosInFolder } = await import('../server/fileManager.js');
const { initStorage } = await import('../server/storage.js');
after(() => fs.remove(sandbox));

const cacheFile = path.join(sandbox, 'cache', 'exif-cache.json');
const waitForCache = async () => {
  for (let i = 0; i < 100 && !(await fs.pathExists(cacheFile)); i++) await new Promise(r => setTimeout(r, 50));
  return fs.readJson(cacheFile);
};

test('EXIF results are saved to disk and survive a photo move', async () => {
  const photos = path.join(sandbox, 'photos');
  await fs.ensureDir(path.join(photos, 'Album'));
  await initStorage({ dataDir: path.join(sandbox, 'data'), photosDir: photos });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toFile(path.join(photos, 'a.jpg'));

  await getPhotosInFolder(photos, '');
  const saved = await waitForCache();
  assert.equal(Object.keys(saved).length, 1);

  await fs.rename(path.join(photos, 'a.jpg'), path.join(photos, 'Album', 'a.jpg'));
  await fs.remove(cacheFile);
  const result = await getPhotosInFolder(photos, 'Album');
  assert.equal(result.photos.length, 1);
  // Same file identity → cache hit, so nothing new needs saving.
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(await fs.pathExists(cacheFile), false);
});
