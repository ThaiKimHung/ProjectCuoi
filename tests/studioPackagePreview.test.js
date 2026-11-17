import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildStudioPackage } from '../client/src/components/studioPackagePreview.js';
import { exportCategorizedPackage } from '../server/fileManager.js';

test('studio preview and export contain the same photos by relative path', () => {
  const photos = [
    { relPath: 'studio/001.jpg', albums: ['gate', 'album'], triage: 'pick' },
    { relPath: 'outdoors/001.jpg', albums: ['gate'] },
    { relPath: 'outdoors/002.jpg', albums: ['custom'], triage: 'pick' },
    { relPath: 'outdoors/003.jpg', albums: [], triage: 'pick' },
    { relPath: 'outdoors/004.jpg', triage: 'pick' },
    { relPath: 'outdoors/005.jpg', albums: ['custom'] },
    { relPath: 'outdoors/006.jpg', albums: [], triage: 'maybe' },
  ];
  const { groups, categories, unassignedPicks } = buildStudioPackage(photos, {
    gate: { quota: 0 },
    album: { quota: 3 },
    custom: { quota: 5 },
  });

  assert.deepEqual(groups.map(group => group.id), ['gate', 'album', 'table', 'slide', 'pick']);
  assert.deepEqual(categories.map(category => category.folderName), [
    '01_Anh_Cong', '02_Album_Cuoi', '05_Tat_Ca_Anh_Giu_Lai',
  ]);
  assert.deepEqual(categories.map(category => category.files), [
    ['studio/001.jpg', 'outdoors/001.jpg'],
    ['studio/001.jpg'],
    ['studio/001.jpg', 'outdoors/002.jpg', 'outdoors/003.jpg', 'outdoors/004.jpg'],
  ]);
  for (const category of categories) {
    const group = groups.find(item => item.id === category.id);
    assert.deepEqual(group.photos.map(photo => photo.relPath), category.files);
  }
  assert.equal(groups[0].quota, 0);
  assert.equal(groups[0].shortfall, 0);
  assert.equal(groups[1].shortfall, 2);
  assert.deepEqual(unassignedPicks.map(photo => photo.relPath), [
    'outdoors/003.jpg', 'outdoors/004.jpg',
  ]);
});

test('empty packages retain album quota information without any export categories', () => {
  const { groups, categories, unassignedPicks } = buildStudioPackage([], {
    gate: { quota: 1 },
    album: { quota: 0 },
    table: { quota: 2 },
    slide: { quota: 4 },
  });

  assert.deepEqual(categories, []);
  assert.deepEqual(unassignedPicks, []);
  assert.deepEqual(groups.map(group => group.shortfall), [1, 0, 2, 4, 0]);
});

test('only opted-in custom albums join the preview and payload', () => {
  const photos = [
    { relPath: 'studio/001.jpg', albums: ['gate', 'family'], triage: 'pick' },
    { relPath: 'outdoors/001.jpg', albums: ['family'] },
    { relPath: 'outdoors/002.jpg', albums: ['pick'], triage: 'maybe' },
    { relPath: 'outdoors/003.jpg', albums: ['extras'] },
  ];
  const albums = {
    family: { id: 'family', name: 'Gia đình', quota: 3 },
    pick: { id: 'pick', name: 'Ảnh riêng', quota: 0 },
    empty: { id: 'empty', name: 'Chưa gán ảnh', quota: 2 },
    extras: { id: 'extras', name: 'Ảnh bổ sung', quota: 1 },
  };

  const { groups, setupGroups, categories } = buildStudioPackage(photos, albums, ['family', 'pick', 'empty', 'missing']);

  assert.deepEqual(groups.filter(group => group.albumId).map(group => [group.albumId, group.quota, group.shortfall]), [
    ['empty', 2, 2], ['family', 3, 1], ['pick', 0, 0],
  ]);
  assert.deepEqual(setupGroups.filter(group => group.albumId).map(group => [group.albumId, group.included, group.photos.length]), [
    ['empty', true, 0], ['extras', false, 1], ['family', true, 2], ['pick', true, 1],
  ]);
  assert.deepEqual(categories.map(category => [category.title, category.files]), [
    ['Ảnh Cổng 60x90', ['studio/001.jpg']],
    ['Tất Cả Ảnh Đã Chọn (Giữ lại)', ['studio/001.jpg']],
    ['Gia đình', ['studio/001.jpg', 'outdoors/001.jpg']],
    ['Ảnh riêng', ['outdoors/002.jpg']],
  ]);
  assert.equal(new Set(categories.map(category => category.id)).size, categories.length);
  for (const category of categories) {
    const group = groups.find(item => item.id === category.id);
    assert.equal(group.folderName, category.folderName);
    assert.deepEqual(group.photos.map(photo => photo.relPath), category.files);
  }
});

test('similarly named custom albums use separate portable folders that stay stable on re-export', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-custom-albums-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'studio'));
  await mkdir(path.join(root, 'outdoors'));
  await writeFile(path.join(root, 'studio', '001.jpg'), 'studio photo');
  await writeFile(path.join(root, 'outdoors', '001.jpg'), 'outdoors photo');
  const photos = [
    { relPath: 'studio/001.jpg', albums: ['team-a'] },
    { relPath: 'outdoors/001.jpg', albums: ['team-b'] },
  ];
  const albums = {
    'team-b': { id: 'team-b', name: '../Gia\\Đình!', quota: 0 },
    'team-a': { id: 'team-a', name: '../gia/đình?', quota: 0 },
  };
  const firstPackage = buildStudioPackage(photos, albums, ['team-b', 'team-a']);
  assert.equal(firstPackage.categories.length, 2);
  const [firstFolder, secondFolder] = firstPackage.categories.map(category => category.folderName);
  for (const folder of [firstFolder, secondFolder]) {
    assert.match(folder, /^Album_gia_dinh[-_a-z0-9]+$/i);
  }
  assert.notEqual(firstFolder.toLowerCase(), secondFolder.toLowerCase());

  const targetFolderName = 'Package';
  const packageDir = path.join(root, targetFolderName);
  const result = await exportCategorizedPackage(root, { targetFolderName, categories: firstPackage.categories });
  assert.deepEqual(result.categoriesSummary.map(category => category.folder), [firstFolder, secondFolder]);
  assert.equal(await readFile(path.join(packageDir, firstFolder, '001.jpg'), 'utf8'), 'studio photo');
  assert.equal(await readFile(path.join(packageDir, secondFolder, '001.jpg'), 'utf8'), 'outdoors photo');

  const secondPackage = buildStudioPackage(photos, { 'team-b': albums['team-b'] }, ['team-b']);
  assert.equal(secondPackage.categories[0].folderName, secondFolder);
  await exportCategorizedPackage(root, { targetFolderName, categories: secondPackage.categories });
  const entries = await readdir(packageDir, { withFileTypes: true });
  assert.deepEqual(entries.filter(entry => entry.isDirectory()).map(entry => entry.name), [secondFolder]);
  assert.equal(await readFile(path.join(packageDir, secondFolder, '001.jpg'), 'utf8'), 'outdoors photo');
});
