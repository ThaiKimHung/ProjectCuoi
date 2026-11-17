import path from 'path';
import { fileURLToPath } from 'url';

// The project folder (parent of server/). Default data, cache, photo and UI paths are
// anchored here rather than process.cwd(), so the server behaves the same from any directory.
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Resolves a path against the project folder; absolute paths are returned unchanged.
export function fromProjectRoot(...segments) {
  return path.resolve(PROJECT_ROOT, ...segments);
}
