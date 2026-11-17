const sortOptions = ['name-asc', 'name-desc', 'date-desc', 'date-asc', 'size-desc'];

export function reviewContext(value = {}) {
  return {
    folder: typeof value.folder === 'string' ? value.folder : '',
    filter: typeof value.filter === 'string' && value.filter ? value.filter : 'all',
    sort: sortOptions.includes(value.sort) ? value.sort : 'name-asc',
    searchQuery: typeof value.searchQuery === 'string' ? value.searchQuery : '',
  };
}

export function readReviewCheckpoint(value) {
  if (!value || typeof value.photoPath !== 'string' || !value.photoPath) return null;
  return {
    ...reviewContext(value),
    photoPath: value.photoPath,
    photoIndex: Number.isSafeInteger(value.photoIndex) && value.photoIndex >= 0 ? value.photoIndex : 0,
    scrollTop: Number.isFinite(value.scrollTop) && value.scrollTop >= 0 ? value.scrollTop : 0,
    anchorPath: typeof value.anchorPath === 'string' ? value.anchorPath : null,
    anchorOffset: Number.isFinite(value.anchorOffset) ? value.anchorOffset : 0,
  };
}

function findPhotoElement(container, photoPath) {
  return container?.querySelector(`[data-photo-path="${CSS.escape(photoPath)}"]`);
}

export function captureReviewScroll(container, photoPath) {
  const anchor = findPhotoElement(container, photoPath);
  return {
    scrollTop: container?.scrollTop || 0,
    anchorPath: anchor ? photoPath : null,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - container.getBoundingClientRect().top : 0,
  };
}

export function restoreReviewScroll(container, checkpoint) {
  if (!container) return;
  const anchor = checkpoint.anchorPath && findPhotoElement(container, checkpoint.anchorPath);
  container.scrollTop = anchor
    ? container.scrollTop + anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - checkpoint.anchorOffset
    : checkpoint.scrollTop;
}

export function moveReviewCheckpoint(checkpoint, moves) {
  if (!checkpoint) return null;
  const movedPhoto = moves.get(checkpoint.photoPath);
  const movedAnchor = moves.get(checkpoint.anchorPath);
  if (!movedPhoto && !movedAnchor) return checkpoint;

  const folder = movedPhoto?.slice(0, Math.max(0, movedPhoto.lastIndexOf('/')));
  if (movedPhoto && checkpoint.folder && checkpoint.folder !== folder) {
    return { ...checkpoint, photoPath: movedPhoto, folder, scrollTop: 0, anchorPath: null, anchorOffset: 0, photoIndex: 0 };
  }
  return { ...checkpoint, photoPath: movedPhoto || checkpoint.photoPath, anchorPath: movedAnchor || checkpoint.anchorPath };
}

export function remapFolderPath(value, oldFolder, newFolder) {
  if (value === oldFolder) return newFolder;
  if (typeof value === 'string' && value.startsWith(oldFolder + '/')) {
    return newFolder === null ? null : newFolder + value.slice(oldFolder.length);
  }
  return value;
}

const pendingSessionKey = photosDir => `wedding.pendingReviewSession.${photosDir}`;

export function discardPendingReviewSession(photosDir) {
  try {
    localStorage.removeItem(pendingSessionKey(photosDir));
  } catch {
    // Browser storage may be disabled.
  }
}

export function readPendingReviewSession(photosDir, remote) {
  try {
    const pending = JSON.parse(localStorage.getItem(pendingSessionKey(photosDir)));
    if (pending?.clientUpdatedAt > (remote.clientUpdatedAt || 0)) return pending;
  } catch {
    // The server copy still works if browser storage is unavailable.
  }
  return remote;
}

export function rememberPendingReviewSession(photosDir, session) {
  const serialized = JSON.stringify(session);
  const key = pendingSessionKey(photosDir);
  try {
    localStorage.setItem(key, serialized);
  } catch {
    return () => {};
  }

  return () => {
    try {
      if (localStorage.getItem(key) === serialized) localStorage.removeItem(key);
    } catch {
      // A later server read can still identify the acknowledged version.
    }
  };
}
