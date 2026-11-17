import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

async function makeCollection(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wedding-duplicate-scan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function makePhoto(file, { width = 96, quality = 92, alternate = false } = {}) {
  const height = width * 3 / 4;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = x / width;
      const top = y / height;
      const light = alternate
        ? 115 + 48 * Math.sin(left * 12 + top * 5) + 49 * Math.cos(left * 15 - top * 8)
        : 115 + 54 * Math.sin(left * 7 + top * 12) + 43 * Math.cos(left * 4 - top * 8);
      const offset = (y * width + x) * 3;
      pixels[offset] = light + 18;
      pixels[offset + 1] = light;
      pixels[offset + 2] = light - 18;
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toFile(file);
}

const pathsInGroups = (groups) => groups.map(group => group.map(photo => photo.relPath));

test('scans across folders and separates exact copies from recompressed or resized images', async (t) => {
  const root = await makeCollection(t);
  await mkdir(path.join(root, 'Album'));
  await makePhoto(path.join(root, '001.jpg'));
  await copyFile(path.join(root, '001.jpg'), path.join(root, 'Album', 'copy.jpg'));
  await makePhoto(path.join(root, 'Album', 'resize.jpg'), { width: 64, quality: 68 });
  await makePhoto(path.join(root, 'unrelated.jpg'), { alternate: true });

  const { scanDuplicatePhotos } = await import('../server/duplicateScan.js');
  const result = await scanDuplicatePhotos(root);
  assert.equal(result.scannedCount, 4);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(pathsInGroups(result.exactGroups), [['001.jpg', 'Album/copy.jpg']]);
  assert.deepEqual(pathsInGroups(result.similarGroups), [['001.jpg', 'Album/resize.jpg']]);
  assert.equal(result.exactGroups[0][1].name, 'copy.jpg');
  assert.equal(result.exactGroups[0][1].folder, 'Album');
});

test('ignores symlinks and recognized studio packages while scanning ordinary folders', async (t) => {
  const root = await makeCollection(t);
  const external = await makeCollection(t);
  await makePhoto(path.join(root, '001.jpg'));
  await symlink('001.jpg', path.join(root, 'linked.jpg'));
  await copyFile(path.join(root, '001.jpg'), path.join(external, 'outside.jpg'));
  await symlink(external, path.join(root, 'linked-directory'));
  await mkdir(path.join(root, 'Package'));
  await copyFile(path.join(root, '001.jpg'), path.join(root, 'Package', 'exported.jpg'));
  await writeFile(path.join(root, 'Package', '.export_manifest.json'), JSON.stringify({
    version: 2,
    categories: ['Album'],
    files: { 'exported.jpg': 'identity' },
    exportedAt: '2026-01-01T00:00:00Z',
  }));
  await mkdir(path.join(root, 'Xuat_Anh_Cuoi_2026-01-01'));
  await copyFile(path.join(root, '001.jpg'), path.join(root, 'Xuat_Anh_Cuoi_2026-01-01', 'original.jpg'));

  const { scanDuplicatePhotos } = await import('../server/duplicateScan.js');
  const result = await scanDuplicatePhotos(root);
  assert.equal(result.scannedCount, 2);
  assert.equal(result.skippedCount, 2);
  assert.deepEqual(pathsInGroups(result.exactGroups), [['001.jpg', 'Xuat_Anh_Cuoi_2026-01-01/original.jpg']]);
  assert.deepEqual(result.similarGroups, []);
});

test('keeps differently arranged images with the same colors out of the suggestions', async (t) => {
  const root = await makeCollection(t);
  for (const [name, lightAt] of [
    ['horizontal', (x, y) => 125 + 90 * Math.cos((y + 0.5) * Math.PI / 64)],
    ['vertical', (x) => 125 + 90 * Math.cos((x + 0.5) * Math.PI / 64)],
  ]) {
    const pixels = Buffer.alloc(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) pixels[y * 64 + x] = lightAt(x, y);
    }
    await sharp(pixels, { raw: { width: 64, height: 64, channels: 1 } })
      .png().toFile(path.join(root, `${name}.png`));
  }
  const { scanDuplicatePhotos } = await import('../server/duplicateScan.js');
  const result = await scanDuplicatePhotos(root);
  assert.equal(result.scannedCount, 2);
  assert.equal(result.visualSkippedCount, 0);
  assert.deepEqual(result.similarGroups, []);
});

test('aborts a cancelled scan before reading the collection', async () => {
  const { scanDuplicatePhotos } = await import('../server/duplicateScan.js');
  await assert.rejects(
    scanDuplicatePhotos('unused path', { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
  );
});
