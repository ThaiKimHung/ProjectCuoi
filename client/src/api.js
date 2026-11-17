const BASE_URL = '/api';

async function apiClient(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  const res = await fetch(url, config);
  const contentType = res.headers.get('content-type') || '';
  let data;

  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = (data && typeof data === 'object' && data.error) 
      || (typeof data === 'string' && data) 
      || `Lỗi máy chủ: HTTP ${res.status}`;
    const error = new Error(errorMsg);
    error.status = res.status;
    throw error;
  }

  return data;
}

export function fetchConfig() {
  return apiClient('/config');
}

export function updateConfig(photosDir) {
  return apiClient('/config', {
    method: 'POST',
    body: JSON.stringify({ photosDir }),
  });
}

export function fetchTree() {
  return apiClient('/tree');
}

export async function fetchPhotos(folder = '', filter = 'all', sort = 'name-asc') {
  const params = new URLSearchParams({ folder, filter, sort, compactBursts: '1' });
  const { burstGroups, ...result } = await apiClient(`/photos?${params.toString()}`);
  if (burstGroups) {
    result.photos = result.photos.map(photo => (
      burstGroups[photo.burstId] ? { ...photo, burstPhotos: burstGroups[photo.burstId] } : photo
    ));
  }
  return result;
}

export function fetchDuplicatePhotos(signal) {
  return apiClient('/photos/duplicates', { signal, cache: 'no-store' });
}

export function createFolder(parentRelPath, name) {
  return apiClient('/folders/create', {
    method: 'POST',
    body: JSON.stringify({ parentRelPath, name }),
  });
}

export function renameFolder(folderRelPath, newName) {
  return apiClient('/folders/rename', {
    method: 'POST',
    body: JSON.stringify({ folderRelPath, newName }),
  });
}

export function deleteFolder(folderRelPath) {
  return apiClient('/folders/delete', {
    method: 'POST',
    body: JSON.stringify({ folderRelPath }),
  });
}

export function movePhotos(files, targetFolder) {
  return apiClient('/photos/move', {
    method: 'POST',
    body: JSON.stringify({ files, targetFolder }),
  });
}

export function movePhotoGroups(groups) {
  return apiClient('/photos/move', {
    method: 'POST',
    body: JSON.stringify({ groups: groups.map(({ files, targetFolder }) => ({ files, targetFolder })) }),
  });
}

export function undoPhotoMove(undoToken) {
  return apiClient('/photos/move/undo', {
    method: 'POST',
    body: JSON.stringify({ undoToken }),
  });
}

export function markPhotosViewed(files, viewed = true) {
  return apiClient('/photos/viewed', {
    method: 'POST',
    body: JSON.stringify({ files, viewed }),
  });
}

export function resetViewedPhotos(collectionId) {
  return apiClient('/photos/viewed/reset', {
    method: 'POST',
    body: JSON.stringify({ collectionId }),
  });
}

export function toggleFavorite(file, favorite) {
  return apiClient('/photos/favorite', {
    method: 'POST',
    body: JSON.stringify({ file, favorite }),
  });
}

export function saveNote(file, note) {
  return apiClient('/photos/note', {
    method: 'POST',
    body: JSON.stringify({ file, note }),
  });
}

export function fetchViewedState() {
  return apiClient('/data/viewed-state');
}

export function generateSamplePhotos() {
  return apiClient('/generate-samples', { method: 'POST' });
}

export function browseFilesystem(dir = '') {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  return apiClient(`/browse-filesystem${params}`);
}

export function pickFolderNative() {
  return apiClient('/pick-folder-native', { method: 'POST' });
}

export function copyPhotosToExport(files, targetFolderName = 'Gui_Studio_In') {
  return apiClient('/photos/copy-export', {
    method: 'POST',
    body: JSON.stringify({ files, targetFolderName }),
  });
}

export function savePhotoAnnotations(file, annotations) {
  return apiClient('/photos/annotations', {
    method: 'POST',
    body: JSON.stringify({ file, annotations }),
  });
}

export function setPhotosTriage(files, status) {
  const fileList = Array.isArray(files) ? files : [files];
  return apiClient('/photos/triage', {
    method: 'POST',
    body: JSON.stringify({ files: fileList, status }),
  });
}

export function togglePhotoInAlbum(albumId, file, inAlbum = true) {
  return apiClient('/albums/toggle', {
    method: 'POST',
    body: JSON.stringify({ albumId, file, inAlbum }),
  });
}

export function setAlbumMembership(albumId, files, inAlbum) {
  return apiClient('/albums/membership', {
    method: 'POST',
    body: JSON.stringify({ albumId, files, inAlbum }),
  });
}

export function createVirtualAlbum(id, name, quota = 0) {
  return apiClient('/albums/create', {
    method: 'POST',
    body: JSON.stringify({ id, name, quota }),
  });
}

export function deleteVirtualAlbum(id) {
  return apiClient('/albums/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function updateAlbumQuota(albumId, quota) {
  return apiClient('/albums/quota', {
    method: 'POST',
    body: JSON.stringify({ albumId, quota }),
  });
}

export function exportCategorizedPackage(targetFolderName, categories) {
  return apiClient('/photos/export-package', {
    method: 'POST',
    body: JSON.stringify({ targetFolderName, categories }),
  });
}

export function saveUserSession(session, photosDir) {
  return apiClient('/session', {
    method: 'POST',
    body: JSON.stringify({ session, photosDir }),
    keepalive: true,
  });
}

export function downloadCollectionBackup(collectionId) {
  const query = new URLSearchParams({ collectionId });
  return apiClient(`/collection-backup?${query}`);
}

export function previewCollectionBackup(backup, collectionId) {
  return apiClient('/collection-backup/preview', {
    method: 'POST',
    body: JSON.stringify({ backup, collectionId }),
  });
}

export function restoreCollectionBackup(backup, collectionId, previewToken) {
  return apiClient('/collection-backup/restore', {
    method: 'POST',
    body: JSON.stringify({ backup, collectionId, previewToken }),
  });
}
