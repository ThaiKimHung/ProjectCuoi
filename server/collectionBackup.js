import { isDeepStrictEqual } from 'node:util';

const FORMAT = 'wedding-photo-curator/collection-backup';
const VERSION = 1;
const ROOT_KEYS = ['format', 'version', 'photos', 'albums', 'reviewCheckpoint'];
const PHOTO_FIELDS = ['viewed', 'favorites', 'triage', 'notes', 'annotations'];
const CHECKPOINT_KEYS = [
  'photoPath', 'folder', 'filter', 'sort', 'searchQuery', 'photoIndex',
  'scrollTop', 'anchorPath', 'anchorOffset',
];
const ANNOTATION_KEYS = ['id', 'number', 'x', 'y', 'radius', 'text', 'label', 'type', 'w', 'h', 'comment'];
const FILTERS = ['all', 'unviewed', 'viewed', 'favorite', 'pick', 'maybe', 'reject', 'unassigned', 'noted', 'burst'];
const SORTS = ['name-asc', 'name-desc', 'date-asc', 'date-desc', 'size-desc'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value) {
  return value !== null && typeof value === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function hasOnlyKeys(value, keys) {
  return isRecord(value) && Object.keys(value).every(key => keys.includes(key));
}

function isRelativePath(value) {
  return typeof value === 'string' && !/[\\\x00-\x1f]/u.test(value) && !/^[a-z]:/i.test(value)
    && !UNSAFE_KEYS.has(value)
    && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function isAlbumId(value) {
  return typeof value === 'string' && /^[a-z0-9_-]+$/.test(value) && !UNSAFE_KEYS.has(value);
}

function isFilter(value) {
  return FILTERS.includes(value)
    || (typeof value === 'string' && value.startsWith('album:') && isAlbumId(value.slice(6)));
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPercentage(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function isAnnotation(value) {
  return hasOnlyKeys(value, ANNOTATION_KEYS)
    && isPercentage(value.x) && isPercentage(value.y)
    && (!Object.hasOwn(value, 'id') || typeof value.id === 'string' || isCount(value.id))
    && (!Object.hasOwn(value, 'number') || isCount(value.number))
    && ['radius', 'w', 'h'].every(key => !Object.hasOwn(value, key) || isPercentage(value[key]))
    && ['text', 'label', 'type', 'comment'].every(key => !Object.hasOwn(value, key) || typeof value[key] === 'string');
}

const validPhotoField = {
  viewed: value => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
  favorites: value => typeof value === 'boolean',
  triage: value => ['pick', 'maybe', 'reject'].includes(value),
  notes: value => typeof value === 'string',
  annotations: value => Array.isArray(value) && value.every(isAnnotation),
};

function isCheckpoint(value) {
  return hasOnlyKeys(value, CHECKPOINT_KEYS)
    && isRelativePath(value.photoPath) && (value.folder === '' || isRelativePath(value.folder))
    && isFilter(value.filter) && SORTS.includes(value.sort) && typeof value.searchQuery === 'string'
    && isCount(value.photoIndex) && Number.isFinite(value.scrollTop) && value.scrollTop >= 0
    && (value.anchorPath === null || isRelativePath(value.anchorPath)) && Number.isFinite(value.anchorOffset);
}

function isAlbum(value) {
  return hasOnlyKeys(value, ['id', 'name', 'quota', 'photos'])
    && isAlbumId(value.id) && typeof value.name === 'string' && Boolean(value.name.trim())
    && isCount(value.quota) && Array.isArray(value.photos) && value.photos.every(isRelativePath);
}

export function validateCollectionBackup(backup) {
  if (!hasOnlyKeys(backup, ROOT_KEYS) || backup.format !== FORMAT || backup.version !== VERSION) {
    throw Object.assign(new Error('Định dạng hoặc phiên bản bản sao lưu không được hỗ trợ.'), { status: 400 });
  }
  if (!isRecord(backup.photos)
    || !Object.entries(backup.photos).every(([relativePath, fields]) => isRelativePath(relativePath)
      && hasOnlyKeys(fields, PHOTO_FIELDS) && Object.keys(fields).length > 0
      && Object.entries(fields).every(([field, value]) => validPhotoField[field](value)))
    || !Array.isArray(backup.albums) || !backup.albums.every(isAlbum)
    || new Set(backup.albums.map(album => album.id)).size !== backup.albums.length
    || (backup.reviewCheckpoint !== null && !isCheckpoint(backup.reviewCheckpoint))) {
    throw Object.assign(new Error('Bản sao lưu có dữ liệu hoặc đường dẫn không hợp lệ.'), { status: 400 });
  }
}

function readCheckpoint(session, photoPaths) {
  const matchesPhoto = photoPath => isRelativePath(photoPath) && (!photoPaths || photoPaths.has(photoPath));
  const value = matchesPhoto(session.reviewCheckpoint?.photoPath) ? session.reviewCheckpoint : {
    photoPath: session.lastActivePhoto,
    folder: session.activeFolder,
    filter: session.activeFilter,
    sort: session.activeSort,
    searchQuery: session.activeSearchQuery,
  };
  if (!matchesPhoto(value.photoPath)) return null;
  return {
    photoPath: value.photoPath,
    folder: isRelativePath(value.folder) ? value.folder : '',
    filter: isFilter(value.filter) ? value.filter : 'all',
    sort: SORTS.includes(value.sort) ? value.sort : 'name-asc',
    searchQuery: typeof value.searchQuery === 'string' ? value.searchQuery : '',
    photoIndex: isCount(value.photoIndex) ? value.photoIndex : 0,
    scrollTop: Number.isFinite(value.scrollTop) && value.scrollTop >= 0 ? value.scrollTop : 0,
    anchorPath: isRelativePath(value.anchorPath) ? value.anchorPath : null,
    anchorOffset: isRelativePath(value.anchorPath) && Number.isFinite(value.anchorOffset) ? value.anchorOffset : 0,
  };
}

export function buildCollectionBackup(collection) {
  const photos = Object.create(null);
  for (const field of PHOTO_FIELDS) {
    for (const [relativePath, storedValue] of Object.entries(collection[field])) {
      if (!isRelativePath(relativePath)) continue;
      const value = field === 'annotations' && Array.isArray(storedValue)
        ? storedValue.filter(isRecord).map(annotation => Object.fromEntries(
          ANNOTATION_KEYS.filter(key => Object.hasOwn(annotation, key)).map(key => [key, annotation[key]])
        )).filter(isAnnotation)
        : storedValue;
      if (!validPhotoField[field](value)) continue;
      photos[relativePath] ??= {};
      photos[relativePath][field] = value;
    }
  }

  const albums = Object.entries(collection.virtualAlbums).filter(([id, album]) => isAlbumId(id) && isRecord(album))
    .map(([id, album]) => ({
      id,
      name: album.name,
      quota: album.quota,
      photos: Array.isArray(album.photos) ? album.photos.filter(isRelativePath) : [],
    })).filter(isAlbum);

  return { format: FORMAT, version: VERSION, photos, albums, reviewCheckpoint: readCheckpoint(collection.session) };
}

function normalizedName(name) {
  return typeof name === 'string' ? name.trim().normalize('NFC').toLowerCase() : '';
}

function isFreshCollection(collection, defaults) {
  return PHOTO_FIELDS.every(field => Object.keys(collection[field]).length === 0)
    && Object.keys(collection.virtualAlbums).length === Object.keys(defaults).length
    && Object.entries(defaults).every(([id, album]) => isDeepStrictEqual(collection.virtualAlbums[id], album))
    && !readCheckpoint(collection.session);
}

function pathsInBackup(backup) {
  const paths = new Set(Object.keys(backup.photos));
  for (const album of backup.albums) {
    for (const photo of album.photos) paths.add(photo);
  }
  if (backup.reviewCheckpoint) {
    paths.add(backup.reviewCheckpoint.photoPath);
    if (backup.reviewCheckpoint.anchorPath) paths.add(backup.reviewCheckpoint.anchorPath);
  }
  return [...paths].sort();
}

export function buildRestorePlan(backup, current, photoPaths, defaults) {
  const collection = structuredClone(current);
  const fresh = isFreshCollection(current, defaults);
  const referencedPaths = pathsInBackup(backup);
  const matched = new Set(referencedPaths.filter(photo => photoPaths.has(photo)));
  const skipped = referencedPaths.filter(photo => !matched.has(photo));
  const summary = {
    matchedPhotos: matched.size,
    skippedPhotos: skipped.length,
    skippedPaths: skipped.slice(0, 20),
    conflictingPhotos: 0,
    photoFieldConflicts: 0,
    photoFieldsAdded: 0,
    albumsCreated: 0,
    albumMembershipsAdded: 0,
    albumQuotasRestored: 0,
    albumConflicts: [],
    checkpoint: 'none',
    changes: 0,
  };

  for (const [photo, fields] of Object.entries(backup.photos)) {
    if (!matched.has(photo)) continue;
    let photoHasConflict = false;
    for (const [field, value] of Object.entries(fields)) {
      const destination = collection[field];
      if (!Object.hasOwn(destination, photo)) {
        destination[photo] = value;
        summary.photoFieldsAdded++;
      } else if (!isDeepStrictEqual(destination[photo], value)) {
        photoHasConflict = true;
        summary.photoFieldConflicts++;
      }
    }
    if (photoHasConflict) summary.conflictingPhotos++;
  }

  const mappedAlbumIds = new Map();
  const existingNames = new Map();
  for (const [id, album] of Object.entries(current.virtualAlbums)) {
    if (Object.hasOwn(defaults, id)) continue;
    const key = normalizedName(album.name);
    if (key && !existingNames.has(key)) existingNames.set(key, id);
  }
  const reservedAlbumIds = new Set(backup.albums.map(album => album.id));
  for (const incoming of backup.albums) {
    const { id, name, quota } = incoming;
    const namesMatch = album => normalizedName(album?.name) === normalizedName(name);
    const builtIn = Object.hasOwn(defaults, id);
    const occupied = Object.hasOwn(collection.virtualAlbums, id);
    let targetId = id;
    let kind;
    if (!builtIn && (!occupied || !namesMatch(collection.virtualAlbums[id]))) {
      const sameNameId = existingNames.get(normalizedName(name));
      if (sameNameId) {
        targetId = sameNameId;
        kind = 'sameName';
      } else if (occupied) {
        kind = 'sameId';
        targetId = `${id}_restored`;
        for (let suffix = 2; Object.hasOwn(collection.virtualAlbums, targetId) || reservedAlbumIds.has(targetId); suffix++) {
          targetId = `${id}_restored_${suffix}`;
        }
      }
    }

    const exists = Object.hasOwn(collection.virtualAlbums, targetId);
    if (!exists) {
      collection.virtualAlbums[targetId] = { id: targetId, name, quota, photos: [] };
      summary.albumsCreated++;
    }
    const album = collection.virtualAlbums[targetId];
    if (exists && album.quota !== quota) {
      if (!isCount(album.quota) || (builtIn && fresh)) {
        album.quota = quota;
        summary.albumQuotasRestored++;
      } else {
        summary.albumConflicts.push({ kind: 'quota', sourceName: name, targetName: album.name, incomingQuota: quota, currentQuota: album.quota });
      }
    }
    if (kind) summary.albumConflicts.push({ kind, sourceName: name, targetName: album.name });
    mappedAlbumIds.set(id, targetId);

    const photos = new Set(Array.isArray(album.photos) ? album.photos : []);
    const oldSize = photos.size;
    for (const photo of incoming.photos) {
      if (matched.has(photo)) photos.add(photo);
    }
    const added = photos.size - oldSize;
    if (added > 0) album.photos = [...photos];
    summary.albumMembershipsAdded += added;
  }

  const incomingCheckpoint = backup.reviewCheckpoint;
  if (incomingCheckpoint) {
    if (!matched.has(incomingCheckpoint.photoPath)) {
      summary.checkpoint = 'skipped';
    } else {
      const checkpoint = { ...incomingCheckpoint };
      if (checkpoint.filter.startsWith('album:')) {
        const albumId = checkpoint.filter.slice(6);
        const targetId = mappedAlbumIds.get(albumId) || albumId;
        checkpoint.filter = Object.hasOwn(collection.virtualAlbums, targetId) ? `album:${targetId}` : 'all';
      }
      const photoFolder = checkpoint.photoPath.slice(0, Math.max(0, checkpoint.photoPath.lastIndexOf('/')));
      if (checkpoint.folder && checkpoint.folder !== photoFolder) {
        Object.assign(checkpoint, { folder: photoFolder, scrollTop: 0, photoIndex: 0, anchorPath: null, anchorOffset: 0 });
      } else if (!matched.has(checkpoint.anchorPath)) {
        Object.assign(checkpoint, { anchorPath: null, anchorOffset: 0 });
      }
      const existingCheckpoint = readCheckpoint(collection.session, photoPaths);
      if (!existingCheckpoint) {
        collection.session.reviewCheckpoint = checkpoint;
        collection.session.lastActivePhoto = null;
        summary.checkpoint = 'restored';
      } else {
        summary.checkpoint = isDeepStrictEqual(existingCheckpoint, checkpoint) ? 'same' : 'kept';
      }
    }
  }
  summary.changes = summary.photoFieldsAdded + summary.albumsCreated + summary.albumMembershipsAdded
    + summary.albumQuotasRestored + Number(summary.checkpoint === 'restored');
  return { collection, summary, matchedPaths: [...matched] };
}
