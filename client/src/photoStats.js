// Gallery header counters for a complete folder listing, defined as in
// getPhotosInFolder (server/fileManager.js), so they can be updated without a refetch.
export function countPhotoStats(photos) {
  const stats = {
    totalCount: photos.length,
    viewedCount: 0,
    favoriteCount: 0,
    pickedCount: 0,
    maybeCount: 0,
    rejectedCount: 0,
    unassignedPickCount: 0,
    notedCount: 0,
    burstCount: 0,
  };
  for (const photo of photos) {
    if (photo.isViewed) stats.viewedCount++;
    if (photo.isFavorite) stats.favoriteCount++;
    if (photo.triage === 'pick') {
      stats.pickedCount++;
      if (!photo.albums?.length) stats.unassignedPickCount++;
    } else if (photo.triage === 'maybe') {
      stats.maybeCount++;
    } else if (photo.triage === 'reject') {
      stats.rejectedCount++;
    }
    if (photo.note?.trim() || photo.annotations?.length > 0) stats.notedCount++;
    if (photo.burstTotal >= 2) stats.burstCount++;
  }
  return stats;
}
