import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import fs from 'fs-extra';
import sharp from 'sharp';

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-thumbs-'));
process.env.CURATOR_CACHE_DIR = path.join(sandbox, 'cache');
const svc = await import('../server/thumbnailService.js');

const photos = path.join(sandbox, 'photos');
const makePhoto = async (name, width = 3200, height = 2000) => {
  const file = path.join(photos, name);
  await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } }).jpeg().toFile(file);
  return file;
};
const cacheFiles = async kind => (await fs.readdir(path.join(sandbox, 'cache', kind))).sort();

before(async () => {
  await fs.ensureDir(photos);
  await svc.initThumbnailCache();
});
after(() => fs.remove(sandbox));

test('a moved photo reuses its cached thumbnail', async () => {
  const file = await makePhoto('move.jpg');
  const first = await svc.getThumbnail(file);
  await fs.ensureDir(path.join(photos, 'Album'));
  const moved = path.join(photos, 'Album', 'move.jpg');
  await fs.rename(file, moved);
  assert.equal(await svc.getThumbnail(moved), first);
});

test('the same photo requested many times at once is rendered once, without temp files left', async () => {
  const file = await makePhoto('burst.jpg');
  const before = (await cacheFiles('thumbnails')).length;
  const results = await Promise.all(Array.from({ length: 6 }, () => svc.getThumbnail(file)));
  assert.equal(new Set(results).size, 1);
  const after = await cacheFiles('thumbnails');
  assert.equal(after.length, before + 1);
  assert.equal(after.some(name => name.endsWith('.tmp')), false);
  const meta = await sharp(results[0]).metadata();
  assert.ok(Math.max(meta.width, meta.height) <= 480);
});

test('previews are screen sized and never enlarged', async () => {
  const big = await svc.getPreview(await makePhoto('big.jpg', 6000, 4000));
  const bigMeta = await sharp(big).metadata();
  assert.equal(Math.max(bigMeta.width, bigMeta.height), 2560);
  const small = await svc.getPreview(await makePhoto('small.jpg', 800, 600));
  assert.equal((await sharp(small).metadata()).width, 800);
});

test('warm-up renders a folder in the background and a newer folder replaces it', async () => {
  const files = [];
  for (let i = 0; i < 6; i++) files.push(await makePhoto(`warm_${i}.jpg`, 1200, 800));
  const queued = await svc.warmThumbnails(files);
  assert.equal(queued, 6);
  await svc.waitForThumbnailQueue();
  // Everything is cached now, so a second warm-up has nothing to do.
  assert.equal(await svc.warmThumbnails(files), 0);
});

test('a preview that is not ready yet is scheduled instead of awaited', async () => {
  const file = await makePhoto('ready.jpg', 4000, 3000);
  assert.equal(await svc.getReadyPreview(file), null);
  await svc.waitForThumbnailQueue();
  const ready = await svc.getReadyPreview(file);
  assert.ok(ready.endsWith('.jpg'));
  assert.equal((await sharp(ready).metadata()).width, 2560);
});
