import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { buildCollectionBackup, buildRestorePlan, validateCollectionBackup } from './collectionBackup.js';
import { fromProjectRoot } from './paths.js';

let dataDir = fromProjectRoot(process.env.DATA_DIR || 'data');
let STATE_FILE = path.join(dataDir, 'viewed_state.json');
let CONFIG_FILE = path.join(dataDir, 'config.json');
let collectionGeneration = 0;
const restoreSecret = crypto.randomBytes(32);

export function setDataDir(customDir) {
  collectionGeneration++;
  dataDir = path.resolve(customDir);
  STATE_FILE = path.join(dataDir, 'viewed_state.json');
  CONFIG_FILE = path.join(dataDir, 'config.json');
}

export function getDataDir() {
  return dataDir;
}

export function getStateFilePath() {
  return STATE_FILE;
}

export const DEFAULT_VIRTUAL_ALBUMS = {
  gate: { id: 'gate', name: 'Ảnh cổng', quota: 1, photos: [] },
  album: { id: 'album', name: 'Album cưới', quota: 35, photos: [] },
  table: { id: 'table', name: 'Ảnh để bàn', quota: 5, photos: [] },
  slide: { id: 'slide', name: 'Slide tiệc cưới', quota: 30, photos: [] },
};

// Default initial state with collections support
let state = {
  version: 2,
  lastUpdated: new Date().toISOString(),
  collections: {}, // { [collectionId]: { photosDir, name, viewed, favorites, notes, annotations, triage, virtualAlbums, session } }
};

let config = {
  photosDir: fromProjectRoot('photos'),
};

export function getCollectionId(dirPath) {
  const normalized = path.resolve(dirPath).toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function getActiveCollection(photosDir = config.photosDir) {
  const colId = getCollectionId(photosDir);
  if (!state.collections[colId]) {
    state.collections[colId] = {
      photosDir,
      name: path.basename(photosDir) || 'photos',
      viewed: {},
      favorites: {},
      notes: {},
      annotations: {},
      triage: {},
      virtualAlbums: JSON.parse(JSON.stringify(DEFAULT_VIRTUAL_ALBUMS)),
      session: { lastActivePhoto: null, activeFolder: '', activeFilter: 'all', viewMode: 'grid-md' },
    };
  }
  const col = state.collections[colId];
  if (!col.viewed) col.viewed = {};
  if (!col.favorites) col.favorites = {};
  if (!col.notes) col.notes = {};
  if (!col.annotations) col.annotations = {};
  if (!col.triage) col.triage = {};
  if (!col.virtualAlbums) col.virtualAlbums = JSON.parse(JSON.stringify(DEFAULT_VIRTUAL_ALBUMS));
  if (!col.session) col.session = { lastActivePhoto: null, activeFolder: '', activeFilter: 'all', viewMode: 'grid-md' };
  return col;
}

export async function initStorage(options = {}) {
  collectionGeneration++;
  if (options.dataDir) {
    setDataDir(options.dataDir);
  }
  if (options.photosDir) {
    config.photosDir = path.resolve(options.photosDir);
  }

  await fs.ensureDir(dataDir);
  await removeStaleTempFiles();
  
  // 1. Load config
  if (await fs.pathExists(CONFIG_FILE)) {
    try {
      const savedConfig = await fs.readJson(CONFIG_FILE);
      config = { ...config, ...savedConfig };
      if (options.photosDir) {
        config.photosDir = path.resolve(options.photosDir);
      }
    } catch (err) {
      console.error('Lỗi khi đọc config.json:', err);
    }
  } else {
    await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
  }

  // Ensure photosDir exists
  await fs.ensureDir(config.photosDir);

  // 2. Load viewed state
  let loaded = false;
  if (await fs.pathExists(STATE_FILE)) {
    try {
      const savedState = await fs.readJson(STATE_FILE);

      // Migration from Version 1 (flat state) to Version 2 (collection-namespaced)
      if (savedState && (savedState.version === 1 || (!savedState.collections && savedState.viewed))) {
        const colId = getCollectionId(config.photosDir);
        state = {
          version: 2,
          lastUpdated: savedState.lastUpdated || new Date().toISOString(),
          collections: {
            [colId]: {
              photosDir: config.photosDir,
              name: path.basename(config.photosDir) || 'photos',
              viewed: savedState.viewed || {},
              favorites: savedState.favorites || {},
              notes: savedState.notes || {},
              annotations: savedState.annotations || {},
            }
          }
        };
        await saveState();
        loaded = true;
      } else if (savedState && savedState.collections) {
        state = {
          version: 2,
          lastUpdated: savedState.lastUpdated || new Date().toISOString(),
          collections: savedState.collections || {},
        };
        loaded = true;
      }
    } catch (err) {
      console.error('Lỗi khi đọc viewed_state.json:', err);
    }
  }

  // If state file was missing, empty, or corrupted, restore from .bak
  if (!loaded) {
    const backupFile = STATE_FILE + '.bak';
    if (await fs.pathExists(backupFile)) {
      try {
        console.warn('Đang tự động khôi phục viewed_state.json từ bản backup .bak...');
        const backupState = await fs.readJson(backupFile);
        if (backupState && backupState.collections) {
          state = backupState;
          loaded = true;
          // Re-create the primary state file from backup
          await fs.writeJson(STATE_FILE, state, { spaces: 2 });
          console.log('Khôi phục thành công từ backup!');
        }
      } catch (bakErr) {
        console.error('Không thể khôi phục từ backup:', bakErr);
      }
    }
  }

  // Ensure active collection initialized
  getActiveCollection();
}

// Mutex / Queue to serialize concurrent writes
let writeQueue = Promise.resolve();
let stateRevision = 0;

// A crash between writing and renaming leaves "<state>.tmp.<pid>.<time>.<rand>"
// behind. Remove ones older than a minute so a concurrent writer is never touched.
async function removeStaleTempFiles() {
  const prefix = `${path.basename(STATE_FILE)}.tmp.`;
  const cutoff = Date.now() - 60_000;
  try {
    for (const name of await fs.readdir(dataDir)) {
      if (!name.startsWith(prefix)) continue;
      const file = path.join(dataDir, name);
      const stats = await fs.stat(file).catch(() => null);
      if (stats?.isFile() && stats.mtimeMs < cutoff) await fs.remove(file).catch(() => {});
    }
  } catch (err) {
    console.warn('Không thể dọn file tạm:', err.message);
  }
}

async function doAtomicSave(snapshot = state, validateCommit) {
  snapshot.lastUpdated = new Date().toISOString();
  const stateFile = STATE_FILE;
  const tempFile = `${stateFile}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  const backupFile = `${stateFile}.bak`;

  try {
    // 1. Write to temporary file in the exact same directory (same volume)
    await fs.writeJson(tempFile, snapshot, { spaces: 2 });

    // 2. Backup current state file if it exists
    if (await fs.pathExists(stateFile)) {
      try {
        await fs.copy(stateFile, backupFile, { overwrite: true });
      } catch (copyErr) {
        console.warn('Cảnh báo: Không thể tạo backup file:', copyErr.message);
      }
    }

    // Keep a restored snapshot private until both the revision check and disk write succeed.
    if (validateCommit) {
      validateCommit();
      fs.renameSync(tempFile, stateFile);
      state = snapshot;
    } else {
      await fs.promises.rename(tempFile, stateFile);
    }
  } finally {
    // 4. Guarantee cleanup of tempFile if rename threw an error or was interrupted
    if (await fs.pathExists(tempFile)) {
      await fs.remove(tempFile).catch(() => {});
    }
  }
}

function queueStateWrite(write) {
  const queued = writeQueue.then(write);
  writeQueue = queued.catch(() => {});
  return queued;
}

// A queued write that has not started yet saves whatever the state is when it runs,
// so later callers share it instead of queueing another full rewrite of the file.
let pendingSave = null;

export function saveState() {
  stateRevision++;
  pendingSave ??= queueStateWrite(() => {
    pendingSave = null;
    return doAtomicSave();
  });
  return pendingSave;
}

export function getState() {
  const col = getActiveCollection();
  return {
    version: state.version,
    lastUpdated: state.lastUpdated,
    collectionId: getCollectionId(config.photosDir),
    viewed: col.viewed,
    favorites: col.favorites,
    notes: col.notes,
    annotations: col.annotations,
    triage: col.triage,
    virtualAlbums: col.virtualAlbums,
    session: col.session,
    allCollections: Object.keys(state.collections).map(id => ({
      id,
      name: state.collections[id].name,
      photosDir: state.collections[id].photosDir,
      viewedCount: Object.keys(state.collections[id].viewed || {}).length,
    })),
  };
}

export function getConfig() {
  return config;
}

function captureCollectionTarget(collectionId) {
  if (typeof collectionId !== 'string' || !/^[a-f0-9]{16}$/.test(collectionId)) {
    throw Object.assign(new Error('Cần xác định bộ ảnh đang mở.'), { status: 400 });
  }
  const target = { collectionId, photosDir: config.photosDir, generation: collectionGeneration };
  assertCollectionTarget(target);
  return target;
}

function assertCollectionTarget(target) {
  if (target.collectionId !== getCollectionId(config.photosDir)
    || target.photosDir !== config.photosDir || target.generation !== collectionGeneration) {
    throw Object.assign(new Error('Bộ ảnh đang mở đã thay đổi. Vui lòng thử lại.'), { status: 409 });
  }
}

function staleRestorePreview() {
  return Object.assign(new Error('Dữ liệu hoặc ảnh trong bộ ảnh đã thay đổi. Vui lòng kiểm tra lại trước khi khôi phục.'), { status: 409 });
}

export function exportCollectionBackup(collectionId) {
  captureCollectionTarget(collectionId);
  return buildCollectionBackup(getActiveCollection());
}

async function prepareCollectionRestore(backup, target) {
  const { collectPhotosRecursively } = await import('./fileManager.js');
  const entries = await collectPhotosRecursively(target.photosDir);
  assertCollectionTarget(target);
  const current = getActiveCollection();
  const photoPaths = new Set(entries.map(entry => entry.relPath));
  const { collection, summary, matchedPaths } = buildRestorePlan(backup, current, photoPaths, DEFAULT_VIRTUAL_ALBUMS);
  const previewToken = crypto.createHmac('sha256', restoreSecret)
    .update(JSON.stringify([target, backup, matchedPaths, summary, buildCollectionBackup(current)]))
    .digest('hex');
  return { collection, summary, previewToken, revision: stateRevision };
}

export async function previewCollectionRestore(backup, collectionId) {
  const target = captureCollectionTarget(collectionId);
  validateCollectionBackup(backup);
  const { summary, previewToken } = await prepareCollectionRestore(backup, target);
  return { summary, previewToken };
}

export async function restoreCollectionBackup(backup, collectionId, previewToken) {
  const target = captureCollectionTarget(collectionId);
  validateCollectionBackup(backup);
  if (typeof previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(previewToken)) {
    throw Object.assign(new Error('Hãy kiểm tra bản sao lưu trước khi khôi phục.'), { status: 400 });
  }
  return queueStateWrite(async () => {
    assertCollectionTarget(target);
    const plan = await prepareCollectionRestore(backup, target);
    if (plan.previewToken !== previewToken) throw staleRestorePreview();

    if (plan.summary.changes) {
      if (plan.summary.checkpoint === 'restored') {
        plan.collection.session.clientUpdatedAt = Math.max(Date.now(), (plan.collection.session.clientUpdatedAt || 0) + 1);
        plan.collection.session.lastUpdated = new Date().toISOString();
      }
      const snapshot = {
        ...state,
        collections: { ...state.collections, [collectionId]: plan.collection },
      };
      await doAtomicSave(snapshot, () => {
        assertCollectionTarget(target);
        if (plan.revision !== stateRevision) throw staleRestorePreview();
      });
    }
    return { success: true, summary: plan.summary, session: plan.collection.session };
  });
}

export async function setConfig(newConfig) {
  if (newConfig.photosDir && newConfig.photosDir !== config.photosDir) collectionGeneration++;
  config = { ...config, ...newConfig };
  await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
  // Ensure the new photosDir has an active collection allocated
  getActiveCollection();
  await saveState();
  return config;
}

export async function markPhotosViewed(relPaths, viewed = true) {
  const col = getActiveCollection();
  const timestamp = new Date().toISOString();
  let changedCount = 0;
  for (const relPath of relPaths) {
    const cleanPath = relPath.replace(/\\/g, '/');
    if (Boolean(col.viewed[cleanPath]) !== Boolean(viewed)) changedCount++;
    if (viewed) {
      col.viewed[cleanPath] = timestamp;
    } else {
      delete col.viewed[cleanPath];
    }
  }
  await saveState();
  return { success: true, count: relPaths.length, changedCount };
}

export async function resetCollectionViewed(collectionId) {
  const target = captureCollectionTarget(collectionId);
  return queueStateWrite(async () => {
    assertCollectionTarget(target);
    const collection = getActiveCollection();
    const count = Object.keys(collection.viewed).length;
    if (!count) return { count };

    const revision = stateRevision;
    const snapshot = {
      ...state,
      collections: { ...state.collections, [collectionId]: { ...collection, viewed: {} } },
    };
    await doAtomicSave(snapshot, () => {
      assertCollectionTarget(target);
      if (revision !== stateRevision) {
        throw Object.assign(new Error('Trạng thái ảnh vừa thay đổi. Vui lòng thử lại.'), { status: 409 });
      }
    });
    return { count };
  });
}

export async function toggleFavorite(relPath, isFav) {
  const col = getActiveCollection();
  const cleanPath = relPath.replace(/\\/g, '/');
  if (isFav) {
    col.favorites[cleanPath] = true;
  } else {
    delete col.favorites[cleanPath];
  }
  await saveState();
  return { success: true, isFavorite: !!isFav };
}

export async function saveNote(relPath, noteText) {
  const col = getActiveCollection();
  const cleanPath = relPath.replace(/\\/g, '/');
  if (noteText && noteText.trim()) {
    col.notes[cleanPath] = noteText.trim();
  } else {
    delete col.notes[cleanPath];
  }
  await saveState();
  return { success: true, note: col.notes[cleanPath] || '' };
}

export async function saveAnnotations(relPath, annotations) {
  const col = getActiveCollection();
  const cleanPath = relPath.replace(/\\/g, '/');
  if (Array.isArray(annotations) && annotations.length > 0) {
    col.annotations[cleanPath] = annotations;
  } else {
    delete col.annotations[cleanPath];
  }
  await saveState();
  return { success: true, annotations: col.annotations[cleanPath] || [] };
}

// Triage rating: 'pick', 'maybe', 'reject', or null to clear
export async function setPhotoTriage(relPaths, status = null) {
  const col = getActiveCollection();
  const validStatus = ['pick', 'maybe', 'reject'].includes(status) ? status : null;
  const timestamp = new Date().toISOString();
  const paths = Array.isArray(relPaths) ? relPaths : [relPaths];

  for (const relPath of paths) {
    const cleanPath = relPath.replace(/\\/g, '/');
    if (validStatus) {
      col.triage[cleanPath] = validStatus;
      col.viewed[cleanPath] = timestamp;
    } else {
      delete col.triage[cleanPath];
    }
  }

  await saveState();
  return { success: true, count: paths.length, status: validStatus };
}

// Virtual Album operations
// Own keys only: "__proto__" or "constructor" would otherwise resolve to Object.prototype.
const hasAlbum = (col, albumId) => typeof albumId === 'string' && Object.hasOwn(col.virtualAlbums, albumId);
const UNSAFE_ALBUM_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export async function togglePhotoInVirtualAlbum(albumId, relPath, inAlbum = true) {
  const col = getActiveCollection();
  if (!hasAlbum(col, albumId)) {
    throw new Error(`Album ảo "${albumId}" không tồn tại`);
  }
  const cleanPath = relPath.replace(/\\/g, '/');
  const album = col.virtualAlbums[albumId];
  if (!Array.isArray(album.photos)) album.photos = [];

  const existingIdx = album.photos.indexOf(cleanPath);
  if (inAlbum && existingIdx === -1) {
    album.photos.push(cleanPath);
  } else if (!inAlbum && existingIdx !== -1) {
    album.photos.splice(existingIdx, 1);
  }

  await saveState();
  const photoAlbums = Object.values(col.virtualAlbums || {})
    .filter(a => Array.isArray(a.photos) && a.photos.includes(cleanPath))
    .map(a => a.id);
  return { success: true, albumId, inAlbum: album.photos.includes(cleanPath), count: album.photos.length, albums: photoAlbums };
}

export async function setPhotoAlbumMembership(albumId, relPaths, inAlbum, photosDir = config.photosDir) {
  const { virtualAlbums } = getActiveCollection(photosDir);
  if (!Object.hasOwn(virtualAlbums, albumId)) throw new Error('Album ảo không tồn tại.');
  const album = virtualAlbums[albumId];
  const previous = Array.isArray(album.photos) ? album.photos : [];
  const membership = new Set(previous);
  const changedFiles = [];
  for (const relPath of new Set(relPaths)) {
    if (membership.has(relPath) === inAlbum) continue;
    if (inAlbum) membership.add(relPath);
    else membership.delete(relPath);
    changedFiles.push(relPath);
  }
  if (changedFiles.length) {
    const updated = [...membership];
    album.photos = updated;
    try {
      await saveState();
    } catch (error) {
      if (album.photos === updated && updated.length === membership.size && updated.every(file => membership.has(file))) {
        album.photos = previous;
      }
      throw error;
    }
  }
  return { albumId, changedFiles, photos: [...(album.photos || [])] };
}

export async function createVirtualAlbum(id, name, quota = 0) {
  const col = getActiveCollection();
  const safeId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!safeId || UNSAFE_ALBUM_IDS.has(safeId) || !name.trim()) {
    throw new Error('Mã ID và Tên album ảo không hợp lệ');
  }
  if (hasAlbum(col, safeId)) {
    throw new Error(`Album ảo có mã "${safeId}" đã tồn tại`);
  }

  col.virtualAlbums[safeId] = {
    id: safeId,
    name: name.trim(),
    quota: Math.max(0, parseInt(quota, 10) || 0),
    photos: [],
  };

  await saveState();
  return { success: true, album: col.virtualAlbums[safeId] };
}

export async function updateAlbumQuota(albumId, quota) {
  const col = getActiveCollection();
  if (!hasAlbum(col, albumId)) {
    throw new Error(`Album ảo "${albumId}" không tồn tại`);
  }
  col.virtualAlbums[albumId].quota = Math.max(0, parseInt(quota, 10) || 0);
  await saveState();
  return { success: true, album: col.virtualAlbums[albumId] };
}

export async function deleteVirtualAlbum(albumId) {
  const col = getActiveCollection();
  if (['gate', 'album', 'table', 'slide'].includes(albumId)) {
    throw new Error('Không thể xoá các album ảo mặc định của hệ thống');
  }
  if (!hasAlbum(col, albumId)) {
    throw new Error('Album ảo không tồn tại');
  }

  delete col.virtualAlbums[albumId];
  await saveState();
  return { success: true, albumId };
}

// Session persistence (resumes where user left off)
export async function saveSession(sessionData) {
  const col = getActiveCollection();
  if (Number.isFinite(sessionData.clientUpdatedAt) && sessionData.clientUpdatedAt < (col.session.clientUpdatedAt || 0)) {
    return { success: true, session: col.session };
  }
  col.session = {
    ...col.session,
    ...sessionData,
    lastUpdated: new Date().toISOString(),
  };
  await saveState();
  return { success: true, session: col.session };
}

// When a photo is moved, update the stored metadata
export async function updateMetadataOnMove(oldRelPath, newRelPath, photosDir) {
  if (applyMetadataMove(oldRelPath, newRelPath, photosDir)) await saveState();
}

// In-memory part of updateMetadataOnMove, so a batch of moves can be saved with one write.
// Returns whether anything changed.
export function applyMetadataMove(oldRelPath, newRelPath, photosDir) {
  const col = getActiveCollection(photosDir);
  const oldClean = oldRelPath.replace(/\\/g, '/');
  const newClean = newRelPath.replace(/\\/g, '/');

  if (oldClean === newClean) return false;

  for (const metadata of [col.viewed, col.favorites, col.notes, col.annotations, col.triage]) {
    if (Object.hasOwn(metadata, oldClean)) metadata[newClean] = metadata[oldClean];
    else delete metadata[newClean];
    delete metadata[oldClean];
  }

  // Update virtual albums
  for (const album of Object.values(col.virtualAlbums || {})) {
    if (Array.isArray(album.photos)) {
      album.photos = album.photos.filter(photoPath => photoPath !== newClean);
      const idx = album.photos.indexOf(oldClean);
      if (idx !== -1) album.photos[idx] = newClean;
    }
  }

  if (col.session.lastActivePhoto === oldClean) col.session.lastActivePhoto = newClean;
  const checkpoint = col.session.reviewCheckpoint;
  if (checkpoint?.photoPath === oldClean) {
    checkpoint.photoPath = newClean;
    const newFolder = newClean.slice(0, Math.max(0, newClean.lastIndexOf('/')));
    if (checkpoint.folder && checkpoint.folder !== newFolder) {
      Object.assign(checkpoint, { folder: newFolder, scrollTop: 0, anchorPath: null, anchorOffset: 0, photoIndex: 0 });
    }
  }
  if (checkpoint?.anchorPath === oldClean) checkpoint.anchorPath = newClean;
  return true;
}

// When a folder is renamed, update all paths that start with that folder
export async function updateMetadataOnFolderRename(oldFolderRel, newFolderRel) {
  const col = getActiveCollection();
  const oldPrefix = oldFolderRel.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const newPrefix = newFolderRel.replace(/\\/g, '/').replace(/\/$/, '') + '/';

  const updateMap = (map) => {
    for (const key of Object.keys(map)) {
      if (key.startsWith(oldPrefix)) {
        const rest = key.slice(oldPrefix.length);
        const newKey = newPrefix + rest;
        map[newKey] = map[key];
        delete map[key];
      }
    }
  };

  updateMap(col.viewed);
  updateMap(col.favorites);
  updateMap(col.notes);
  updateMap(col.annotations);
  updateMap(col.triage);

  for (const album of Object.values(col.virtualAlbums || {})) {
    if (Array.isArray(album.photos)) {
      album.photos = album.photos.map(p => {
        if (p.startsWith(oldPrefix)) {
          return newPrefix + p.slice(oldPrefix.length);
        }
        return p;
      });
    }
  }

  const renamePath = value => typeof value === 'string' && value.startsWith(oldPrefix)
    ? newPrefix + value.slice(oldPrefix.length)
    : value;
  const renameFolderPath = value => value === oldPrefix.slice(0, -1) ? newPrefix.slice(0, -1) : renamePath(value);
  col.session.activeFolder = renameFolderPath(col.session.activeFolder);
  col.session.lastActivePhoto = renamePath(col.session.lastActivePhoto);
  const checkpoint = col.session.reviewCheckpoint;
  if (checkpoint) {
    checkpoint.folder = renameFolderPath(checkpoint.folder);
    checkpoint.photoPath = renamePath(checkpoint.photoPath);
    checkpoint.anchorPath = renamePath(checkpoint.anchorPath);
  }

  await saveState();
}

// When a folder is deleted, purge all metadata and virtual album references for files inside it
export async function removeMetadataOnFolderDelete(folderRel) {
  const col = getActiveCollection();
  const folderClean = folderRel.replace(/\\/g, '/').replace(/\/$/, '');
  const prefix = folderClean + '/';

  const cleanMap = (map) => {
    for (const key of Object.keys(map)) {
      if (key === folderClean || key.startsWith(prefix)) {
        delete map[key];
      }
    }
  };

  cleanMap(col.viewed);
  cleanMap(col.favorites);
  cleanMap(col.notes);
  cleanMap(col.annotations);
  cleanMap(col.triage);

  for (const album of Object.values(col.virtualAlbums || {})) {
    if (Array.isArray(album.photos)) {
      album.photos = album.photos.filter(p => p !== folderClean && !p.startsWith(prefix));
    }
  }

  const wasDeleted = value => typeof value === 'string' && (value === folderClean || value.startsWith(prefix));
  if (wasDeleted(col.session.activeFolder)) col.session.activeFolder = '';
  if (wasDeleted(col.session.lastActivePhoto)) col.session.lastActivePhoto = null;
  const checkpoint = col.session.reviewCheckpoint;
  if (wasDeleted(checkpoint?.photoPath) || wasDeleted(checkpoint?.folder)) {
    col.session.reviewCheckpoint = null;
  } else if (wasDeleted(checkpoint?.anchorPath)) {
    checkpoint.anchorPath = null;
  }

  await saveState();
}
