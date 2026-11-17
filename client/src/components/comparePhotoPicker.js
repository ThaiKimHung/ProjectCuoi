export function getPhotoDirectory(photoOrPath) {
  const relPath = typeof photoOrPath === 'string' ? photoOrPath : photoOrPath?.relPath;
  if (typeof relPath !== 'string' || !relPath) return '';
  const normalized = relPath.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex < 0 ? '' : normalized.slice(0, slashIndex);
}

export function resolveComparisonFolder({
  currentFolder = '',
  photoA = null,
  photoB = null,
} = {}) {
  // When viewing "Tất cả ảnh" (root collection view), allow all photos across the collection
  if (typeof currentFolder !== 'string' || currentFolder.trim() === '') {
    return null;
  }

  const normalizedFolder = currentFolder.trim().replace(/\\/g, '/');
  const explicitPhotos = [photoA, photoB].filter(p => p?.relPath);

  // If explicitly comparing photos outside currentFolder (e.g. cross-folder duplicates), do not lock
  if (explicitPhotos.some(p => getPhotoDirectory(p) !== normalizedFolder)) {
    return null;
  }

  return normalizedFolder;
}

export function buildComparisonCandidatePool({
  allPhotos = [],
  burstPhotos = [],
  photoA = null,
  photoB = null,
  selectedFiles = [],
  currentFolder = '',
} = {}) {
  const targetFolder = resolveComparisonFolder({
    currentFolder,
    photoA,
    photoB,
    selectedFiles,
  });

  const map = new Map();
  for (const item of [...allPhotos, ...burstPhotos, photoA, photoB]) {
    if (!item?.relPath || map.has(item.relPath)) continue;
    if (targetFolder !== null && getPhotoDirectory(item) !== targetFolder) {
      continue;
    }
    map.set(item.relPath, item);
  }
  return [...map.values()];
}

export function resolveComparisonPair(candidates = [], photoA = null, photoB = null, options = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const first = photoA || list[0] || null;
  if (!first) return { photoA: null, photoB: null };

  const targetFolder = options.folder !== undefined
    ? options.folder
    : resolveComparisonFolder({
        currentFolder: options.currentFolder,
        photoA: first,
        photoB,
        selectedFiles: options.selectedFiles,
      });

  const pool = targetFolder !== null
    ? list.filter(item => getPhotoDirectory(item) === targetFolder)
    : list;

  const validPhotoB = photoB
    && photoB.relPath !== first.relPath
    && (targetFolder === null || getPhotoDirectory(photoB) === targetFolder)
    ? photoB
    : null;

  const second = validPhotoB
    || pool.find(item => item.relPath !== first.relPath)
    || null;
  return { photoA: first, photoB: second };
}

export function filterComparisonCandidates(
  photos = [],
  { scope = 'all', selectedFiles = [], burstPaths = [], query = '' } = {},
) {
  const list = Array.isArray(photos) ? photos : [];
  const selectedSet = new Set(selectedFiles);
  const burstSet = new Set(burstPaths);

  const scoped = list.filter(photo => {
    if (!photo?.relPath) return false;
    if (scope === 'selected') return selectedSet.has(photo.relPath);
    if (scope === 'burst') return burstSet.has(photo.relPath);
    if (scope === 'pick') return photo.triage === 'pick';
    return true;
  });

  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!normalizedQuery) return scoped;

  return scoped.filter(photo =>
    (photo.name && photo.name.toLowerCase().includes(normalizedQuery))
    || photo.relPath.toLowerCase().includes(normalizedQuery),
  );
}

export function assignComparisonSlot(currentA, currentB, targetSlot, chosenPhoto) {
  if (!chosenPhoto?.relPath) {
    return { photoA: currentA || null, photoB: currentB || null };
  }
  if (targetSlot === 'A') {
    if (currentB?.relPath === chosenPhoto.relPath) {
      return { photoA: chosenPhoto, photoB: currentA || null };
    }
    return { photoA: chosenPhoto, photoB: currentB || null };
  }
  if (currentA?.relPath === chosenPhoto.relPath) {
    return { photoA: currentB || null, photoB: chosenPhoto };
  }
  return { photoA: currentA || null, photoB: chosenPhoto };
}
