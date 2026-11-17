const studioAlbums = [
  { id: 'gate', title: 'Ảnh Cổng 60x90', icon: '🚪', folderName: '01_Anh_Cong', defaultQuota: 2 },
  { id: 'album', title: 'Album Cưới Photobook', icon: '📖', folderName: '02_Album_Cuoi', defaultQuota: 30 },
  { id: 'table', title: 'Ảnh Để Bàn Gallery', icon: '🖼️', folderName: '03_Anh_De_Ban', defaultQuota: 10 },
  { id: 'slide', title: 'Slide Chiếu Tiệc', icon: '📽️', folderName: '04_Slide_Tiec', defaultQuota: 20 },
];

const studioAlbumIds = new Set(studioAlbums.map(album => album.id));

function customFolderBase(title, albumId) {
  // Use ASCII so the manifest and directory listing agree on every filesystem.
  const slug = title.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/Đ/g, 'D').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'Anh';
  const safeId = albumId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (safeId.length <= 128) return `Album_${slug}--${safeId}`;

  // Include the whole ID when distinguishing IDs longer than a directory name.
  let hash = 2166136261;
  for (const character of safeId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `Album_${slug}--${safeId.slice(0, 112)}-${(hash >>> 0).toString(36)}`;
}

export function buildStudioPackage(photos, albums, includedCustomAlbumIds = []) {
  const buildAlbumGroup = (album, quota) => {
    const albumId = album.albumId ?? album.id;
    const albumPhotos = photos.filter(photo => Array.isArray(photo.albums) && photo.albums.includes(albumId));
    return { ...album, photos: albumPhotos, quota, shortfall: Math.max(0, quota - albumPhotos.length) };
  };

  const setupGroups = studioAlbums.map(({ defaultQuota, ...album }) => (
    buildAlbumGroup(album, albums[album.id]?.quota ?? defaultQuota)
  ));

  const picks = photos.filter(photo => photo.triage === 'pick');
  setupGroups.push({
    id: 'pick',
    title: 'Tất Cả Ảnh Đã Chọn (Giữ lại)',
    icon: '💍',
    folderName: '05_Tat_Ca_Anh_Giu_Lai',
    photos: picks,
    quota: null,
    shortfall: 0,
  });

  const includedIds = new Set(includedCustomAlbumIds);
  const usedFolderNames = new Set();
  const customAlbumIds = Object.keys(albums).filter(id => !studioAlbumIds.has(id)).sort();
  for (const albumId of customAlbumIds) {
    const album = albums[albumId];
    const title = album?.name || albumId;
    const base = customFolderBase(title, albumId);
    let folderName = base;
    for (let suffix = 2; usedFolderNames.has(folderName.toLowerCase()); suffix++) {
      folderName = `${base}--${suffix}`;
    }
    usedFolderNames.add(folderName.toLowerCase());

    setupGroups.push(buildAlbumGroup({
      id: `custom:${albumId}`,
      albumId,
      title,
      icon: '🏷️',
      folderName,
      included: includedIds.has(albumId),
    }, album?.quota ?? 0));
  }

  const groups = setupGroups.filter(group => group.included !== false);
  const categories = groups.filter(group => group.photos.length > 0).map(group => ({
    id: group.id,
    folderName: group.folderName,
    title: group.title,
    files: group.photos.map(photo => photo.relPath),
  }));
  const unassignedPicks = picks.filter(photo => !Array.isArray(photo.albums) || photo.albums.length === 0);
  return { groups, setupGroups, categories, unassignedPicks };
}
