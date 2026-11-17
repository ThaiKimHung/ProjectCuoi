export function addPhotoSelectionRange(selected, displayedPhotos, anchorPath, endPath) {
  if (!anchorPath) return null;
  const start = displayedPhotos.findIndex(photo => photo.relPath === anchorPath);
  const end = displayedPhotos.findIndex(photo => photo.relPath === endPath);
  if (start < 0 || end < 0) return null;

  const range = displayedPhotos.slice(Math.min(start, end), Math.max(start, end) + 1);
  const next = new Set(selected);
  for (const photo of range) next.add(photo.relPath);
  return [...next];
}
