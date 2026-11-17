import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { 
  initStorage, 
  getState, 
  getConfig, 
  setConfig, 
  markPhotosViewed, 
  resetCollectionViewed,
  toggleFavorite, 
  saveNote,
  saveAnnotations,
  setPhotoTriage,
  togglePhotoInVirtualAlbum,
  setPhotoAlbumMembership,
  createVirtualAlbum,
  deleteVirtualAlbum,
  updateAlbumQuota,
  saveSession,
  exportCollectionBackup,
  previewCollectionRestore,
  restoreCollectionBackup
} from './storage.js';
import { scanDuplicatePhotos } from './duplicateScan.js';
import { 
  initThumbnailCache, 
  getThumbnail,
  getReadyPreview,
  warmThumbnails,
} from './thumbnailService.js';
import { 
  getFolderTree, 
  getPhotosInFolder, 
  packPhotoBursts,
  createFolder, 
  renameFolder, 
  deleteFolder, 
  movePhotos,
  movePhotoGroups,
  undoPhotoMove,
  copyPhotosToFolder,
  exportCategorizedPackage,
  assertWithinRoot,
  isImageFile
} from './fileManager.js';

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = '127.0.0.1'; // Strictly bound to loopback for security

// Control CORS origin strictly to local origins
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Chặn bởi chính sách CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Initialize services
await initStorage();
await initThumbnailCache();

// 1. Config & Status
app.get('/api/config', async (req, res) => {
  const config = getConfig();
  const state = getState();
  const viewedCount = Object.keys(state.viewed).length;
  const favoriteCount = Object.keys(state.favorites).length;

  res.json({
    config,
    collectionId: state.collectionId,
    stats: {
      totalViewed: viewedCount,
      totalFavorites: favoriteCount,
      lastUpdated: state.lastUpdated,
    }
  });
});

app.post('/api/config', async (req, res) => {
  try {
    const { photosDir } = req.body;
    if (!photosDir || typeof photosDir !== 'string') {
      return res.status(400).json({ error: 'Đường dẫn thư mục không hợp lệ' });
    }

    const resolved = path.resolve(photosDir.trim());
    await fs.ensureDir(resolved);
    const newConfig = await setConfig({ photosDir: resolved });

    res.json({ success: true, config: newConfig, collectionId: getState().collectionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Browse computer filesystem visually
app.get('/api/browse-filesystem', async (req, res) => {
  try {
    const homedir = os.homedir();
    let targetDir = req.query.dir ? path.resolve(req.query.dir) : homedir;

    if (!(await fs.pathExists(targetDir))) {
      targetDir = homedir;
    }

    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      targetDir = path.dirname(targetDir);
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const folders = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // ignore hidden
      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: path.join(targetDir, entry.name),
        });
      }
    }

    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const quickLocations = [
      { name: '📁 Dự án photos/', path: path.resolve(process.cwd(), 'photos') },
      { name: '🖥️ Desktop', path: path.join(homedir, 'Desktop') },
      { name: '🖼️ Pictures', path: path.join(homedir, 'Pictures') },
      { name: '📥 Downloads', path: path.join(homedir, 'Downloads') },
      { name: '🏠 Home (~)', path: homedir },
    ];

    if (process.platform === 'darwin') {
      quickLocations.push({ name: '💾 Ổ cứng ngoài / USB (/Volumes)', path: '/Volumes' });
    }

    res.json({
      currentDir: targetDir,
      parentDir: path.dirname(targetDir) !== targetDir ? path.dirname(targetDir) : null,
      folders,
      quickLocations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Native macOS folder picker via Finder dialog
app.post('/api/pick-folder-native', async (req, res) => {
  if (process.platform !== 'darwin') {
    return res.status(400).json({ error: 'Chỉ hỗ trợ trên macOS' });
  }
  try {
    const script = `osascript -e 'POSIX path of (choose folder with prompt "Chọn thư mục ảnh cưới:")'`;
    const { stdout } = await execAsync(script);
    const chosen = stdout.trim();
    if (chosen) {
      res.json({ success: true, path: chosen });
    } else {
      res.json({ success: false, cancelled: true });
    }
  } catch (err) {
    res.json({ success: false, cancelled: true, message: 'Đã huỷ chọn' });
  }
});

// 2. Folder tree
app.get('/api/tree', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const tree = await getFolderTree(photosDir);
    res.json({ tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Photos in folder
app.get('/api/photos', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const folder = req.query.folder || '';
    const filter = req.query.filter || 'all';
    const sort = req.query.sort || 'name-asc';

    const result = await getPhotosInFolder(photosDir, folder, filter, sort);
    // Generate the rest of this folder's thumbnails in the background, in display order.
    warmThumbnails(result.photos.map(photo => path.join(photosDir, photo.relPath)));
    res.json(req.query.compactBursts === '1' ? packPhotoBursts(result) : result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/photos/duplicates', async (req, res) => {
  const { photosDir } = getConfig();
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  try {
    const result = await scanDuplicatePhotos(photosDir, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (getConfig().photosDir !== photosDir) {
      return res.status(409).json({ error: 'Thư mục ảnh đã thay đổi. Hãy quét lại.' });
    }
    res.json(result);
  } catch (error) {
    if (!controller.signal.aborted) res.status(500).json({ error: error.message || 'Không thể quét ảnh.' });
  }
});

// 4. Thumbnail & Original Image Streaming (Safe Containment)
async function sendCachedImage(req, res, makeImage) {
  try {
    const { photosDir } = getConfig();
    const relPath = req.query.path;
    if (!relPath) return res.status(400).send('Path is required');

    const fullPath = await assertWithinRoot(photosDir, relPath, { allowRoot: false });
    if (!(await fs.pathExists(fullPath))) {
      return res.status(404).send('File not found');
    }

    const imagePath = await makeImage(fullPath, req);
    if (res.headersSent) return;
    if (imagePath && (await fs.pathExists(imagePath))) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.basename(imagePath), { root: path.dirname(imagePath) });
    }

    // Fallback to the original. Not cached by the browser, so the next request
    // for this URL can get the smaller image once it exists.
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(fullPath);
  } catch (err) {
    res.status(err.message.includes('không hợp lệ') ? 400 : 500).send(err.message);
  }
}

app.get('/api/thumbnail', (req, res) => sendCachedImage(req, res, getThumbnail));

// Screen-sized image for Lightbox / Compare; the original is fetched only on zoom.
// ?warm=1 only schedules the preview (Lightbox asks for the next few photos).
app.get('/api/preview', (req, res) => sendCachedImage(req, res, async (fullPath, request) => {
  if (request.query.warm === '1') {
    await getReadyPreview(fullPath, 'low');
    res.status(204).end();
    return null;
  }
  return getReadyPreview(fullPath);
}));

app.get('/api/original', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const relPath = req.query.path;
    if (!relPath) return res.status(400).send('Path is required');

    const fullPath = await assertWithinRoot(photosDir, relPath, { allowRoot: false });
    if (!(await fs.pathExists(fullPath))) {
      return res.status(404).send('File not found');
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(fullPath);
  } catch (err) {
    res.status(err.message.includes('không hợp lệ') ? 400 : 500).send(err.message);
  }
});

// 5. Folder CRUD
app.post('/api/folders/create', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const { parentRelPath = '', name } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên thư mục không được để trống' });

    const result = await createFolder(photosDir, parentRelPath, name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/folders/rename', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const { folderRelPath, newName } = req.body;
    if (!folderRelPath || !newName) {
      return res.status(400).json({ error: 'Thiếu thông tin đổi tên thư mục' });
    }

    const result = await renameFolder(photosDir, folderRelPath, newName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/folders/delete', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const { folderRelPath } = req.body;
    if (!folderRelPath) return res.status(400).json({ error: 'Thiếu đường dẫn thư mục' });

    const result = await deleteFolder(photosDir, folderRelPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Photo Operations (Move, Viewed, Favorite, Note)
app.post('/api/photos/move', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const { files, targetFolder = '', groups } = req.body;
    if (Array.isArray(groups)) {
      const valid = groups.length > 0 && groups.every(group =>
        Array.isArray(group?.files) && group.files.length > 0 && group.files.every(file => typeof file === 'string') &&
        typeof (group.targetFolder ?? '') === 'string');
      if (!valid) return res.status(400).json({ error: 'Danh sách nhóm ảnh cần chuyển không hợp lệ' });
      return res.json(await movePhotoGroups(photosDir, groups));
    }
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Danh sách ảnh cần chuyển không hợp lệ' });
    }

    const result = await movePhotos(photosDir, files, targetFolder);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos/move/undo', async (req, res) => {
  try {
    const { undoToken } = req.body || {};
    if (typeof undoToken !== 'string' || !undoToken.trim()) {
      return res.status(400).json({ error: 'Mã hoàn tác không hợp lệ' });
    }

    const { photosDir } = getConfig();
    const result = await undoPhotoMove(photosDir, undoToken);
    if (!result) {
      return res.status(404).json({ error: 'Lần di chuyển này không còn có thể hoàn tác', remainingCount: 0 });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos/copy-export', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const { files, targetFolderName = 'Gui_Studio_In' } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Danh sách ảnh không hợp lệ' });
    }

    const result = await copyPhotosToFolder(photosDir, files, targetFolderName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos/viewed', async (req, res) => {
  try {
    const { files, viewed = true } = req.body;
    const fileList = Array.isArray(files) ? files : [files];
    const result = await markPhotosViewed(fileList, viewed);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos/viewed/reset', async (req, res) => {
  try {
    res.json(await resetCollectionViewed(req.body?.collectionId));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/photos/favorite', async (req, res) => {
  try {
    const { file, favorite } = req.body;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const result = await toggleFavorite(file, favorite);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos/note', async (req, res) => {
  try {
    const { file, note } = req.body;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const result = await saveNote(file, note);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos/annotations', async (req, res) => {
  try {
    const { file, annotations } = req.body;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const result = await saveAnnotations(file, annotations);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Triage rating: 'pick', 'maybe', 'reject', or null
app.post('/api/photos/triage', async (req, res) => {
  try {
    const { files, status } = req.body;
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return res.status(400).json({ error: 'Danh sách ảnh không hợp lệ' });

    const result = await setPhotoTriage(fileList, status);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Virtual Album operations
app.post('/api/albums/toggle', async (req, res) => {
  try {
    const { albumId, file, inAlbum = true } = req.body;
    if (!albumId || !file) return res.status(400).json({ error: 'albumId và file là bắt buộc' });

    const result = await togglePhotoInVirtualAlbum(albumId, file, inAlbum);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/albums/membership', async (req, res) => {
  const { albumId, files, inAlbum } = req.body || {};
  if (typeof albumId !== 'string' || !albumId || typeof inAlbum !== 'boolean' ||
      !Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || !file)) {
    return res.status(400).json({ error: 'Album hoặc danh sách ảnh không hợp lệ.' });
  }
  const { photosDir } = getConfig();
  const photoPaths = [];
  try {
    for (const file of new Set(files)) {
      const fullPath = await assertWithinRoot(photosDir, file);
      if (!isImageFile(fullPath) || !(await fs.lstat(fullPath)).isFile()) {
        return res.status(400).json({ error: 'Danh sách có ảnh không còn trong thư mục.' });
      }
      photoPaths.push(path.relative(photosDir, fullPath).split(path.sep).join('/'));
    }
  } catch {
    return res.status(400).json({ error: 'Danh sách có đường dẫn ảnh không còn hợp lệ.' });
  }
  if (getConfig().photosDir !== photosDir) {
    return res.status(409).json({ error: 'Thư mục ảnh đã thay đổi.' });
  }
  try {
    res.json(await setPhotoAlbumMembership(albumId, photoPaths, inAlbum, photosDir));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/albums/create', async (req, res) => {
  try {
    const { id, name, quota } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'Mã và Tên album là bắt buộc' });

    const result = await createVirtualAlbum(id, name, quota);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/albums/delete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Mã album là bắt buộc' });

    const result = await deleteVirtualAlbum(id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/albums/quota', async (req, res) => {
  try {
    const { albumId, quota } = req.body;
    if (!albumId) return res.status(400).json({ error: 'albumId là bắt buộc' });

    const result = await updateAlbumQuota(albumId, quota);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/photos/export-package', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const { targetFolderName, categories } = req.body;
    const state = getState();
    const metadata = {
      notes: state.notes || {},
      annotations: state.annotations || {},
    };

    const result = await exportCategorizedPackage(photosDir, {
      targetFolderName,
      categories,
      metadata,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Session persistence
app.post('/api/session', async (req, res) => {
  try {
    const { session, photosDir } = req.body;
    if (!session || typeof session !== 'object') {
      return res.status(400).json({ error: 'Dữ liệu phiên làm việc không hợp lệ' });
    }
    if (photosDir !== undefined && photosDir !== getConfig().photosDir) {
      return res.status(409).json({ error: 'Thư mục ảnh đã thay đổi.' });
    }

    const result = await saveSession(session);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get Viewed State JSON content directly
app.get('/api/data/viewed-state', async (req, res) => {
  res.json(getState());
});

app.get('/api/collection-backup', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await exportCollectionBackup(req.query.collectionId));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/collection-backup/preview', async (req, res) => {
  try {
    const { backup, collectionId } = req.body || {};
    res.json(await previewCollectionRestore(backup, collectionId));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/collection-backup/restore', async (req, res) => {
  try {
    const { backup, collectionId, previewToken } = req.body || {};
    res.json(await restoreCollectionBackup(backup, collectionId, previewToken));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// 8. Generate sample photos for testing if empty
app.post('/api/generate-samples', async (req, res) => {
  try {
    const { photosDir } = getConfig();
    const sharpModule = (await import('sharp')).default;

    // Create folders
    const sub1 = path.join(photosDir, '1. Ảnh cổng 60x90');
    const sub2 = path.join(photosDir, '2. Album chính');
    const sub3 = path.join(photosDir, '3. Bàn Gallery');
    await fs.ensureDir(sub1);
    await fs.ensureDir(sub2);
    await fs.ensureDir(sub3);

    // Color palettes for dummy photos
    const colors = [
      { bg: '#fbcfe8', text: '#9d174d', name: 'Anh_Cuoi_01.jpg', label: 'Cô dâu chú rể ngoại cảnh' },
      { bg: '#fed7aa', text: '#9a3412', name: 'Anh_Cuoi_02.jpg', label: 'Khoảnh khắc trao nhẫn' },
      { bg: '#e9d5ff', text: '#6b21a8', name: 'Anh_Cuoi_03.jpg', label: 'Ảnh váy cưới dạ hội' },
      { bg: '#bae6fd', text: '#0369a1', name: 'Anh_Cuoi_04.jpg', label: 'Áo dài truyền thống' },
      { bg: '#fef08a', text: '#854d0e', name: 'Anh_Cuoi_05.jpg', label: 'Nụ cười hạnh phúc' },
      { bg: '#bbf7d0', text: '#166534', name: 'Anh_Cuoi_06.jpg', label: 'Chụp cùng hoa cưới' },
      { bg: '#fecdd3', text: '#9f1239', name: 'Anh_Cuoi_07.jpg', label: 'Studio phông trơn' },
      { bg: '#c7d2fe', text: '#3730a3', name: 'Anh_Cuoi_08.jpg', label: 'Hoàng hôn bãi biển' },
    ];

    for (const item of colors) {
      const filePath = path.join(photosDir, item.name);
      if (!(await fs.pathExists(filePath))) {
        const svg = `
          <svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="${item.bg}"/>
            <circle cx="600" cy="350" r="140" fill="white" opacity="0.6"/>
            <text x="600" y="360" font-family="sans-serif" font-size="48" font-weight="bold" fill="${item.text}" text-anchor="middle">👰 🤵 ${item.name}</text>
            <text x="600" y="440" font-family="sans-serif" font-size="32" fill="${item.text}" text-anchor="middle">${item.label}</text>
            <text x="600" y="700" font-family="sans-serif" font-size="24" fill="#666" text-anchor="middle">Kích thước mẫu test: 1200 x 800</text>
          </svg>
        `;
        await sharpModule(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(filePath);
      }
    }

    res.json({ success: true, message: 'Đã tạo các ảnh mẫu để thử nghiệm!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static client build if it exists
const CLIENT_DIST = path.resolve(process.cwd(), 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Backend server is running on http://${HOST}:${PORT}`);
});
