import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignComparisonSlot,
  buildComparisonCandidatePool,
  filterComparisonCandidates,
  getPhotoDirectory,
  resolveComparisonFolder,
  resolveComparisonPair,
} from '../client/src/components/comparePhotoPicker.js';

const samplePhotos = [
  { name: 'IMG_001.jpg', relPath: 'cong/IMG_001.jpg', triage: 'pick' },
  { name: 'IMG_002.jpg', relPath: 'cong/IMG_002.jpg', triage: 'maybe' },
  { name: 'IMG_003.jpg', relPath: 'ban/IMG_003.jpg', triage: 'pick' },
  { name: 'DSC_010.jpg', relPath: 'ban/DSC_010.jpg', triage: null },
];

test('resolveComparisonPair picks a distinct second photo in the same folder when inside a folder, or across all photos when at root', () => {
  // At root ("Tất cả ảnh", currentFolder = ""), can pair across all photos
  const pairAtRoot = resolveComparisonPair(samplePhotos, samplePhotos[0], null, { currentFolder: '' });
  assert.equal(pairAtRoot.photoA?.relPath, 'cong/IMG_001.jpg');
  assert.equal(pairAtRoot.photoB?.relPath, 'cong/IMG_002.jpg');

  const singleInFolder = [{ name: 'ONLY.jpg', relPath: 'rieng/ONLY.jpg' }, ...samplePhotos];
  const pairAtRootAcrossFolders = resolveComparisonPair(singleInFolder, singleInFolder[0], null, { currentFolder: '' });
  assert.equal(pairAtRootAcrossFolders.photoA?.relPath, 'rieng/ONLY.jpg');
  assert.equal(pairAtRootAcrossFolders.photoB?.relPath, 'cong/IMG_001.jpg');

  // Inside folder "rieng" (currentFolder = "rieng"), does NOT pull a photo from another folder
  const pairInFolderOnly = resolveComparisonPair(singleInFolder, singleInFolder[0], null, { currentFolder: 'rieng' });
  assert.equal(pairInFolderOnly.photoA?.relPath, 'rieng/ONLY.jpg');
  assert.equal(pairInFolderOnly.photoB, null);
});

test('buildComparisonCandidatePool restricts to folder when currentFolder is set, and includes all photos when at Tất cả ảnh', () => {
  assert.equal(getPhotoDirectory('cong/IMG_001.jpg'), 'cong');
  assert.equal(getPhotoDirectory('ROOT.jpg'), '');

  // When inside folder "cong" (currentFolder = "cong"), excludes photos from "ban"
  assert.equal(
    resolveComparisonFolder({
      currentFolder: 'cong',
      photoA: samplePhotos[0],
      photoB: samplePhotos[1],
    }),
    'cong',
  );
  const poolInFolder = buildComparisonCandidatePool({
    allPhotos: samplePhotos.slice(0, 2),
    burstPhotos: samplePhotos,
    photoA: samplePhotos[0],
    photoB: samplePhotos[1],
    currentFolder: 'cong',
  });
  assert.deepEqual(
    poolInFolder.map(p => p.relPath),
    ['cong/IMG_001.jpg', 'cong/IMG_002.jpg'],
  );

  // When at "Tất cả ảnh" (currentFolder = ""), includes all photos across all folders
  assert.equal(
    resolveComparisonFolder({
      currentFolder: '',
      photoA: samplePhotos[0],
      photoB: samplePhotos[1],
    }),
    null,
  );
  const poolAtRoot = buildComparisonCandidatePool({
    allPhotos: samplePhotos,
    burstPhotos: samplePhotos,
    photoA: samplePhotos[0],
    photoB: samplePhotos[1],
    currentFolder: '',
  });
  assert.equal(poolAtRoot.length, 4);
});

test('filterComparisonCandidates filters by selected, burst, pick, and search query', () => {
  assert.deepEqual(
    filterComparisonCandidates(samplePhotos, {
      scope: 'selected',
      selectedFiles: ['cong/IMG_002.jpg', 'ban/DSC_010.jpg'],
    }).map(p => p.relPath),
    ['cong/IMG_002.jpg', 'ban/DSC_010.jpg'],
  );

  assert.deepEqual(
    filterComparisonCandidates(samplePhotos, {
      scope: 'burst',
      burstPaths: ['cong/IMG_001.jpg', 'cong/IMG_002.jpg'],
    }).map(p => p.relPath),
    ['cong/IMG_001.jpg', 'cong/IMG_002.jpg'],
  );

  assert.deepEqual(
    filterComparisonCandidates(samplePhotos, { scope: 'pick', query: 'ban/' }).map(p => p.relPath),
    ['ban/IMG_003.jpg'],
  );
});

test('assignComparisonSlot updates target panel and swaps if user picks the opposite panel photo', () => {
  const [first, second, third] = samplePhotos;

  const updatedB = assignComparisonSlot(first, second, 'B', third);
  assert.equal(updatedB.photoA?.relPath, first.relPath);
  assert.equal(updatedB.photoB?.relPath, third.relPath);

  const swapped = assignComparisonSlot(first, second, 'A', second);
  assert.equal(swapped.photoA?.relPath, second.relPath);
  assert.equal(swapped.photoB?.relPath, first.relPath);
});
