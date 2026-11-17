import path from 'path';

// Identify a photo by the file itself rather than its path: moving a photo to
// another folder (hard link + unlink) keeps dev/ino/size/mtime, so caches keyed
// by this survive the move. Falls back to the path where inodes are unavailable.
export function fileIdentity(fullPath, stats) {
  const id = stats.ino ? `${stats.dev}:${stats.ino}` : path.resolve(fullPath);
  return `${id}:${stats.size}:${stats.mtimeMs}`;
}
