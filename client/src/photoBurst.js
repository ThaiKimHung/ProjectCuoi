export function findBurstNeighbor(photo, visiblePhotos, collectionPhotos = []) {
  const paths = photo.burstPhotos || [];
  const index = paths.indexOf(photo.relPath);
  if (index < 0) return undefined;

  for (const path of [paths[index + 1], paths[index - 1]]) {
    if (!path) continue;
    const neighbor = visiblePhotos.find(item => item.relPath === path)
      || collectionPhotos.find(item => item.relPath === path);
    if (neighbor) return neighbor;
  }
  return undefined;
}
