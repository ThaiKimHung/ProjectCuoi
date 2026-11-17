function directoryOf(relPath) {
  return relPath.slice(0, relPath.lastIndexOf('/') + 1);
}

export function getBurstComparisonStep(photoA, photoB, allPhotos, burstPhotos = allPhotos) {
  if (!photoA || !photoB) return null;

  const findCandidate = matches => allPhotos.find(matches) ?? burstPhotos.find(matches);
  // Burst IDs are numbered independently in folder and collection listings.
  const pathLists = [photoA.burstPhotos, photoB.burstPhotos].filter(Array.isArray);
  if (pathLists.length > 0) {
    const order = pathLists.find(paths => paths.includes(photoA.relPath) && paths.includes(photoB.relPath));
    if (!order) return null;

    const furthest = Math.max(order.indexOf(photoA.relPath), order.indexOf(photoB.relPath));
    const nextPath = order[furthest + 1];
    return {
      nextPhoto: nextPath ? findCandidate(photo => photo.relPath === nextPath) : undefined,
      isAtEnd: !nextPath,
    };
  }

  const directory = directoryOf(photoA.relPath);
  if (!photoA.burstId || photoA.burstId !== photoB.burstId || directory !== directoryOf(photoB.relPath)
    || !Number.isInteger(photoA.burstIndex) || !Number.isInteger(photoB.burstIndex)) {
    return null;
  }

  const nextIndex = Math.max(photoA.burstIndex, photoB.burstIndex) + 1;
  const total = Math.max(photoA.burstTotal ?? 0, photoB.burstTotal ?? 0);
  return {
    nextPhoto: findCandidate(photo => photo.burstId === photoA.burstId
      && photo.burstIndex === nextIndex && directoryOf(photo.relPath) === directory),
    isAtEnd: total > 0 && nextIndex > total,
  };
}
