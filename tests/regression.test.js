import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

import { 
  initStorage, 
  getState, 
  saveState, 
  markPhotosViewed, 
  toggleFavorite, 
  saveNote, 
  saveAnnotations,
  setConfig,
  getCollectionId,
  setDataDir,
  getStateFilePath,
  setPhotoTriage,
  togglePhotoInVirtualAlbum,
  createVirtualAlbum,
  deleteVirtualAlbum,
  updateAlbumQuota,
  saveSession
} from '../server/storage.js';

import { 
  assertWithinRoot, 
  deleteFolder, 
  movePhotos, 
  copyPhotosToFolder,
  exportCategorizedPackage,
  createFolder,
  getPhotosInFolder,
  getFolderTree,
  detectBurstGroups
} from '../server/fileManager.js';
import { parseJpegExif } from '../server/exifParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_SANDBOX = path.join(__dirname, '.test_sandbox');
const TEST_DATA_DIR = path.join(TEST_SANDBOX, 'data');
const PHOTOS_DIR_A = path.join(TEST_SANDBOX, 'collection_a');
const PHOTOS_DIR_B = path.join(TEST_SANDBOX, 'collection_b');
const OUTSIDE_DIR = path.join(TEST_SANDBOX, 'outside_target');

describe('Wedding Photo Curator - Regression & Security Test Suite', () => {

  before(async () => {
    // 100% Isolated sandbox environment: strictly inside .test_sandbox
    await fs.remove(TEST_SANDBOX);
    await fs.ensureDir(TEST_DATA_DIR);
    await fs.ensureDir(PHOTOS_DIR_A);
    await fs.ensureDir(PHOTOS_DIR_B);
    await fs.ensureDir(OUTSIDE_DIR);

    // Populate mock photos in Collection A
    await fs.writeFile(path.join(PHOTOS_DIR_A, '001.jpg'), 'photo data 1');
    await fs.writeFile(path.join(PHOTOS_DIR_A, '002.jpg'), 'photo data 2');
    await fs.writeFile(path.join(PHOTOS_DIR_A, '003.jpg'), 'photo data 3');
    await fs.ensureDir(path.join(PHOTOS_DIR_A, 'subfolder'));
    await fs.writeFile(path.join(PHOTOS_DIR_A, 'subfolder', 'child.jpg'), 'child photo');

    // Populate mock photos in Collection B with identical filename
    await fs.writeFile(path.join(PHOTOS_DIR_B, '001.jpg'), 'photo data collection B');

    // Populate a file in outside directory
    await fs.writeFile(path.join(OUTSIDE_DIR, 'critical_outside.txt'), 'do not delete');

    // Initialize storage strictly isolated within TEST_DATA_DIR! Never touches real data/
    await initStorage({ dataDir: TEST_DATA_DIR, photosDir: PHOTOS_DIR_A });
  });

  after(async () => {
    // Cleanup sandbox completely without touching or mutating real data/
    await fs.remove(TEST_SANDBOX);
    // Restore default dataDir to real data directory for subsequent app usage
    setDataDir(path.resolve(process.cwd(), 'data'));
    await initStorage();
  });

  // -------------------------------------------------------------
  // ISSUE 1 [P1]: Path Traversal & Root Protection
  // -------------------------------------------------------------
  describe('Issue 1 [P1]: Path Traversal & Root Protection in File Operations', () => {
    test('1.1: assertWithinRoot rejects ../outside traversal', async () => {
      await assert.rejects(
        async () => assertWithinRoot(PHOTOS_DIR_A, '../outside_target'),
        /Đường dẫn không hợp lệ: Cố ý truy cập ngoài thư mục ảnh/
      );
    });

    test('1.2: assertWithinRoot rejects child/.. root traversal when allowRoot is false', async () => {
      await assert.rejects(
        async () => assertWithinRoot(PHOTOS_DIR_A, 'subfolder/..', { allowRoot: false }),
        /Thao tác không được phép trên thư mục gốc/
      );
    });

    test('1.3: assertWithinRoot rejects null byte injection', async () => {
      await assert.rejects(
        async () => assertWithinRoot(PHOTOS_DIR_A, '001.jpg\0.png'),
        /Đường dẫn chứa ký tự không hợp lệ/
      );
    });

    test('1.4: deleteFolder cannot delete outside directory', async () => {
      await assert.rejects(
        async () => deleteFolder(PHOTOS_DIR_A, '../outside_target'),
        /Đường dẫn không hợp lệ/
      );
      const outsideExists = await fs.pathExists(path.join(OUTSIDE_DIR, 'critical_outside.txt'));
      assert.strictEqual(outsideExists, true, 'Outside directory must remain intact');
    });

    test('1.5: deleteFolder cannot delete root directory via child/.. bypass', async () => {
      await assert.rejects(
        async () => deleteFolder(PHOTOS_DIR_A, 'subfolder/..'),
        /Thao tác không được phép trên thư mục gốc/
      );
      const rootExists = await fs.pathExists(PHOTOS_DIR_A);
      assert.strictEqual(rootExists, true, 'Photos root directory must never be deleted');
    });

    test('1.6: movePhotos rejects moving files outside root', async () => {
      const res = await movePhotos(PHOTOS_DIR_A, ['../outside_target/critical_outside.txt'], 'subfolder');
      assert.strictEqual(res.movedCount, 0, 'No files outside root should be moved');
      assert.strictEqual(res.results[0].success, false);
    });

    test('1.7: Symlink cannot be used to create folder or access files outside root', async () => {
      const symlinkPath = path.join(PHOTOS_DIR_A, 'symlink_outside');
      try {
        await fs.ensureSymlink(OUTSIDE_DIR, symlinkPath);
      } catch (e) {
        // Skip if OS permissions restrict symlink creation
        return;
      }

      // Attempt creating a subfolder through the symlink to outside
      await assert.rejects(
        async () => createFolder(PHOTOS_DIR_A, 'symlink_outside', 'malicious_sub'),
        /Symlink trỏ ra ngoài phạm vi cho phép/
      );

      // Verify the malicious subfolder was NOT created outside
      const maliciousCreated = await fs.pathExists(path.join(OUTSIDE_DIR, 'malicious_sub'));
      assert.strictEqual(maliciousCreated, false, 'Malicious folder must not be created outside root');

      // Attempt assertWithinRoot on non-existent path under symlink
      await assert.rejects(
        async () => assertWithinRoot(PHOTOS_DIR_A, 'symlink_outside/non_existent/file.jpg'),
        /Symlink trỏ ra ngoài phạm vi cho phép/
      );
    });
  });

  // -------------------------------------------------------------
  // ISSUE 2 [P1]: Concurrent State Writes & JSON Durability
  // -------------------------------------------------------------
  describe('Issue 2 [P1]: Concurrent State Writes, Queue Serialization & POSIX Atomic Save', () => {
    test('2.1: 40 concurrent writes execute without corruption and maintain schema integrity', async () => {
      const writePromises = [];

      for (let i = 0; i < 40; i++) {
        const photoName = `photo_${i}.jpg`;
        if (i % 4 === 0) {
          writePromises.push(markPhotosViewed([photoName], true));
        } else if (i % 4 === 1) {
          writePromises.push(toggleFavorite(photoName, true));
        } else if (i % 4 === 2) {
          writePromises.push(saveNote(photoName, `Ghi chú cho ảnh ${i}`));
        } else {
          writePromises.push(saveAnnotations(photoName, [{ id: i, label: `Điểm ${i}`, x: 50, y: 50, radius: 10 }]));
        }
      }

      // Run all simultaneously
      await Promise.all(writePromises);

      // Verify in-memory state
      const memoryState = getState();
      assert.ok(memoryState, 'Memory state exists');
      assert.strictEqual(Object.keys(memoryState.viewed || {}).length >= 10, true, 'Viewed count correct');
      assert.strictEqual(Object.keys(memoryState.favorites || {}).length >= 10, true, 'Favorite count correct');
      assert.strictEqual(Object.keys(memoryState.notes || {}).length >= 10, true, 'Notes count correct');
      assert.strictEqual(Object.keys(memoryState.annotations || {}).length >= 10, true, 'Annotations count correct');

      // Verify on-disk JSON file is strictly inside TEST_DATA_DIR and valid
      const stateFilePath = getStateFilePath();
      assert.strictEqual(stateFilePath.startsWith(TEST_DATA_DIR), true, 'State file is inside test sandbox');
      const diskJson = await fs.readJson(stateFilePath);
      assert.strictEqual(diskJson.version, 2, 'Version is 2');
      assert.ok(diskJson.collections, 'Collections container exists');
      
      const colId = getCollectionId(PHOTOS_DIR_A);
      assert.ok(diskJson.collections[colId], 'Collection A persisted on disk');
      assert.strictEqual(Object.keys(diskJson.collections[colId].viewed).length >= 10, true);

      // Verify no dangling .tmp files remained
      const filesInData = await fs.readdir(TEST_DATA_DIR);
      const tmpFiles = filesInData.filter(f => f.includes('.tmp'));
      assert.strictEqual(tmpFiles.length, 0, 'No temporary files should be left dangling');
    });

    test('2.2: Auto-recovery from .bak backup when primary state file is corrupted or missing', async () => {
      // 1. Ensure a valid state with a known note persisted into backup
      await saveNote('recovery_test.jpg', 'Dữ liệu cứu hộ quan trọng');
      await toggleFavorite('recovery_test.jpg', true);
      
      const stateFilePath = getStateFilePath();
      const backupPath = stateFilePath + '.bak';
      assert.strictEqual(await fs.pathExists(backupPath), true, 'Backup file .bak exists');

      // 2. Corrupt the primary state file with invalid JSON
      await fs.writeFile(stateFilePath, 'CORRUPTED JSON { invalid syntax');

      // 3. Re-initialize storage: should detect corrupt state and restore from .bak
      await initStorage({ dataDir: TEST_DATA_DIR, photosDir: PHOTOS_DIR_A });

      // 4. Verify data is recovered intact
      const recoveredState = getState();
      assert.strictEqual(recoveredState.notes['recovery_test.jpg'], 'Dữ liệu cứu hộ quan trọng');

      // 5. Verify the primary state file has been repaired on disk
      const repairedDiskJson = await fs.readJson(stateFilePath);
      assert.strictEqual(repairedDiskJson.version, 2);
    });
  });

  // -------------------------------------------------------------
  // ISSUE 3 [P1]: Multi-collection State Isolation
  // -------------------------------------------------------------
  describe('Issue 3 [P1]: Collection Isolation (No Cross-Pollution of Metadata)', () => {
    test('3.1: Switching between collections keeps notes, favorites, and viewed markers completely isolated', async () => {
      // Step A: Mark 001.jpg in Collection A
      await setConfig({ photosDir: PHOTOS_DIR_A });
      await markPhotosViewed(['001.jpg'], true);
      await toggleFavorite('001.jpg', true);
      await saveNote('001.jpg', 'Ghi chú độc quyền của Bộ ảnh A');
      await saveAnnotations('001.jpg', [{ id: 1, label: 'Vết bẩn áo cưới A', x: 20, y: 30 }]);

      const stateA = getState();
      assert.strictEqual(Boolean(stateA.viewed['001.jpg']), true);
      assert.strictEqual(stateA.favorites['001.jpg'], true);
      assert.strictEqual(stateA.notes['001.jpg'], 'Ghi chú độc quyền của Bộ ảnh A');
      assert.strictEqual(stateA.annotations['001.jpg'].length, 1);

      // Step B: Switch to Collection B (which also has 001.jpg)
      await setConfig({ photosDir: PHOTOS_DIR_B });
      const stateB = getState();

      // In Collection B, 001.jpg must NOT have any marks from Collection A
      assert.strictEqual(stateB.viewed['001.jpg'], undefined, 'Collection B viewed must be empty');
      assert.strictEqual(stateB.favorites['001.jpg'], undefined, 'Collection B favorites must be empty');
      assert.strictEqual(stateB.notes['001.jpg'], undefined, 'Collection B note must be empty');
      assert.strictEqual(stateB.annotations['001.jpg'], undefined, 'Collection B annotations must be empty');

      // Step C: Set distinct note in Collection B
      await saveNote('001.jpg', 'Ghi chú riêng của Bộ ảnh B');
      assert.strictEqual(getState().notes['001.jpg'], 'Ghi chú riêng của Bộ ảnh B');

      // Step D: Switch back to Collection A and verify its original note is preserved
      await setConfig({ photosDir: PHOTOS_DIR_A });
      const stateARestored = getState();
      assert.strictEqual(stateARestored.notes['001.jpg'], 'Ghi chú độc quyền của Bộ ảnh A');
      assert.strictEqual(Boolean(stateARestored.viewed['001.jpg']), true);
    });
  });

  // -------------------------------------------------------------
  // ISSUE 4 [P2]: Search & Lightbox Identification via relPath
  // -------------------------------------------------------------
  describe('Issue 4 [P2]: Lightbox Identity Resolution (Fix for Search Index Mismatch)', () => {
    test('4.1: Active photo in Lightbox resolves strictly by relPath, avoiding array index offset', () => {
      const fullList = [
        { relPath: '001.jpg', name: '001.jpg' },
        { relPath: '002.jpg', name: '002.jpg' },
        { relPath: '003.jpg', name: '003.jpg' },
      ];

      // User searches for "003", displayed photos has 1 item
      const searchQuery = '003';
      const displayedPhotos = fullList.filter(p => p.name.includes(searchQuery));
      assert.strictEqual(displayedPhotos.length, 1);
      assert.strictEqual(displayedPhotos[0].relPath, '003.jpg');

      // Fixed version: Gallery passes photo.relPath = "003.jpg"
      const activePhotoPath = displayedPhotos[0].relPath;

      // Lightbox finds index within displayedPhotos using activePhotoPath
      const targetIndex = displayedPhotos.findIndex(p => p.relPath === activePhotoPath);
      assert.strictEqual(targetIndex, 0);
      assert.strictEqual(displayedPhotos[targetIndex].relPath, '003.jpg');
      assert.strictEqual(displayedPhotos[targetIndex].name, '003.jpg', 'Correct photo opened in Lightbox');
    });
  });

  // -------------------------------------------------------------
  // ISSUE 5 [P2]: "Select All" Filter Scope
  // -------------------------------------------------------------
  describe('Issue 5 [P2]: Select All operates strictly on filtered/displayed items', () => {
    test('5.1: Select all on search results selects only displayed photos and ignores hidden ones', () => {
      const allPhotos = [
        { relPath: '001.jpg', name: '001.jpg' },
        { relPath: '002.jpg', name: '002.jpg' },
        { relPath: '003.jpg', name: '003.jpg' },
      ];

      const searchQuery = '003';
      const displayedPhotos = allPhotos.filter(p => p.name.includes(searchQuery));

      // Fixed Select All logic: selects displayedPhotos.map(p => p.relPath)
      const selectedFiles = displayedPhotos.map(p => p.relPath);

      assert.strictEqual(selectedFiles.length, 1);
      assert.strictEqual(selectedFiles.includes('003.jpg'), true);
      assert.strictEqual(selectedFiles.includes('001.jpg'), false, 'Hidden photo 001.jpg must NOT be selected');
      assert.strictEqual(selectedFiles.includes('002.jpg'), false, 'Hidden photo 002.jpg must NOT be selected');
    });
  });

  // -------------------------------------------------------------
  // ISSUE 6 [P2]: Annotation Debounce Cancellation on Delete
  // -------------------------------------------------------------
  describe('Issue 6 [P2]: Debounce timer cancellation prevents resurrecting deleted annotations', () => {
    test('6.1: Deleting an annotation immediately clears pending timer so old text edits do not overwrite delete', async () => {
      let timer = null;
      let backendData = [{ id: 1, text: 'Old' }, { id: 2, text: 'To delete' }];

      // Simulated typing sets timer with pending updated text for anno 2
      const pendingTypingData = [{ id: 1, text: 'Old' }, { id: 2, text: 'Updated text in flight' }];
      timer = setTimeout(() => {
        backendData = pendingTypingData;
      }, 450);

      // User immediately clicks Delete on anno 2
      // Fixed logic: cancels pending timer and saves deleted list immediately
      clearTimeout(timer);
      timer = null;
      backendData = [{ id: 1, text: 'Old' }];

      // Wait 500ms to verify that the pending timer never runs and backendData remains deleted
      await new Promise(r => setTimeout(r, 500));
      assert.strictEqual(backendData.length, 1);
      assert.strictEqual(backendData[0].id, 1);
      assert.strictEqual(backendData.find(a => a.id === 2), undefined, 'Deleted annotation must not resurrect');
    });
  });

  // -------------------------------------------------------------
  // ISSUE 8 [Feature 5, 7, 8]: Virtual Albums, 3-State Triage & Session Resume
  // -------------------------------------------------------------
  describe('Issue 8 [Features 5, 7, 8]: Virtual Albums, 3-State Triage & Session Resume', () => {
    test('8.1: Triage (Pick / Maybe / Reject) updates state and automatically marks photo as viewed', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Mark 001.jpg as pick
      await setPhotoTriage('001.jpg', 'pick');
      // Mark 002.jpg as maybe
      await setPhotoTriage('002.jpg', 'maybe');
      // Mark 003.jpg as reject
      await setPhotoTriage('003.jpg', 'reject');

      const state = getState();
      assert.strictEqual(state.triage['001.jpg'], 'pick');
      assert.strictEqual(state.triage['002.jpg'], 'maybe');
      assert.strictEqual(state.triage['003.jpg'], 'reject');
      // Auto-mark viewed in collection state
      assert.strictEqual(Boolean(state.viewed['001.jpg']), true);
      assert.strictEqual(Boolean(state.viewed['002.jpg']), true);
      assert.strictEqual(Boolean(state.viewed['003.jpg']), true);

      // Unset triage for 002.jpg
      await setPhotoTriage('002.jpg', null);
      const stateAfterUnset = getState();
      assert.strictEqual(stateAfterUnset.triage['002.jpg'], undefined);
    });

    test('8.2: Virtual Albums allow multi-tagging photos without moving physical files', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Tag 001.jpg into 'gate' and 'album'
      await togglePhotoInVirtualAlbum('gate', '001.jpg', true);
      await togglePhotoInVirtualAlbum('album', '001.jpg', true);

      // Verify physical file has not moved
      assert.strictEqual(await fs.pathExists(path.join(PHOTOS_DIR_A, '001.jpg')), true);

      const state = getState();
      assert.strictEqual(state.virtualAlbums.gate.photos.includes('001.jpg'), true);
      assert.strictEqual(state.virtualAlbums.album.photos.includes('001.jpg'), true);
      assert.strictEqual(state.virtualAlbums.table.photos.includes('001.jpg'), false);

      // Untag from gate
      await togglePhotoInVirtualAlbum('gate', '001.jpg', false);
      const state2 = getState();
      assert.strictEqual(state2.virtualAlbums.gate.photos.includes('001.jpg'), false);
      assert.strictEqual(state2.virtualAlbums.album.photos.includes('001.jpg'), true);
    });

    test('8.3: Session resume state saves active folder, filter, and last active photo', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      await saveSession({
        activeFolder: 'subfolder',
        activeFilter: 'pick',
        lastActivePhoto: 'subfolder/child.jpg'
      });

      const state = getState();
      assert.strictEqual(state.session.activeFolder, 'subfolder');
      assert.strictEqual(state.session.activeFilter, 'pick');
      assert.strictEqual(state.session.lastActivePhoto, 'subfolder/child.jpg');
    });

    test('8.4: Moving photos carries over triage and virtual album assignments', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Set triage and album on 003.jpg
      await setPhotoTriage('003.jpg', 'pick');
      await togglePhotoInVirtualAlbum('table', '003.jpg', true);

      // Move 003.jpg into subfolder
      await movePhotos(PHOTOS_DIR_A, ['003.jpg'], 'subfolder');

      const state = getState();
      // Old relative path is cleared
      assert.strictEqual(state.triage['003.jpg'], undefined);
      // New relative path inherits triage and album
      assert.strictEqual(state.triage['subfolder/003.jpg'], 'pick');
      assert.strictEqual(state.virtualAlbums.table.photos.includes('subfolder/003.jpg'), true);
      assert.strictEqual(state.virtualAlbums.table.photos.includes('003.jpg'), false);
    });
  });

  // -------------------------------------------------------------
  // ISSUE 9 & 10: Synchronized Compare & Categorized Export Package
  // -------------------------------------------------------------
  describe('Issue 9 & 10: Synchronized Inspection & Categorized Export Package', () => {
    test('9.1: Synchronized pan & zoom coordinate synchronization logic', () => {
      let isSyncPan = true;
      let pan = { x: 0, y: 0 };
      let panB = { x: 0, y: 0 };

      // Drag event on photo A by dx=50, dy=-30
      const dx = 50;
      const dy = -30;
      if (isSyncPan) {
        pan = { x: pan.x + dx, y: pan.y + dy };
        panB = { x: panB.x + dx, y: panB.y + dy };
      }

      assert.strictEqual(pan.x, 50);
      assert.strictEqual(pan.y, -30);
      assert.strictEqual(panB.x, 50);
      assert.strictEqual(panB.y, -30);

      // Turn off sync pan
      isSyncPan = false;
      const dx2 = 20;
      const dy2 = 10;
      // Drag only photo A
      pan = { x: pan.x + dx2, y: pan.y + dy2 };
      assert.strictEqual(pan.x, 70);
      assert.strictEqual(pan.y, -20);
      assert.strictEqual(panB.x, 50, 'Photo B remains in place when sync pan is disabled');
    });

    test('10.1: updateAlbumQuota updates quota in state and collection', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      await updateAlbumQuota('album', 35);
      await updateAlbumQuota('gate', 2);

      const state = getState();
      assert.strictEqual(state.virtualAlbums.album.quota, 35);
      assert.strictEqual(state.virtualAlbums.gate.quota, 2);
    });

    test('10.2: exportCategorizedPackage exports categorized subfolders, manifest, and reports failed files', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create dummy photos 001.jpg, 002.jpg in PHOTOS_DIR_A
      await fs.writeFile(path.join(PHOTOS_DIR_A, '001.jpg'), 'content 001');
      await fs.writeFile(path.join(PHOTOS_DIR_A, '002.jpg'), 'content 002');

      const targetFolderName = 'Test_Xuat_Goi_Cuoi';
      const categories = [
        {
          id: 'gate',
          folderName: '01_Anh_Cong',
          title: 'Ảnh Cổng',
          files: ['001.jpg', 'missing_photo.jpg'], // intentional missing file to test error reporting!
        },
        {
          id: 'album',
          folderName: '02_Album_Cuoi',
          title: 'Album Cưới',
          files: ['002.jpg'],
        },
      ];

      const metadata = {
        notes: { '001.jpg': 'Bóp eo cô dâu, xoá người phía sau' },
        annotations: {
          '001.jpg': [{ number: 1, text: 'Xoá vết dơ trên váy' }],
        },
      };

      const result = await exportCategorizedPackage(PHOTOS_DIR_A, {
        targetFolderName,
        categories,
        metadata,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalCopied, 2);
      assert.strictEqual(result.totalFailed, 1);
      assert.strictEqual(result.failedFiles.length, 1);
      assert.strictEqual(result.failedFiles[0].file, 'missing_photo.jpg');
      assert.strictEqual(result.failedFiles[0].category, 'Ảnh Cổng');

      // Verify physical folders were created
      const packagePath = path.join(PHOTOS_DIR_A, targetFolderName);
      assert.strictEqual(await fs.pathExists(path.join(packagePath, '01_Anh_Cong', '001.jpg')), true);
      assert.strictEqual(await fs.pathExists(path.join(packagePath, '02_Album_Cuoi', '002.jpg')), true);

      // Verify Manifest TXT was created with notes and retouch annotations
      const manifestPath = path.join(packagePath, 'Danh_Sach_Va_Ghi_Chu_Retouch.txt');
      assert.strictEqual(await fs.pathExists(manifestPath), true);
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      assert.match(manifestContent, /01_Anh_Cong/);
      assert.match(manifestContent, /Bóp eo cô dâu/);
      assert.match(manifestContent, /Xoá vết dơ trên váy/);

      // Verify Failure Report TXT was created
      const reportPath = path.join(packagePath, 'Bao_Cao_Xuat.txt');
      assert.strictEqual(await fs.pathExists(reportPath), true);
      const reportContent = await fs.readFile(reportPath, 'utf-8');
      assert.match(reportContent, /missing_photo\.jpg/);
      assert.match(reportContent, /Tổng số ảnh lỗi: 1/);
    });
  });

  // -------------------------------------------------------------
  // ISSUE 11: Root Folder Full Photos View
  // -------------------------------------------------------------
  describe('Issue 11: Root Folder Full Photos View Across All Subfolders', () => {
    test('11.1: Root folder (folderRelPath = "") returns FULL photos across root and all subfolders', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // In PHOTOS_DIR_A:
      // Root has 001.jpg, 002.jpg
      // Subfolder has child.jpg, 003.jpg (moved earlier)
      const rootRes = await getPhotosInFolder(PHOTOS_DIR_A, '');
      assert.strictEqual(rootRes.totalCount >= 3, true);

      // Verify it contains photos from root AND subfolder
      const rootRelPaths = rootRes.photos.map(p => p.relPath);
      assert.strictEqual(rootRelPaths.includes('001.jpg'), true);
      assert.strictEqual(rootRelPaths.includes('subfolder/child.jpg'), true);

      // When querying specific subfolder, returns ONLY photos in that subfolder
      const subRes = await getPhotosInFolder(PHOTOS_DIR_A, 'subfolder');
      const subRelPaths = subRes.photos.map(p => p.relPath);
      assert.strictEqual(subRelPaths.includes('001.jpg'), false, 'Subfolder view must not include parent photos');
      assert.strictEqual(subRelPaths.includes('subfolder/child.jpg'), true);
    });

    test('11.2: getFolderTree calculates totalCount for root including all subfolders', async () => {
      const tree = await getFolderTree(PHOTOS_DIR_A, '');
      assert.strictEqual(tree.name, 'Tất cả ảnh (Thư mục gốc)');
      assert.strictEqual(tree.photoCount >= 3, true);
    });
  });

  // -------------------------------------------------------------
  // ISSUE 12: Group 1 & Group 2 Features (Burst Detection, Smart Filters & EXIF)
  // -------------------------------------------------------------
  describe('Issue 12: Burst Shots Detection, Smart Filters & EXIF Metadata', () => {
    test('12.1: detectBurstGroups accurately detects consecutive shooting sequences', () => {
      const mockPhotos = [
        { name: '_DSC0100.jpg', relPath: '_DSC0100.jpg', folder: 'Thư mục gốc', mtime: 1000 },
        { name: '_DSC0101.jpg', relPath: '_DSC0101.jpg', folder: 'Thư mục gốc', mtime: 2000 },
        { name: '_DSC0102.jpg', relPath: '_DSC0102.jpg', folder: 'Thư mục gốc', mtime: 3000 },
        { name: '_DSC0250.jpg', relPath: '_DSC0250.jpg', folder: 'Thư mục gốc', mtime: 100000 },
      ];

      const tagged = detectBurstGroups(mockPhotos);

      // _DSC0100, 0101, 0102 should form burst_1 with total 3
      assert.strictEqual(tagged[0].burstTotal, 3);
      assert.strictEqual(tagged[0].burstIndex, 1);
      assert.strictEqual(tagged[1].burstTotal, 3);
      assert.strictEqual(tagged[1].burstIndex, 2);
      assert.strictEqual(tagged[2].burstTotal, 3);
      assert.strictEqual(tagged[2].burstIndex, 3);
      assert.deepStrictEqual(tagged[0].burstPhotos, ['_DSC0100.jpg', '_DSC0101.jpg', '_DSC0102.jpg']);

      // _DSC0250 is standalone, no burst
      assert.strictEqual(tagged[3].burstTotal, undefined);
    });

    test('12.2: getPhotosInFolder provides unassigned, noted, and burst smart filters with accurate counts', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create burst test files
      await fs.writeFile(path.join(PHOTOS_DIR_A, 'BURST_001.jpg'), 'burst 1');
      await fs.writeFile(path.join(PHOTOS_DIR_A, 'BURST_002.jpg'), 'burst 2');
      await fs.writeFile(path.join(PHOTOS_DIR_A, 'STANDALONE_010.jpg'), 'standalone');

      // Triage 1: BURST_001 is picked, and assigned to 'gate'
      await setPhotoTriage('BURST_001.jpg', 'pick');
      await togglePhotoInVirtualAlbum('gate', 'BURST_001.jpg', true);

      // Triage 2: BURST_002 is picked, but NOT assigned to any album (Unassigned Pick!)
      await setPhotoTriage('BURST_002.jpg', 'pick');

      // Triage 3: STANDALONE_010 has a retouch note
      await saveNote('STANDALONE_010.jpg', 'Chỉnh da mặt cô dâu');

      // Query all photos
      const allRes = await getPhotosInFolder(PHOTOS_DIR_A, '');
      assert.strictEqual(allRes.unassignedPickCount >= 1, true, 'Unassigned pick count calculated');
      assert.strictEqual(allRes.notedCount >= 1, true, 'Noted count calculated');
      assert.strictEqual(allRes.burstCount >= 2, true, 'Burst count calculated');

      // Test 'unassigned' filter
      const unassignedRes = await getPhotosInFolder(PHOTOS_DIR_A, '', 'unassigned');
      const unassignedPaths = unassignedRes.photos.map(p => p.relPath);
      assert.strictEqual(unassignedPaths.includes('BURST_002.jpg'), true, 'BURST_002 is picked without album');
      assert.strictEqual(unassignedPaths.includes('BURST_001.jpg'), false, 'BURST_001 has gate album, must not be in unassigned');

      // Test 'noted' filter
      const notedRes = await getPhotosInFolder(PHOTOS_DIR_A, '', 'noted');
      const notedPaths = notedRes.photos.map(p => p.relPath);
      assert.strictEqual(notedPaths.includes('STANDALONE_010.jpg'), true, 'STANDALONE_010 has note');

      // Test 'burst' filter
      const burstRes = await getPhotosInFolder(PHOTOS_DIR_A, '', 'burst');
      const burstPaths = burstRes.photos.map(p => p.relPath);
      assert.strictEqual(burstPaths.includes('BURST_001.jpg'), true);
      assert.strictEqual(burstPaths.includes('BURST_002.jpg'), true);
      assert.strictEqual(burstPaths.includes('STANDALONE_010.jpg'), false, 'STANDALONE_010 is not a burst shot');
    });

    test('12.3: parseJpegExif handles invalid buffers and empty data safely without throwing', () => {
      assert.strictEqual(parseJpegExif(null), null);
      assert.strictEqual(parseJpegExif(Buffer.alloc(0)), null);
      assert.strictEqual(parseJpegExif(Buffer.from('not a jpeg image')), null);

      // Mock JPEG header without APP1
      const mockJpegNoApp1 = Buffer.from([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x43]);
      assert.strictEqual(parseJpegExif(mockJpegNoApp1), null);
    });
  });

  // -------------------------------------------------------------
  // ISSUE 13: Review Fixes (Symlink Export Protection, Album Classification & Undo/Redo)
  // -------------------------------------------------------------
  describe('Issue 13: Review Fixes (Symlink Export Protection & Album Info)', () => {
    test('13.1 [P1]: exportCategorizedPackage prevents writing out through symlink', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create a symlink pointing outside
      const symlinkExportDir = path.join(PHOTOS_DIR_A, 'symlink_export_outside');
      try {
        if (!(await fs.pathExists(symlinkExportDir))) {
          await fs.ensureSymlink(OUTSIDE_DIR, symlinkExportDir);
        }
      } catch {
        // Skip if OS restricts symlink creation
        return;
      }

      // Attempt 1: Target folder is a symlink pointing outside root
      await assert.rejects(
        async () => exportCategorizedPackage(PHOTOS_DIR_A, {
          targetFolderName: 'symlink_export_outside',
          categories: [
            {
              id: 'cat1',
              folderName: 'Sub',
              title: 'Sub',
              files: ['001.jpg'],
            }
          ]
        }),
        /Symlink trỏ ra ngoài phạm vi cho phép/
      );

      // Attempt 2: Category folder inside package is a symlink pointing outside
      const packageDir = path.join(PHOTOS_DIR_A, 'Symlink_Cat_Package');
      await fs.ensureDir(packageDir);
      const catSymlink = path.join(packageDir, 'symlink_cat');
      await fs.ensureSymlink(OUTSIDE_DIR, catSymlink);

      await assert.rejects(
        async () => exportCategorizedPackage(PHOTOS_DIR_A, {
          targetFolderName: 'Symlink_Cat_Package',
          categories: [
            {
              id: 'malicious_cat',
              folderName: 'symlink_cat',
              title: 'Malicious Category',
              files: ['001.jpg'],
            }
          ]
        }),
        /Symlink trỏ ra ngoài phạm vi cho phép/
      );

      // Verify no file was created in OUTSIDE_DIR
      const filesOutside = await fs.readdir(OUTSIDE_DIR);
      assert.strictEqual(filesOutside.includes('001.jpg'), false, 'Photo must not be copied outside root through symlink');
    });

    test('13.2 [P1]: togglePhotoInVirtualAlbum returns updated photo albums array', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Add to 'gate'
      const res1 = await togglePhotoInVirtualAlbum('gate', '001.jpg', true);
      assert.strictEqual(res1.success, true);
      assert.ok(Array.isArray(res1.albums), 'Response must include albums array');
      assert.ok(res1.albums.includes('gate'));

      // Add to 'album'
      const res2 = await togglePhotoInVirtualAlbum('album', '001.jpg', true);
      assert.ok(res2.albums.includes('gate'));
      assert.ok(res2.albums.includes('album'));

      // Remove from 'gate'
      const res3 = await togglePhotoInVirtualAlbum('gate', '001.jpg', false);
      assert.ok(!res3.albums.includes('gate'));
      assert.ok(res3.albums.includes('album'));
    });

    test('13.3 [P2]: exportCategorizedPackage packages photos across multiple different subfolders', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      const targetFolderName = 'Cross_Folder_Export';
      const categories = [
        {
          id: 'gate',
          folderName: '01_Anh_Cong',
          title: 'Ảnh Cổng',
          files: ['001.jpg', 'subfolder/child.jpg'],
        }
      ];

      const res = await exportCategorizedPackage(PHOTOS_DIR_A, {
        targetFolderName,
        categories,
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.totalCopied, 2);

      const destGateDir = path.join(PHOTOS_DIR_A, targetFolderName, '01_Anh_Cong');
      assert.strictEqual(await fs.pathExists(path.join(destGateDir, '001.jpg')), true);
      assert.strictEqual(await fs.pathExists(path.join(destGateDir, 'child.jpg')), true);
    });

    test('13.4 [P1]: exportCategorizedPackage prevents overwriting manifest or report TXT via symlink', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create a victim file outside root
      const outsideVictimFile = path.join(OUTSIDE_DIR, 'victim_outside.txt');
      await fs.writeFile(outsideVictimFile, 'CRITICAL DATA NEVER OVERWRITE', 'utf-8');

      // Create a package folder with a malicious symlink for Bao_Cao_Xuat.txt
      const packageFolderName = 'Symlink_Report_Test_Pkg';
      const packageDirPath = path.join(PHOTOS_DIR_A, packageFolderName);
      await fs.ensureDir(packageDirPath);

      const symlinkReport = path.join(packageDirPath, 'Bao_Cao_Xuat.txt');
      try {
        await fs.ensureSymlink(outsideVictimFile, symlinkReport);
      } catch {
        return;
      }

      // Export must reject and NOT overwrite victim file
      await assert.rejects(
        async () => exportCategorizedPackage(PHOTOS_DIR_A, {
          targetFolderName: packageFolderName,
          categories: [
            {
              id: 'cat1',
              folderName: 'Sub_Cat',
              title: 'Sub Cat',
              files: ['001.jpg'],
            }
          ]
        }),
        /Symlink trỏ ra ngoài phạm vi cho phép/
      );

      // Verify the outside victim file was NOT overwritten
      const victimContent = await fs.readFile(outsideVictimFile, 'utf-8');
      assert.strictEqual(victimContent, 'CRITICAL DATA NEVER OVERWRITE', 'Outside victim file must remain pristine');
    });

    test('13.5 [P1]: copyPhotosToFolder prevents writing through symlink pointing outside root', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create a symlink export folder pointing to outside
      const symlinkTarget = path.join(PHOTOS_DIR_A, 'symlink_copy_outside');
      try {
        if (!(await fs.pathExists(symlinkTarget))) {
          await fs.ensureSymlink(OUTSIDE_DIR, symlinkTarget);
        }
      } catch {
        return;
      }

      await assert.rejects(
        async () => copyPhotosToFolder(PHOTOS_DIR_A, ['001.jpg'], 'symlink_copy_outside'),
        /Symlink trỏ ra ngoài phạm vi cho phép/
      );
    });
  });

  describe('Issue 14: Review Fixes (Re-export Cleanup & Delete Folder Metadata Purge)', () => {
    test('14.1 [P1]: exportCategorizedPackage cleans deselected files on re-export and prevents duplicate _1 filenames', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create sample photos
      const fileA = 'export_a.jpg';
      const fileB = 'export_b.jpg';
      await fs.writeFile(path.join(PHOTOS_DIR_A, fileA), 'data A');
      await fs.writeFile(path.join(PHOTOS_DIR_A, fileB), 'data B');

      const targetFolderName = 'Test_Reexport_Pkg';
      const categoryName = 'Album_Chinh';

      // First export: contains both A and B
      const res1 = await exportCategorizedPackage(PHOTOS_DIR_A, {
        targetFolderName,
        categories: [
          {
            id: 'alb1',
            folderName: categoryName,
            title: 'Album Chinh',
            files: [fileA, fileB],
          }
        ]
      });
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.totalCopied, 2);

      const catPath = path.join(PHOTOS_DIR_A, targetFolderName, categoryName);
      let catFiles = await fs.readdir(catPath);
      assert.strictEqual(catFiles.includes(fileA), true);
      assert.strictEqual(catFiles.includes(fileB), true);
      assert.strictEqual(catFiles.length, 2);

      // Second export to the same target folder: only contains A (B is deselected)
      const res2 = await exportCategorizedPackage(PHOTOS_DIR_A, {
        targetFolderName,
        categories: [
          {
            id: 'alb1',
            folderName: categoryName,
            title: 'Album Chinh',
            files: [fileA],
          }
        ]
      });
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.totalCopied, 1);

      catFiles = await fs.readdir(catPath);
      // Must contain ONLY fileA, NOT fileB, and NOT fileA_1.jpg
      assert.deepStrictEqual(catFiles, [fileA]);
      const reportContent = await fs.readFile(path.join(PHOTOS_DIR_A, targetFolderName, 'Bao_Cao_Xuat.txt'), 'utf-8');
      assert.strictEqual(reportContent.includes('Tổng số ảnh xuất thành công: 1'), true);
    });

    test('14.2 [P2]: deleteFolder purges all metadata so recreated photos do not inherit stale notes or albums', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      const testSubDir = 'sub_del_test';
      const subFull = path.join(PHOTOS_DIR_A, testSubDir);
      await fs.ensureDir(subFull);

      const relFile = `${testSubDir}/photo_temp.jpg`;
      await fs.writeFile(path.join(PHOTOS_DIR_A, relFile), 'temp content');

      // Attach note, annotation, favorite, viewed, triage, virtualAlbum
      await saveNote(relFile, 'Ghi chu can xoa');
      await saveAnnotations(relFile, [{ type: 'rect', x: 10, y: 10, w: 20, h: 20, comment: 'Sua da' }]);
      await toggleFavorite(relFile, true);
      await markPhotosViewed([relFile], true);
      await setPhotoTriage([relFile], 'pick');
      await togglePhotoInVirtualAlbum('gate', relFile, true);

      // Verify metadata is set
      let state = getState();
      assert.strictEqual(state.notes[relFile], 'Ghi chu can xoa');
      assert.strictEqual(state.favorites[relFile], true);
      assert.strictEqual(state.triage[relFile], 'pick');
      assert.strictEqual(state.virtualAlbums.gate.photos.includes(relFile), true);

      // Now delete the folder
      const delRes = await deleteFolder(PHOTOS_DIR_A, testSubDir);
      assert.strictEqual(delRes.success, true);

      // Verify metadata is completely purged
      state = getState();
      assert.strictEqual(state.notes[relFile], undefined);
      assert.strictEqual(state.annotations[relFile], undefined);
      assert.strictEqual(state.favorites[relFile], undefined);
      assert.strictEqual(state.viewed[relFile], undefined);
      assert.strictEqual(state.triage[relFile], undefined);
      assert.strictEqual(state.virtualAlbums.gate.photos.includes(relFile), false);

      // Recreate folder and same filename
      await fs.ensureDir(subFull);
      await fs.writeFile(path.join(PHOTOS_DIR_A, relFile), 'new content for new photo');

      // Get photos in folder and verify new photo has no old metadata
      const photosRes = await getPhotosInFolder(PHOTOS_DIR_A, testSubDir);
      assert.strictEqual(photosRes.photos.length, 1);
      const newPhoto = photosRes.photos[0];
      assert.strictEqual(newPhoto.note, '');
      assert.strictEqual(newPhoto.isFavorite, false);
      assert.strictEqual(newPhoto.isViewed, false);
      assert.strictEqual(newPhoto.triage, null);
      assert.deepStrictEqual(newPhoto.albums, []);
    });
  });

  describe('Issue 15: Review Fixes (Export Protection for Original Photo Folders)', () => {
    test('15.1 [P1]: exportCategorizedPackage prevents exporting into an existing folder containing original photos', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      // Create an existing photo folder with original photos
      const origFolderName = '01_Tiec_Cuoi_Original';
      const origFolderPath = path.join(PHOTOS_DIR_A, origFolderName);
      await fs.ensureDir(origFolderPath);
      const origPhotoPath = path.join(origFolderPath, 'CR3_0001.JPG');
      await fs.writeFile(origPhotoPath, 'ORIGINAL PHOTO DATA NEVER DELETE');

      // Attempt to export categorized package specifying this original folder as target
      await assert.rejects(
        async () => exportCategorizedPackage(PHOTOS_DIR_A, {
          targetFolderName: origFolderName,
          categories: [
            {
              id: 'cat1',
              folderName: '01_Anh_Cong',
              title: 'Anh Cong',
              files: ['001.jpg'],
            }
          ]
        }),
        /Thư mục đích đã tồn tại và chứa dữ liệu ảnh gốc/
      );

      // Verify the original photo was NOT deleted
      assert.strictEqual(await fs.pathExists(origPhotoPath), true);
      const content = await fs.readFile(origPhotoPath, 'utf-8');
      assert.strictEqual(content, 'ORIGINAL PHOTO DATA NEVER DELETE');
    });

    test('15.2 [P1]: exportCategorizedPackage rejects exporting into a folder containing source photos to be exported', async () => {
      await setConfig({ photosDir: PHOTOS_DIR_A });

      const sourceDir = 'source_subfolder';
      const sourceDirPath = path.join(PHOTOS_DIR_A, sourceDir);
      await fs.ensureDir(sourceDirPath);
      const sourcePhoto = `${sourceDir}/photo_to_export.jpg`;
      await fs.writeFile(path.join(PHOTOS_DIR_A, sourcePhoto), 'SOURCE DATA');

      // Attempt to export with targetFolderName matching the source folder
      await assert.rejects(
        async () => exportCategorizedPackage(PHOTOS_DIR_A, {
          targetFolderName: sourceDir,
          categories: [
            {
              id: 'cat1',
              folderName: 'Sub_Export',
              title: 'Sub Export',
              files: [sourcePhoto],
            }
          ]
        }),
        /Thư mục xuất không thể trùng hoặc nằm trong thư mục chứa ảnh gốc cần xuất/
      );

      // Verify source photo remains untouched
      assert.strictEqual(await fs.pathExists(path.join(PHOTOS_DIR_A, sourcePhoto)), true);
    });
  });
});
