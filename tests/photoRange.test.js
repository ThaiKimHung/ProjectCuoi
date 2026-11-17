import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePhotoRange, resolvePhotoSpec, resolvePhotoGrouping, sanitizeFolderName } from '../client/src/photoRange.js';

const list = (...names) => names.map(name => ({ name, relPath: `a/${name}` }));
const names = result => result.photos.map(p => p.name);

test('index mode uses 1-based positions and includes both ends', () => {
  const photos = list('x.jpg', 'y.jpg', 'z.jpg', 'w.jpg');
  assert.deepEqual(names(resolvePhotoRange(photos, '2', '3')), ['y.jpg', 'z.jpg']);
  assert.deepEqual(names(resolvePhotoRange(photos, '4', '3')), ['z.jpg', 'w.jpg']);
  assert.deepEqual(names(resolvePhotoRange(photos, '1', '')), ['x.jpg']);
});

test('index mode rejects out-of-range and non-numeric input', () => {
  const photos = list('x.jpg', 'y.jpg');
  assert.match(resolvePhotoRange(photos, '0', '2').error, /ngoài/);
  assert.match(resolvePhotoRange(photos, '1', '3').error, /ngoài/);
  assert.match(resolvePhotoRange(photos, 'a', '2').error, /số/);
});

test('name mode matches full name, base name, or a unique number', () => {
  const photos = list('IMG_0009.jpg', 'IMG_0012.jpg', 'IMG_0120.jpg', 'IMG_0200.JPG');
  assert.deepEqual(names(resolvePhotoRange(photos, 'img_0012.jpg', 'IMG_0200', 'name')),
    ['IMG_0012.jpg', 'IMG_0120.jpg', 'IMG_0200.JPG']);
  assert.deepEqual(names(resolvePhotoRange(photos, '12', '120', 'name')), ['IMG_0012.jpg', 'IMG_0120.jpg']);
});

test('name mode reports missing and ambiguous matches', () => {
  const photos = list('Anh_Cuoi_01.jpg', 'Anh_Cuoi_02.jpg');
  assert.match(resolvePhotoRange(photos, '7', '', 'name').error, /Không tìm thấy/);
  assert.match(resolvePhotoRange(photos, 'Cuoi', '', 'name').error, /khớp 2 ảnh/);
});

test('camera names with numbering gaps snap to the nearest photo inside the range', () => {
  // Real naming from the user's Drive folder: DSC_6832, 6835, 6836 … with gaps.
  const photos = list('DSC_6832.JPG', 'DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6846.JPG', 'DSC_6848.JPG', 'DSC_6850.JPG');
  assert.deepEqual(names(resolvePhotoRange(photos, '6832', '6846', 'name')),
    ['DSC_6832.JPG', 'DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6846.JPG']);
  assert.deepEqual(names(resolvePhotoRange(photos, 'DSC_6835', 'DSC_6848.JPG', 'name')),
    ['DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6846.JPG', 'DSC_6848.JPG']);

  const snapped = resolvePhotoRange(photos, '6833', 'DSC_6849', 'name');
  assert.deepEqual(names(snapped), ['DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6846.JPG', 'DSC_6848.JPG']);
  assert.equal(snapped.snapped.length, 2);

  assert.deepEqual(names(resolvePhotoRange(photos, '6849', '6834', 'name')),
    ['DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6846.JPG', 'DSC_6848.JPG']);
  assert.match(resolvePhotoRange(photos, '6837', '6845', 'name').error, /Không có ảnh nào trong khoảng/);
  assert.match(resolvePhotoRange(photos, '9000', '9100', 'name').error, /Không tìm thấy|Không có ảnh/);
});

const dsc = (...nums) => nums.map(n => ({ name: `DSC_${n}.JPG`, relPath: `JPG/DSC_${n}.JPG` }));

test('a spec mixes ranges, single numbers and space-separated lists', () => {
  const photos = dsc(6832, 6835, 6836, 6837, 6840, 6855, 6900, 6901, 6912);
  const result = resolvePhotoSpec(photos, '6832-6836, 6855; 6900 đến 6901\n6912', 'name');
  assert.deepEqual(result.photos.map(p => p.name),
    ['DSC_6832.JPG', 'DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6855.JPG', 'DSC_6900.JPG', 'DSC_6901.JPG', 'DSC_6912.JPG']);
  assert.deepEqual(result.errors, []);

  assert.deepEqual(resolvePhotoSpec(photos, '6837 6840 6837', 'name').photos.map(p => p.name), ['DSC_6837.JPG', 'DSC_6840.JPG']);
  assert.deepEqual(resolvePhotoSpec(photos, 'DSC_6835 - DSC_6837, DSC_6900→DSC_6901', 'name').photos.length, 5);
  assert.deepEqual(resolvePhotoSpec(photos, '1-3, 5', 'index').photos.map(p => p.name),
    ['DSC_6832.JPG', 'DSC_6835.JPG', 'DSC_6836.JPG', 'DSC_6840.JPG']);
});

test('a spec reports each part that cannot be found', () => {
  const photos = dsc(6832, 6835);
  const result = resolvePhotoSpec(photos, '6832, 6833, abc', 'name');
  assert.equal(result.photos.length, 1);
  assert.equal(result.errors.length, 2);
});

test('names that contain a dash stay a single photo', () => {
  const photos = [{ name: 'Le-Cuoi-01.jpg', relPath: 'Le-Cuoi-01.jpg' }, { name: 'Le-Cuoi-02.jpg', relPath: 'Le-Cuoi-02.jpg' }];
  assert.deepEqual(resolvePhotoSpec(photos, 'Le-Cuoi-02', 'name').photos.map(p => p.name), ['Le-Cuoi-02.jpg']);
  assert.equal(resolvePhotoSpec(photos, 'Le-Cuoi-01 - Le-Cuoi-02', 'name').photos.length, 2);
});

test('labeled lines make one group per folder and catch overlaps', () => {
  const photos = dsc(6832, 6835, 6836, 6900, 6901);
  const grouped = resolvePhotoGrouping(photos, 'Ảnh cổng: 6832-6835\nAlbum/cưới: 6900, 6901\nẢnh cổng: 6836', 'name');
  assert.equal(grouped.multi, true);
  assert.deepEqual(grouped.groups.map(g => [g.folder, g.photos.length]), [['Ảnh cổng', 3], ['Album-cưới', 2]]);
  assert.equal(grouped.photos.length, 5);
  assert.deepEqual(grouped.errors, []);

  assert.match(resolvePhotoGrouping(photos, 'A: 6832-6836\nB: 6835', 'name').errors[0], /cả “A” và “B”/);
  assert.match(resolvePhotoGrouping(photos, 'A: 6832\n6835', 'name').errors[0], /Dòng 2 thiếu tên/);
  assert.equal(resolvePhotoGrouping(photos, '6832, 6835', 'name').multi, false);
  assert.equal(sanitizeFolderName(' .. '), '');
});
