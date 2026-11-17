import path from 'path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import fs from 'fs-extra';
import { getState, updateMetadataOnMove, updateMetadataOnFolderRename, removeMetadataOnFolderDelete } from './storage.js';
import { readExifFromFile } from './exifParser.js';
import { fileIdentity } from './fileIdentity.js';

// EXIF cache keyed by the file itself (see fileIdentity), kept on disk so a
// restart or a photo move doesn't re-read every photo's header.
const EXIF_CACHE_FILE = path.resolve(process.env.CURATOR_CACHE_DIR || path.join(process.cwd(), '.cache'), 'exif-cache.json');
const EXIF_CACHE_LIMIT = 20000;
let exifCache = null;
let exifSaveTimer = null;

function loadExifCache() {
  if (exifCache) return exifCache;
  exifCache = new Map();
  try {
    const saved = fs.readJsonSync(EXIF_CACHE_FILE, { throws: false });
    if (saved && typeof saved === 'object') {
      for (const [key, value] of Object.entries(saved)) exifCache.set(key, value);
    }
  } catch {
    // A missing or corrupt cache is rebuilt from the photos.
  }
  return exifCache;
}

async function saveExifCache() {
  exifSaveTimer = null;
  const temp = `${EXIF_CACHE_FILE}.${process.pid}.tmp`;
  try {
    await fs.ensureDir(path.dirname(EXIF_CACHE_FILE));
    await fs.writeJson(temp, Object.fromEntries(exifCache));
    await fs.rename(temp, EXIF_CACHE_FILE);
  } catch (error) {
    console.warn('Không thể lưu cache EXIF:', error.message);
    await fs.remove(temp).catch(() => {});
  }
}

async function getPhotoExifCached(fullPath, stats) {
  const cache = loadExifCache();
  const key = fileIdentity(fullPath, stats);
  if (cache.has(key)) {
    // Refresh recency so the size limit drops the least recently seen photos.
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  const exif = (await readExifFromFile(fullPath)) || null;
  cache.set(key, exif);
  while (cache.size > EXIF_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  if (!exifSaveTimer) {
    exifSaveTimer = setTimeout(saveExifCache, 2000);
    exifSaveTimer.unref?.();
  }
  return exif;
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif'
]);

export function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

// Security: Verify path is strictly contained within rootDir and optionally prevent operating on rootDir itself
export async function assertWithinRoot(rootDir, userPath = '', { allowRoot = false } = {}) {
  if (typeof userPath !== 'string' || userPath.includes('\0')) {
    throw new Error('Đường dẫn chứa ký tự không hợp lệ');
  }

  const resolvedRoot = path.resolve(rootDir);
  const realRoot = (await fs.pathExists(resolvedRoot)) ? await fs.realpath(resolvedRoot) : resolvedRoot;

  // Resolve target path relative to resolvedRoot
  const resolvedTarget = path.resolve(resolvedRoot, userPath || '');

  // Root boundary check
  if (resolvedTarget === resolvedRoot) {
    if (!allowRoot) {
      throw new Error('Thao tác không được phép trên thư mục gốc (Root)!');
    }
    return resolvedTarget;
  }

  // Containment check
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Đường dẫn không hợp lệ: Cố ý truy cập ngoài thư mục ảnh (Path Traversal)!');
  }

  // Symlink escape check: verify closest existing ancestor (and target itself if exists)
  let existingAncestor = resolvedTarget;
  while (!(await fs.pathExists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }

  if (await fs.pathExists(existingAncestor)) {
    const realAncestor = await fs.realpath(existingAncestor);
    const realRelative = path.relative(realRoot, realAncestor);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
    }
    if (existingAncestor === resolvedTarget && realAncestor === realRoot && !allowRoot) {
      throw new Error('Thao tác không được phép trên thư mục gốc (Root qua symlink)!');
    }
  }

  return resolvedTarget;
}

// Recursively builds the folder tree with photo counts
export async function getFolderTree(rootDir, relPath = '') {
  const currentDir = await assertWithinRoot(rootDir, relPath, { allowRoot: true });
  if (!(await fs.pathExists(currentDir))) {
    return null;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  let photoCount = 0;
  const children = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden files/.DS_Store
    
    const entryRelPath = relPath ? path.join(relPath, entry.name).replace(/\\/g, '/') : entry.name;
    
    if (entry.isDirectory()) {
      const childTree = await getFolderTree(rootDir, entryRelPath);
      if (childTree) {
        children.push(childTree);
      }
    } else if (entry.isFile() && isImageFile(entry.name)) {
      photoCount++;
    }
  }

  // Sort subfolders alphabetically
  children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  // Calculate total photos in this subtree
  const totalInSubtree = photoCount + children.reduce((sum, c) => sum + (c.totalCount || c.photoCount || 0), 0);
  const folderName = relPath === '' ? 'Tất cả ảnh (Thư mục gốc)' : path.basename(relPath);

  return {
    id: relPath || 'root',
    name: folderName,
    relPath: relPath.replace(/\\/g, '/'),
    photoCount: relPath === '' ? totalInSubtree : photoCount,
    totalCount: totalInSubtree,
    children,
  };
}

// Recursively collect all photo files in a directory and its subdirectories
export async function collectPhotosRecursively(rootDir, currentRelDir = '') {
  const fullDir = path.join(rootDir, currentRelDir);
  if (!(await fs.pathExists(fullDir))) return [];
  const entries = await fs.readdir(fullDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden files/.DS_Store
    const entryRel = currentRelDir 
      ? path.join(currentRelDir, entry.name).replace(/\\/g, '/') 
      : entry.name;

    if (entry.isDirectory()) {
      const subPhotos = await collectPhotosRecursively(rootDir, entryRel);
      results.push(...subPhotos);
    } else if (entry.isFile() && isImageFile(entry.name)) {
      results.push({
        name: entry.name,
        relPath: entryRel,
      });
    }
  }
  return results;
}

// Helper to detect consecutive / burst photo sequences
export function detectBurstGroups(photos) {
  if (!photos || photos.length === 0) return photos;

  function getNumberAndPrefix(filename) {
    const match = filename.match(/^(.*?)(\d+)(\.[^.]+)$/);
    if (!match) return null;
    return {
      prefix: match[1].toLowerCase(),
      num: parseInt(match[2], 10),
      ext: match[3].toLowerCase(),
    };
  }

  // Work on photos grouped by folder
  const burstGroups = [];
  let currentGroup = [];

  for (let i = 0; i < photos.length; i++) {
    const cur = photos[i];
    const prev = currentGroup.length > 0 ? currentGroup[currentGroup.length - 1] : null;

    if (!prev) {
      currentGroup.push(cur);
      continue;
    }

    const sameFolder = (cur.folder || '') === (prev.folder || '');
    let isBurst = false;

    if (sameFolder) {
      const npCur = getNumberAndPrefix(cur.name);
      const npPrev = getNumberAndPrefix(prev.name);
      const samePrefix = npCur && npPrev && npCur.prefix === npPrev.prefix && npCur.ext === npPrev.ext;

      if (samePrefix) {
        const numDiff = Math.abs(npCur.num - npPrev.num);
        if (numDiff >= 1 && numDiff <= 2) {
          isBurst = true;
        } else {
          // Check timestamp closeness (within 5 seconds) if same sequence prefix
          const timeDiff = Math.abs((cur.mtime || 0) - (prev.mtime || 0));
          if (timeDiff > 0 && timeDiff <= 5000) {
            isBurst = true;
          }
        }
      }
    }

    if (isBurst) {
      currentGroup.push(cur);
    } else {
      if (currentGroup.length >= 2) {
        burstGroups.push([...currentGroup]);
      }
      currentGroup = [cur];
    }
  }

  if (currentGroup.length >= 2) {
    burstGroups.push([...currentGroup]);
  }

  const burstMap = new Map();
  burstGroups.forEach((group, gIdx) => {
    const burstId = `burst_${gIdx + 1}`;
    const total = group.length;
    const paths = group.map(p => p.relPath);
    group.forEach((p, idx) => {
      burstMap.set(p.relPath, {
        burstId,
        burstIndex: idx + 1,
        burstTotal: total,
        burstPhotos: paths,
      });
    });
  });

  return photos.map(p => {
    const b = burstMap.get(p.relPath);
    if (b) {
      return {
        ...p,
        burstId: b.burstId,
        burstIndex: b.burstIndex,
        burstTotal: b.burstTotal,
        burstPhotos: b.burstPhotos,
      };
    }
    return p;
  });
}

export function packPhotoBursts(result) {
  const burstGroups = Object.create(null);
  const photos = result.photos.map(photo => {
    if (!photo.burstId || !photo.burstPhotos) return photo;
    const { burstPhotos, ...compactPhoto } = photo;
    burstGroups[photo.burstId] ??= burstPhotos;
    return compactPhoto;
  });
  return Object.keys(burstGroups).length ? { ...result, photos, burstGroups } : result;
}

// Get photos in a specific folder (or full collection of all photos across all folders when at root)
export async function getPhotosInFolder(rootDir, folderRelPath = '', filter = 'all', sort = 'name-asc') {
  const targetDir = await assertWithinRoot(rootDir, folderRelPath, { allowRoot: true });
  if (!(await fs.pathExists(targetDir))) {
    return { photos: [], totalCount: 0, viewedCount: 0, favoriteCount: 0, pickedCount: 0, maybeCount: 0, rejectedCount: 0 };
  }

  let photoEntries = [];
  if (folderRelPath === '' || !folderRelPath) {
    // Root folder: show FULL all photos across all subfolders!
    photoEntries = await collectPhotosRecursively(rootDir, '');
  } else {
    // Specific folder: show photos inside this folder only
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isFile() || !isImageFile(entry.name)) {
        continue;
      }
      photoEntries.push({
        name: entry.name,
        relPath: path.join(folderRelPath, entry.name).replace(/\\/g, '/'),
      });
    }
  }

  const state = getState();
  const rawPhotos = [];

  for (const entry of photoEntries) {
    const relPath = entry.relPath;
    const fullPath = path.join(rootDir, relPath);
    let stat = null;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    const isViewed = !!state.viewed[relPath];
    const viewedAt = state.viewed[relPath] || null;
    const isFavorite = !!state.favorites[relPath];
    const note = state.notes[relPath] || '';
    const annotations = state.annotations?.[relPath] || [];
    const triage = state.triage?.[relPath] || null;
    const albums = Object.values(state.virtualAlbums || {})
      .filter(a => Array.isArray(a.photos) && a.photos.includes(relPath))
      .map(a => a.id);

    // Read EXIF metadata (cached)
    const exif = await getPhotoExifCached(fullPath, stat);

    // Calculate folder context info
    const folderDir = path.dirname(relPath);
    const folderLabel = (folderDir === '.' || folderDir === '') ? 'Thư mục gốc' : folderDir.replace(/\\/g, ' > ');

    rawPhotos.push({
      name: entry.name,
      relPath,
      folder: folderLabel,
      size: stat.size,
      mtime: stat.mtimeMs,
      isViewed,
      viewedAt,
      isFavorite,
      note,
      annotations,
      triage,
      albums,
      exif,
    });
  }

  // Tag burst / continuous shooting groups
  const photos = detectBurstGroups(rawPhotos);

  // Stats before filtering
  const totalCount = photos.length;
  const viewedCount = photos.filter(p => p.isViewed).length;
  const favoriteCount = photos.filter(p => p.isFavorite).length;
  const pickedCount = photos.filter(p => p.triage === 'pick').length;
  const maybeCount = photos.filter(p => p.triage === 'maybe').length;
  const rejectedCount = photos.filter(p => p.triage === 'reject').length;
  const unassignedPickCount = photos.filter(p => p.triage === 'pick' && (!p.albums || p.albums.length === 0)).length;
  const notedCount = photos.filter(p => (p.note && p.note.trim()) || (p.annotations && p.annotations.length > 0)).length;
  const burstCount = photos.filter(p => p.burstTotal && p.burstTotal >= 2).length;

  // Filter
  let filtered = photos;
  if (filter === 'unviewed') {
    filtered = photos.filter(p => !p.isViewed);
  } else if (filter === 'viewed') {
    filtered = photos.filter(p => p.isViewed);
  } else if (filter === 'favorite') {
    filtered = photos.filter(p => p.isFavorite);
  } else if (filter === 'pick') {
    filtered = photos.filter(p => p.triage === 'pick');
  } else if (filter === 'maybe') {
    filtered = photos.filter(p => p.triage === 'maybe');
  } else if (filter === 'reject') {
    filtered = photos.filter(p => p.triage === 'reject');
  } else if (filter === 'unassigned') {
    filtered = photos.filter(p => p.triage === 'pick' && (!p.albums || p.albums.length === 0));
  } else if (filter === 'noted') {
    filtered = photos.filter(p => (p.note && p.note.trim()) || (p.annotations && p.annotations.length > 0));
  } else if (filter === 'burst') {
    filtered = photos.filter(p => p.burstTotal && p.burstTotal >= 2);
  } else if (filter.startsWith('album:')) {
    const targetAlbumId = filter.slice(6);
    filtered = photos.filter(p => Array.isArray(p.albums) && p.albums.includes(targetAlbumId));
  }

  // Sort
  filtered.sort((a, b) => {
    switch (sort) {
      case 'name-asc':
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'date-desc':
        return b.mtime - a.mtime;
      case 'date-asc':
        return a.mtime - b.mtime;
      case 'size-desc':
        return b.size - a.size;
      default:
        return 0;
    }
  });

  return {
    photos: filtered,
    totalCount,
    viewedCount,
    favoriteCount,
    pickedCount,
    maybeCount,
    rejectedCount,
    unassignedPickCount,
    notedCount,
    burstCount,
    virtualAlbums: state.virtualAlbums || {},
    session: state.session || {},
  };
}

// Create a new subfolder inside a parent folder
export async function createFolder(rootDir, parentRelPath, folderName) {
  const sanitized = folderName.trim().replace(/[\/\\:*?"<>|]/g, '-');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error('Tên thư mục không hợp lệ');
  }

  const parentDir = await assertWithinRoot(rootDir, parentRelPath, { allowRoot: true });
  const targetDir = path.join(parentDir, sanitized);
  await assertWithinRoot(rootDir, path.relative(rootDir, targetDir), { allowRoot: false });

  if (await fs.pathExists(targetDir)) {
    throw new Error(`Thư mục "${sanitized}" đã tồn tại!`);
  }

  await fs.ensureDir(targetDir);
  const createdRelPath = parentRelPath 
    ? path.join(parentRelPath, sanitized).replace(/\\/g, '/') 
    : sanitized;

  return { success: true, relPath: createdRelPath, name: sanitized };
}

// Rename an existing folder
export async function renameFolder(rootDir, folderRelPath, newName) {
  const sanitized = newName.trim().replace(/[\/\\:*?"<>|]/g, '-');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error('Tên thư mục mới không hợp lệ');
  }

  const oldFullPath = await assertWithinRoot(rootDir, folderRelPath, { allowRoot: false });
  if (!(await fs.pathExists(oldFullPath))) {
    throw new Error('Thư mục cũ không tồn tại');
  }

  const parentDir = path.dirname(oldFullPath);
  const newFullPath = path.join(parentDir, sanitized);
  await assertWithinRoot(rootDir, path.relative(rootDir, newFullPath), { allowRoot: false });

  if (await fs.pathExists(newFullPath)) {
    throw new Error(`Thư mục "${sanitized}" đã tồn tại!`);
  }

  await fs.move(oldFullPath, newFullPath);

  const parentRel = path.dirname(folderRelPath) === '.' ? '' : path.dirname(folderRelPath);
  const newRelPath = parentRel 
    ? path.join(parentRel, sanitized).replace(/\\/g, '/') 
    : sanitized;

  await updateMetadataOnFolderRename(folderRelPath, newRelPath);

  return { success: true, newRelPath, name: sanitized };
}

// Delete a folder strictly protecting root and outside directories, and purge its metadata
export async function deleteFolder(rootDir, folderRelPath) {
  const targetDir = await assertWithinRoot(rootDir, folderRelPath, { allowRoot: false });

  if (!(await fs.pathExists(targetDir))) {
    throw new Error('Thư mục không tồn tại');
  }

  await fs.remove(targetDir);
  await removeMetadataOnFolderDelete(folderRelPath);
  return { success: true };
}

const moveUndoRecords = new Map();
const MAX_MOVE_UNDO_RECORDS = 50;
let photoMoveQueue = Promise.resolve();

function queuePhotoMove(operation) {
  const result = photoMoveQueue.then(operation);
  photoMoveQueue = result.catch(() => {});
  return result;
}

const statPhoto = (file) => fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });

function sameFile(actual, expected) {
  return actual?.isFile() && actual.dev === expected.dev && actual.ino === expected.ino &&
    actual.birthtimeNs === expected.birthtimeNs;
}

function samePhoto(actual, expected, compareChangeTime = true) {
  return sameFile(actual, expected) && actual.size === expected.size &&
    actual.mtimeNs === expected.mtimeNs && (!compareChangeTime || actual.ctimeNs === expected.ctimeNs);
}

function changedPhotoError() {
  return Object.assign(new Error('Ảnh đã bị thay đổi, thay thế hoặc di chuyển'), { code: 'PHOTO_CHANGED' });
}

function assertSamePhoto(file, expected, compareChangeTime) {
  if (!samePhoto(statPhoto(file), expected, compareChangeTime)) {
    throw changedPhotoError();
  }
}

// Cross-device moves and filesystems without hard links need an exclusive copy.
async function copyPhotoWithoutReplacing(source, destination, expected) {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  const input = await fs.promises.open(source, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  let output, created, reader, writer;
  try {
    if (!samePhoto(await input.stat({ bigint: true }), expected)) throw changedPhotoError();
    const mode = Number(expected.mode & 0o7777n);
    output = await fs.promises.open(destination, 'wx', mode);
    created = await output.stat({ bigint: true });
    reader = input.createReadStream({ autoClose: false });
    writer = output.createWriteStream({ autoClose: false });
    await pipeline(reader, writer);
    await output.chmod(mode);
    await output.utimes(Number(expected.atimeNs) / 1e9, Number(expected.mtimeNs) / 1e9);
    return await output.stat({ bigint: true });
  } catch (error) {
    if (created && sameFile(statPhoto(destination), created)) fs.unlinkSync(destination);
    throw error;
  } finally {
    reader?.destroy();
    writer?.destroy();
    await Promise.all([input.close(), output?.close()]);
  }
}

// Reserve the destination atomically. rename can overwrite a file that appears
// after an existence check.
async function moveFileWithoutReplacing(source, destination, expected) {
  assertSamePhoto(source, expected);
  let linked = true;
  let created;
  try {
    fs.linkSync(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK'].includes(error.code)) throw error;
    created = await copyPhotoWithoutReplacing(source, destination, expected);
    linked = false;
  }

  if (linked) created = statPhoto(destination);
  try {
    // Creating a hard link changes ctime on the same file.
    assertSamePhoto(source, expected, !linked);
    if (!created || (linked && !samePhoto(created, expected, false)) ||
        !samePhoto(statPhoto(destination), created)) {
      throw Object.assign(new Error('Vị trí đích đã thay đổi trong khi chuyển ảnh'), { code: 'EEXIST' });
    }
    fs.unlinkSync(source);
  } catch (error) {
    const owned = linked ? expected : created;
    if (samePhoto(statPhoto(destination), owned, !linked)) {
      fs.unlinkSync(destination);
    }
    const unchanged = statPhoto(source);
    if (linked && samePhoto(unchanged, expected, false)) error.updatedStats = unchanged;
    throw error;
  }
  const moved = statPhoto(destination);
  return samePhoto(moved, created, !linked) ? moved : null;
}

async function recordMovedMetadata(rootDir, oldPath, newPath, result) {
  try {
    await updateMetadataOnMove(oldPath, newPath, rootDir);
  } catch (error) {
    // The file and in-memory metadata have moved. Report the persistence
    // failure without making the caller retry a move that already happened.
    result.warning = 'Ảnh đã di chuyển nhưng không thể lưu thông tin ảnh xuống ổ đĩa';
    console.error(result.warning, error);
  }
}

// Move photos into a target folder safely.
export function movePhotos(rootDir, photoRelPaths, targetFolderRelPath) {
  return movePhotoGroups(rootDir, [{ files: photoRelPaths, targetFolder: targetFolderRelPath }]);
}

// Move several groups (each into its own folder) as one operation with one undo token.
export function movePhotoGroups(rootDir, groups) {
  return queuePhotoMove(() => movePhotoGroupsInOrder(path.resolve(rootDir), groups));
}

async function movePhotoGroupsInOrder(rootDir, groups) {
  // Validate every destination before touching any file.
  const targets = [];
  for (const group of groups) {
    targets.push(await assertWithinRoot(rootDir, group.targetFolder || '', { allowRoot: true }));
  }

  const results = [];
  const undoEntries = [];
  for (let i = 0; i < groups.length; i++) {
    await fs.ensureDir(targets[i]);
    await movePhotosIntoDir(rootDir, groups[i].files, targets[i], results, undoEntries);
  }

  const response = { success: true, movedCount: results.filter(r => r.success).length, results };
  if (undoEntries.length) {
    const undoToken = randomUUID();
    moveUndoRecords.set(undoToken, { rootDir, entries: undoEntries });
    if (moveUndoRecords.size > MAX_MOVE_UNDO_RECORDS) {
      moveUndoRecords.delete(moveUndoRecords.keys().next().value);
    }
    response.undoToken = undoToken;
  }
  return response;
}

async function movePhotosIntoDir(rootDir, photoRelPaths, targetDir, results, undoEntries) {
  for (const relPath of photoRelPaths) {
    try {
      const oldFullPath = await assertWithinRoot(rootDir, relPath);
      const stats = statPhoto(oldFullPath);
      if (!stats?.isFile()) throw new Error('File ảnh không tồn tại hoặc không hợp lệ');

      const filename = path.basename(oldFullPath);
      let targetFullPath = path.join(targetDir, filename);
      if (targetFullPath === oldFullPath) {
        results.push({ oldPath: relPath, newPath: relPath, success: true });
        continue;
      }

      // If a file with the same name exists, pick a name with a suffix.
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      for (let counter = 1; statPhoto(targetFullPath); counter++) {
        targetFullPath = path.join(targetDir, `${base}_${counter}${ext}`);
      }

      const oldPath = path.relative(rootDir, oldFullPath).split(path.sep).join('/');
      const newPath = path.relative(rootDir, targetFullPath).split(path.sep).join('/');
      const originalParent = fs.realpathSync(path.dirname(oldFullPath));
      const movedParent = fs.realpathSync(path.dirname(targetFullPath));
      const movedStats = await moveFileWithoutReplacing(oldFullPath, targetFullPath, stats);
      const result = { oldPath: relPath, newPath, success: true };
      if (movedStats) undoEntries.push({ oldPath, newPath, originalParent, movedParent, stats: movedStats });
      await recordMovedMetadata(rootDir, oldPath, newPath, result);
      results.push(result);
    } catch (error) {
      results.push({ oldPath: relPath, success: false, error: error.message });
    }
  }
}

export function undoPhotoMove(rootDir, undoToken) {
  return queuePhotoMove(() => undoPhotoMoveInOrder(path.resolve(rootDir), undoToken));
}

async function undoPhotoMoveInOrder(rootDir, undoToken) {
  const record = moveUndoRecords.get(undoToken);
  if (!record || record.rootDir !== rootDir) return null;

  const results = [];
  const remaining = [];
  for (const entry of record.entries) {
    const { oldPath, newPath, originalParent, movedParent, stats } = entry;
    const result = { oldPath: newPath, newPath: oldPath, success: false };
    results.push(result);

    let currentFile;
    try {
      currentFile = await assertWithinRoot(rootDir, newPath);
    } catch (error) {
      result.error = error.message;
      continue;
    }

    try {
      assertSamePhoto(currentFile, stats);
      const originalFile = await assertWithinRoot(rootDir, oldPath);
      if (fs.realpathSync(path.dirname(originalFile)) !== originalParent) {
        throw new Error('Thư mục gốc của ảnh đã thay đổi');
      }
      if (fs.realpathSync(path.dirname(currentFile)) !== movedParent) {
        throw new Error('Thư mục chứa ảnh đã thay đổi');
      }
      if (statPhoto(originalFile)) {
        throw new Error('Vị trí ban đầu đã có tệp khác');
      }
      await moveFileWithoutReplacing(currentFile, originalFile, stats);
      result.success = true;
      await recordMovedMetadata(rootDir, newPath, oldPath, result);
    } catch (error) {
      result.error = error.code === 'EEXIST' ? 'Vị trí ban đầu đã có tệp khác' : error.message;
      if (error.code !== 'PHOTO_CHANGED') {
        if (error.updatedStats) entry.stats = error.updatedStats;
        remaining.push(entry);
      }
    }
  }

  if (remaining.length) record.entries = remaining;
  else moveUndoRecords.delete(undoToken);

  return {
    success: true,
    movedCount: results.filter(r => r.success).length,
    remainingCount: remaining.length,
    results,
  };
}

// Copy photos to an export folder (preserves originals)
export async function copyPhotosToFolder(rootDir, photoRelPaths, targetFolderRelPath = 'Gui_Studio_In') {
  const targetDir = await assertWithinRoot(rootDir, targetFolderRelPath, { allowRoot: false });
  const targetLstat = await fs.lstat(targetDir).catch(() => null);
  if (targetLstat && targetLstat.isSymbolicLink()) {
    throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
  }
  await fs.ensureDir(targetDir);

  const results = [];
  for (const relPath of photoRelPaths) {
    let oldFullPath;
    try {
      oldFullPath = await assertWithinRoot(rootDir, relPath, { allowRoot: false });
    } catch (err) {
      results.push({ oldPath: relPath, success: false, error: err.message });
      continue;
    }

    if (!(await fs.pathExists(oldFullPath))) {
      results.push({ oldPath: relPath, success: false, error: 'File không tồn tại' });
      continue;
    }

    const filename = path.basename(relPath);
    let newFilename = filename;
    let targetFullPath = path.join(targetDir, newFilename);

    if (await fs.pathExists(targetFullPath) && targetFullPath !== oldFullPath) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let counter = 1;
      while (await fs.pathExists(targetFullPath)) {
        newFilename = `${base}_${counter}${ext}`;
        targetFullPath = path.join(targetDir, newFilename);
        counter++;
      }
    }

    const targetRelPath = path.relative(rootDir, targetFullPath);
    await assertWithinRoot(rootDir, targetRelPath, { allowRoot: false });
    const targetFileLstat = await fs.lstat(targetFullPath).catch(() => null);
    if (targetFileLstat && targetFileLstat.isSymbolicLink()) {
      throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
    }

    await fs.copy(oldFullPath, targetFullPath);
    results.push({
      oldPath: relPath,
      newPath: path.join(targetFolderRelPath, newFilename).replace(/\\/g, '/'),
      success: true,
    });
  }

  return {
    success: true,
    copiedCount: results.filter(r => r.success).length,
    targetDir: targetFolderRelPath,
    results,
  };
}

const exportManifestName = '.export_manifest.json';
const exportRetouchName = 'Danh_Sach_Va_Ghi_Chu_Retouch.txt';
const exportReportName = 'Bao_Cao_Xuat.txt';
const exportDocumentNames = [exportRetouchName, exportReportName];

function protectedExportFolderError() {
  return new Error('Thư mục đích đã tồn tại và chứa dữ liệu ảnh gốc hoặc có tệp không thể xác minh nguồn gốc. Vui lòng chọn tên thư mục khác để bảo vệ dữ liệu.');
}

function exportFileIdentity(stats) {
  return stats?.isFile()
    ? [stats.dev, stats.ino, stats.birthtimeNs, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
    : null;
}

const exportOwnershipKey = (relativePath, identity) => `${relativePath.normalize('NFC')}\0${identity}`;

async function writeExportDocument(fullPath, text) {
  const output = await fs.promises.open(fullPath, 'wx');
  try {
    await output.writeFile(text, 'utf-8');
    return exportFileIdentity(await output.stat({ bigint: true }));
  } finally {
    await output.close();
  }
}

function prepareExportFolder(packageDir, activeCategoryNames) {
  const packageStats = statPhoto(packageDir);
  if (!packageStats) {
    fs.mkdirSync(packageDir);
    return;
  }
  if (!packageStats.isDirectory()) throw protectedExportFolderError();

  const entries = fs.readdirSync(packageDir, { withFileTypes: true });
  if (entries.length === 0) return;
  const assertNotSymlink = entry => {
    if (entry.isSymbolicLink()) {
      throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
    }
  };
  entries.forEach(assertNotSymlink);
  const manifestPath = path.join(packageDir, exportManifestName);
  const manifestStats = statPhoto(manifestPath);
  if (!manifestStats?.isFile()) throw protectedExportFolderError();
  let previous;
  try {
    previous = fs.readJsonSync(manifestPath);
  } catch {
    throw protectedExportFolderError();
  }
  // Older manifests identify directories only, which does not establish file ownership.
  if (previous?.version !== 2 || !Array.isArray(previous.categories) ||
      !previous.files || typeof previous.files !== 'object' || Array.isArray(previous.files)) {
    throw protectedExportFolderError();
  }

  const previousOwnership = new Set(Object.entries(previous.files)
    .map(([relativePath, identity]) => exportOwnershipKey(relativePath, identity)));
  const ownedFiles = [];
  const obsoleteDirectories = [];
  const recordOwnedFile = (relativePath) => {
    const fullPath = path.join(packageDir, relativePath);
    const identity = exportFileIdentity(statPhoto(fullPath));
    if (!identity || !previousOwnership.has(exportOwnershipKey(relativePath, identity))) {
      throw protectedExportFolderError();
    }
    ownedFiles.push({ fullPath, identity });
  };
  const previousCategoryNames = new Set(previous.categories
    .filter(name => typeof name === 'string').map(name => name.normalize('NFC')));

  for (const entry of entries) {
    if (entry.name === exportManifestName) continue;
    if (exportDocumentNames.includes(entry.name)) {
      recordOwnedFile(entry.name);
      continue;
    }
    const categoryName = entry.name.normalize('NFC');
    if (!entry.isDirectory() || !previousCategoryNames.has(categoryName)) {
      throw protectedExportFolderError();
    }
    const categoryDir = path.join(packageDir, entry.name);
    for (const child of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      assertNotSymlink(child);
      recordOwnedFile(`${entry.name}/${child.name}`);
    }
    if (!activeCategoryNames.has(categoryName)) obsoleteDirectories.push(categoryDir);
  }

  // Validate every entry before cleanup and remove only individually verified files.
  for (const { fullPath, identity } of ownedFiles) {
    if (exportFileIdentity(statPhoto(fullPath)) !== identity) throw protectedExportFolderError();
    fs.unlinkSync(fullPath);
  }
  for (const directory of obsoleteDirectories) fs.rmdirSync(directory);
  if (exportFileIdentity(statPhoto(manifestPath)) !== exportFileIdentity(manifestStats)) {
    throw protectedExportFolderError();
  }
  fs.unlinkSync(manifestPath);
}

// Serialize export with photo moves so the app cannot move originals into a package during re-export.
export function exportCategorizedPackage(rootDir, options) {
  return queuePhotoMove(() => exportCategorizedPackageInOrder(rootDir, options));
}

async function exportCategorizedPackageInOrder(rootDir, { targetFolderName, categories = [], metadata = {} }) {
  const safeTargetFolderName = (targetFolderName || `Xuat_Anh_Cuoi_${new Date().toISOString().slice(0, 10)}`)
    .trim().replace(/[<>:"/\\|?*]/g, '_');
  
  const packageDir = await assertWithinRoot(rootDir, safeTargetFolderName, { allowRoot: false });
  const pkgLstat = await fs.lstat(packageDir).catch(() => null);
  if (pkgLstat && pkgLstat.isSymbolicLink()) {
    throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
  }

  // Prevent exporting into a directory that contains source photos
  const allSourceRelPaths = categories.flatMap(c => Array.isArray(c.files) ? c.files : []);
  for (const relFile of allSourceRelPaths) {
    const cleanRel = (relFile || '').replace(/\\/g, '/');
    const relativeToPackage = path.relative(packageDir, path.resolve(rootDir, cleanRel));
    if (!relativeToPackage || (!relativeToPackage.startsWith(`..${path.sep}`) && relativeToPackage !== '..' && !path.isAbsolute(relativeToPackage))) {
      throw new Error('Thư mục xuất không thể trùng hoặc nằm trong thư mục chứa ảnh gốc cần xuất!');
    }
  }

  const activeCategories = categories.filter(cat => Array.isArray(cat.files) && cat.files.length > 0)
    .map(cat => ({ ...cat, folderName: (cat.folderName || cat.id || 'Chua_Phan_Loai').trim().replace(/[<>:"/\\|?*]/g, '_') }));
  const usedNames = new Set([exportManifestName, ...exportDocumentNames].map(name => name.toLowerCase()));
  for (const { folderName } of activeCategories) {
    const key = folderName.normalize('NFC').toLowerCase();
    if (!key || key === '.' || key === '..' || key.includes('\0') || usedNames.has(key)) {
      throw new Error('Tên thư mục hạng mục không hợp lệ hoặc bị trùng.');
    }
    usedNames.add(key);
  }
  prepareExportFolder(packageDir, new Set(activeCategories.map(cat => cat.folderName.normalize('NFC'))));

  const categoriesSummary = [];
  const failedFiles = [];
  const ownedFiles = Object.create(null);
  let totalCopied = 0;
  let manifestText = `DANH SÁCH ẢNH VÀ GHI CHÚ RETOUCH\nNgày xuất: ${new Date().toLocaleString('vi-VN')}\nThư mục xuất: ${safeTargetFolderName}\n${'='.repeat(60)}\n\n`;

  for (const cat of activeCategories) {
    const { files: catFiles, folderName: safeCatDirName } = cat;
    const catRelPath = path.relative(rootDir, path.join(packageDir, safeCatDirName));
    const catFullPath = await assertWithinRoot(rootDir, catRelPath, { allowRoot: false });
    const catLstat = await fs.lstat(catFullPath).catch(() => null);
    if (catLstat && catLstat.isSymbolicLink()) {
      throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
    }
    await fs.ensureDir(catFullPath);

    let catCopied = 0;
    manifestText += `### [${cat.title || safeCatDirName}] - Thư mục: ${safeCatDirName}/ (${catFiles.length} ảnh)\n`;

    for (const relPath of catFiles) {
      let srcFullPath;
      try {
        srcFullPath = await assertWithinRoot(rootDir, relPath, { allowRoot: false });
      } catch (err) {
        failedFiles.push({ category: cat.title || safeCatDirName, file: relPath, error: err.message });
        continue;
      }

      const filename = path.basename(relPath);
      let newFilename = filename;
      let targetFullPath = path.join(catFullPath, newFilename);

      if (await fs.pathExists(targetFullPath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        let counter = 1;
        while (await fs.pathExists(targetFullPath)) {
          newFilename = `${base}_${counter}${ext}`;
          targetFullPath = path.join(catFullPath, newFilename);
          counter++;
        }
      }

      const targetRelPath = path.relative(rootDir, targetFullPath);
      await assertWithinRoot(rootDir, targetRelPath, { allowRoot: false });
      const targetLstat = await fs.lstat(targetFullPath).catch(() => null);
      if (targetLstat && targetLstat.isSymbolicLink()) {
        throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
      }

      try {
        const sourceStats = statPhoto(srcFullPath);
        if (!sourceStats?.isFile()) throw new Error('File ảnh gốc không tồn tại trên đĩa hoặc không hợp lệ');
        const copyStats = await copyPhotoWithoutReplacing(srcFullPath, targetFullPath, sourceStats);
        ownedFiles[`${safeCatDirName}/${newFilename}`] = exportFileIdentity(copyStats);
        catCopied++;
        totalCopied++;

        const note = metadata.notes ? metadata.notes[relPath] : null;
        const annotations = metadata.annotations ? metadata.annotations[relPath] : null;
        manifestText += ` - ${newFilename}`;
        if (note) manifestText += ` | Ghi chú: ${note}`;
        if (annotations && annotations.length > 0) {
          const annoPoints = annotations.map((a, i) => `#${a.number || (i + 1)}: ${a.text || 'Ghi chú'}`).join('; ');
          manifestText += ` | Điểm retouch: [${annoPoints}]`;
        }
        manifestText += '\n';
      } catch (err) {
        failedFiles.push({ category: cat.title || safeCatDirName, file: relPath, error: err.message });
      }
    }

    manifestText += '\n';
    categoriesSummary.push({
      category: cat.title || safeCatDirName,
      folder: safeCatDirName,
      total: catFiles.length,
      copied: catCopied,
      failed: catFiles.length - catCopied,
    });
  }

  // Write Manifest TXT
  const manifestFullPath = path.join(packageDir, exportRetouchName);
  const manifestRelPath = path.relative(rootDir, manifestFullPath);
  await assertWithinRoot(rootDir, manifestRelPath, { allowRoot: false });
  const manifestLstat = await fs.lstat(manifestFullPath).catch(() => null);
  if (manifestLstat && manifestLstat.isSymbolicLink()) {
    throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
  }
  ownedFiles[exportRetouchName] = await writeExportDocument(manifestFullPath, manifestText);

  // Write Failure / Success Report TXT
  let reportText = `BÁO CÁO XUẤT GÓI ẢNH CƯỚI\nThời gian: ${new Date().toLocaleString('vi-VN')}\nThư mục: ${safeTargetFolderName}\n`;
  reportText += `Tổng số ảnh xuất thành công: ${totalCopied}\n`;
  reportText += `Tổng số ảnh lỗi: ${failedFiles.length}\n\n`;
  reportText += `--- CHI TIẾT THEO MỤC ĐÍCH ---\n`;
  for (const summary of categoriesSummary) {
    reportText += `- ${summary.category}: ${summary.copied}/${summary.total} ảnh\n`;
  }

  if (failedFiles.length > 0) {
    reportText += `\n--- DANH SÁCH ẢNH XUẤT THẤT BẠI ---\n`;
    failedFiles.forEach((f, idx) => {
      reportText += `${idx + 1}. [${f.category}] ${f.file} -> Lỗi: ${f.error}\n`;
    });
  } else {
    reportText += `\nTrạng thái: 100% ảnh xuất thành công, không có file lỗi.\n`;
  }

  const reportFullPath = path.join(packageDir, exportReportName);
  const reportRelPath = path.relative(rootDir, reportFullPath);
  await assertWithinRoot(rootDir, reportRelPath, { allowRoot: false });
  const reportLstat = await fs.lstat(reportFullPath).catch(() => null);
  if (reportLstat && reportLstat.isSymbolicLink()) {
    throw new Error('Đường dẫn không hợp lệ: Symlink trỏ ra ngoài phạm vi cho phép!');
  }
  ownedFiles[exportReportName] = await writeExportDocument(reportFullPath, reportText);

  // Record ownership of every file the exporter successfully created.
  await fs.writeJson(path.join(packageDir, exportManifestName), {
    version: 2,
    categories: categoriesSummary.map(c => c.folder),
    files: ownedFiles,
    exportedAt: new Date().toISOString(),
    totalCopied,
  }, { spaces: 2, flag: 'wx' });

  return {
    success: true,
    targetDir: safeTargetFolderName,
    totalCopied,
    totalFailed: failedFiles.length,
    failedFiles,
    categoriesSummary,
  };
}
