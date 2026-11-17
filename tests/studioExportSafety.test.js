import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exportCategorizedPackage } from '../server/fileManager.js';

const targetFolderName = 'Studio_Package';
const defaultAlbum = { folderName: '01_Anh_Cong', files: ['gate.jpg'] };
const customAlbum = { folderName: 'Album_Gia_Dinh', files: ['family.jpg'] };
const protectedError = /chọn tên thư mục khác/i;

async function setupPackage(t, categories = [defaultAlbum, customAlbum]) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-export-safety-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'gate.jpg'), 'gate copy source');
  await writeFile(path.join(root, 'family.jpg'), 'family copy source');
  const packageDir = path.join(root, targetFolderName);
  const reexport = nextCategories => exportCategorizedPackage(root, { targetFolderName, categories: nextCategories });
  if (categories) await reexport(categories);
  return { root, packageDir, reexport };
}

for (const stillSelected of [true, false]) {
  test(`re-export rejects an unrelated original in a ${stillSelected ? 'selected' : 'deselected'} prior category`, async t => {
    const { root, packageDir, reexport } = await setupPackage(t);
    const original = path.join(root, 'original.jpg');
    const movedOriginal = path.join(packageDir, customAlbum.folderName, 'original.jpg');
    await writeFile(original, 'one original');
    await rename(original, movedOriginal);

    await assert.rejects(reexport(stillSelected ? [defaultAlbum, customAlbum] : [defaultAlbum]), protectedError);
    assert.equal(await readFile(movedOriginal, 'utf8'), 'one original');
    assert.equal(await readFile(path.join(packageDir, defaultAlbum.folderName, 'gate.jpg'), 'utf8'), 'gate copy source');
  });
}

test('re-export protects an original that replaced a copy at the same path', async t => {
  const { root, packageDir, reexport } = await setupPackage(t);
  const original = path.join(root, 'replacement.jpg');
  const previousCopy = path.join(packageDir, customAlbum.folderName, 'family.jpg');
  await writeFile(original, 'replacement original');
  await rename(original, previousCopy);

  await assert.rejects(reexport([defaultAlbum]), protectedError);
  assert.equal(await readFile(previousCopy, 'utf8'), 'replacement original');
});

test('re-export protects files in a new category already present under the package', async t => {
  const { packageDir, reexport } = await setupPackage(t, [defaultAlbum]);
  const existingDir = path.join(packageDir, customAlbum.folderName);
  await mkdir(existingDir);
  const original = path.join(existingDir, 'original.jpg');
  await writeFile(original, 'one original');

  await assert.rejects(reexport([defaultAlbum, customAlbum]), protectedError);
  assert.equal(await readFile(original, 'utf8'), 'one original');
});

test('export protects an unrelated file with the expected report name', async t => {
  const { packageDir, reexport } = await setupPackage(t, null);
  await mkdir(packageDir);
  const unrelatedReport = path.join(packageDir, 'Bao_Cao_Xuat.txt');
  await writeFile(unrelatedReport, 'independent notes');

  await assert.rejects(reexport([defaultAlbum]), protectedError);
  assert.equal(await readFile(unrelatedReport, 'utf8'), 'independent notes');
});

test('legacy category-only manifests require a different package name', async t => {
  const { packageDir, reexport } = await setupPackage(t);
  const manifestPath = path.join(packageDir, '.export_manifest.json');
  await writeFile(manifestPath, JSON.stringify({ categories: [defaultAlbum.folderName, customAlbum.folderName] }));

  await assert.rejects(reexport([defaultAlbum]), protectedError);
  assert.equal(await readFile(path.join(packageDir, customAlbum.folderName, 'family.jpg'), 'utf8'), 'family copy source');
});
