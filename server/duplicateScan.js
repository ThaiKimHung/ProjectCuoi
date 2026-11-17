import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { isImageFile } from './fileManager.js';

const READ_FILE = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const EXPORT_MANIFEST = '.export_manifest.json';
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const SAMPLE_SIZE = 32;
const FREQUENCIES = 8;
const BLOCK_SIZE = SAMPLE_SIZE / FREQUENCIES;
const MAX_HASH_DISTANCE = 7;
const MAX_BUCKET_GROUPS = 24;
const MAX_SIMILAR_GROUP = 8;
const cosine = Array.from({ length: FREQUENCIES }, (_, frequency) =>
  Array.from({ length: SAMPLE_SIZE }, (_, position) =>
    Math.cos((2 * position + 1) * frequency * Math.PI / (2 * SAMPLE_SIZE))
      * (frequency === 0 ? Math.SQRT1_2 : 1)));

async function isExportPackage(directory, entries) {
  if (!entries.some(entry => entry.name === EXPORT_MANIFEST && entry.isFile())) return false;
  try {
    const file = await open(path.join(directory, EXPORT_MANIFEST), READ_FILE);
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) return false;
      const manifest = JSON.parse((await readFileBytes(file, stats.size)).toString('utf8'));
      return manifest?.version === 2 && Array.isArray(manifest.categories)
        && typeof manifest.exportedAt === 'string' && manifest.files
        && typeof manifest.files === 'object' && !Array.isArray(manifest.files);
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

async function collectFiles(root, signal) {
  const pending = [''];
  const files = [];
  let skippedCount = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    const relative = pending.pop();
    const directory = path.join(root, relative);
    try {
      if (await realpath(directory) !== directory) throw new Error('Directory changed during scan');
      const entries = await readdir(directory, { withFileTypes: true });
      if (relative && await isExportPackage(directory, entries)) continue;
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.name.startsWith('.')) continue;
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) {
          pending.push(child);
        } else if (entry.isSymbolicLink()) {
          skippedCount++;
        } else if (entry.isFile() && isImageFile(entry.name)) {
          const stats = await lstat(path.join(root, child), { bigint: true }).catch(() => null);
          if (stats?.isFile() && stats.size > 0n) files.push({ child, stats });
          else skippedCount++;
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (!relative) throw error;
      skippedCount++;
    }
  }
  files.sort((a, b) => a.child < b.child ? -1 : Number(a.child > b.child));
  return { files, skippedCount };
}

function sameFile(before, after) {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

async function hashFile(file, size, signal) {
  const hash = createHash('sha256');
  const stream = file.createReadStream({ start: 0, end: size - 1, autoClose: false, signal });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function readFileBytes(file, size, signal) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    signal?.throwIfAborted();
    const { bytesRead } = await file.read(bytes, offset, size - offset, offset);
    if (bytesRead === 0) throw new Error('File changed during scan');
    offset += bytesRead;
  }
  return bytes;
}

async function imageFingerprint(bytes) {
  const image = sharp(bytes, { limitInputPixels: 100_000_000 });
  const { width, height, orientation } = await image.metadata();
  const pixels = await image.rotate().resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
    .flatten({ background: '#ffffff' }).toColourspace('srgb').raw().toBuffer();
  const rows = new Float64Array(SAMPLE_SIZE * FREQUENCIES);
  const sample = new Float32Array(FREQUENCIES * FREQUENCIES);
  const colour = [0, 0, 0];
  let totalLight = 0;
  let darkest = 255;
  let lightest = 0;
  for (let y = 0; y < SAMPLE_SIZE; y++) {
    for (let x = 0; x < SAMPLE_SIZE; x++) {
      const offset = (y * SAMPLE_SIZE + x) * 3;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      colour[0] += red;
      colour[1] += green;
      colour[2] += blue;
      const light = red * 0.299 + green * 0.587 + blue * 0.114;
      totalLight += light;
      const block = Math.floor(y / BLOCK_SIZE) * FREQUENCIES + Math.floor(x / BLOCK_SIZE);
      sample[block] += light;
      darkest = Math.min(darkest, light);
      lightest = Math.max(lightest, light);
      for (let u = 0; u < FREQUENCIES; u++) rows[y * FREQUENCIES + u] += light * cosine[u][x];
    }
  }
  if (lightest - darkest < 15) return null;

  // Keep the low spatial frequencies and omit the overall brightness coefficient.
  const coefficients = [];
  for (let v = 0; v < FREQUENCIES; v++) {
    for (let u = v === 0 ? 1 : 0; u < FREQUENCIES; u++) {
      let coefficient = 0;
      for (let y = 0; y < SAMPLE_SIZE; y++) coefficient += rows[y * FREQUENCIES + u] * cosine[v][y];
      coefficients.push(coefficient);
    }
  }
  // Weak coefficients can change sign during resizing or JPEG recompression.
  const threshold = Math.max(...coefficients.map(Math.abs)) * 0.02;
  const positive = [0, 0, 0, 0];
  const negative = [0, 0, 0, 0];
  coefficients.forEach((value, bit) => {
    const band = Math.floor(bit / 16);
    if (value > threshold) positive[band] |= 1 << (bit % 16);
    else if (value < -threshold) negative[band] |= 1 << (bit % 16);
  });
  const meanLight = totalLight / (SAMPLE_SIZE * SAMPLE_SIZE);
  return {
    positive,
    negative,
    sample: sample.map(sum => sum / (BLOCK_SIZE * BLOCK_SIZE) - meanLight),
    aspect: orientation >= 5 && orientation <= 8 ? height / width : width / height,
    colour: colour.map(sum => sum / (SAMPLE_SIZE * SAMPLE_SIZE)),
  };
}

function fingerprintDistance(a, b) {
  if (Math.abs(Math.log(a.aspect / b.aspect)) > 0.12
    || a.colour.some((value, channel) => Math.abs(value - b.colour[channel]) > 25)) return Infinity;

  let distance = 0;
  for (let band = 0; band < a.positive.length; band++) {
    let difference = (a.positive[band] ^ b.positive[band]) | (a.negative[band] ^ b.negative[band]);
    while (difference) {
      distance++;
      difference &= difference - 1;
      if (distance > MAX_HASH_DISTANCE) return Infinity;
    }
  }
  // The small luminance grid also checks spatial layout when few coefficients are active.
  const layoutDistance = a.sample.reduce((sum, value, block) => sum + Math.abs(value - b.sample[block]), 0)
    / a.sample.length;
  return layoutDistance <= 14 ? distance : Infinity;
}

function addVisualMatch(candidate, index, similarGroups) {
  const nearby = new Set();
  // At distance seven or less, at least one of four bands differs by at most one bit.
  for (const [band, value] of candidate.fingerprint.positive.entries()) {
    const prefix = band << 16;
    for (let bit = -1; bit < 16; bit++) {
      const probe = bit === -1 ? value : value ^ (1 << bit);
      for (const group of index.get(prefix | probe) || []) nearby.add(group);
    }
  }

  let bestGroup;
  let bestDistance = Infinity;
  for (const group of nearby) {
    if (group.length >= MAX_SIMILAR_GROUP) continue;
    const distance = fingerprintDistance(candidate.fingerprint, group[0].fingerprint);
    if (distance < bestDistance && group.slice(1).every(member =>
      fingerprintDistance(candidate.fingerprint, member.fingerprint) <= MAX_HASH_DISTANCE)) {
      bestGroup = group;
      bestDistance = distance;
    }
  }
  if (bestGroup) {
    bestGroup.push(candidate);
    if (bestGroup.length === 2) similarGroups.push(bestGroup);
    return;
  }

  const group = [candidate];
  candidate.fingerprint.positive.forEach((value, band) => {
    const key = (band << 16) | value;
    if (!index.has(key)) index.set(key, []);
    const bucket = index.get(key);
    if (bucket.length < MAX_BUCKET_GROUPS) bucket.push(group);
  });
}

export async function scanDuplicatePhotos(rootDir, { signal } = {}) {
  signal?.throwIfAborted();
  const root = await realpath(rootDir);
  const collected = await collectFiles(root, signal);
  let { skippedCount } = collected;
  let scannedCount = 0;
  let visualSkippedCount = 0;
  const sizes = new Map();
  const exactByDigest = new Map();
  const visualIndex = new Map();
  const similarGroups = [];

  for (const { stats } of collected.files) sizes.set(stats.size, (sizes.get(stats.size) || 0) + 1);
  for (const { child, stats } of collected.files) {
    signal?.throwIfAborted();
    const fullPath = path.join(root, child);
    const size = Number(stats.size);
    let digest;
    let exactGroup;
    let fingerprint = null;
    try {
      if (await realpath(fullPath) !== fullPath) throw new Error('File changed during scan');
      const file = await open(fullPath, READ_FILE);
      try {
        if (!sameFile(stats, await file.stat({ bigint: true }))) throw new Error('File changed during scan');
        const sizeShared = sizes.get(stats.size) > 1;
        if (size <= MAX_PREVIEW_BYTES) {
          // Read once: the same bytes feed the exact-duplicate hash and the visual fingerprint.
          const bytes = await readFileBytes(file, size, signal);
          if (sizeShared) {
            digest = createHash('sha256').update(bytes).digest('hex');
            exactGroup = exactByDigest.get(digest);
          }
          if (!exactGroup) fingerprint = await imageFingerprint(bytes).catch(() => null);
        } else if (sizeShared) {
          digest = await hashFile(file, size, signal);
          exactGroup = exactByDigest.get(digest);
        }
        signal?.throwIfAborted();
        if (!sameFile(stats, await file.stat({ bigint: true }))) throw new Error('File changed during scan');
      } finally {
        await file.close();
      }
    } catch {
      signal?.throwIfAborted();
      skippedCount++;
      continue;
    }

    scannedCount++;
    const relPath = child.split(path.sep).join('/');
    const directory = path.posix.dirname(relPath);
    const photo = {
      name: path.basename(child),
      relPath,
      folder: directory === '.' ? 'Thư mục gốc' : directory,
      size,
      mtime: Number(stats.mtimeMs),
    };
    if (exactGroup) {
      exactGroup.photos.push(photo);
      if (!exactGroup.hasFingerprint) visualSkippedCount++;
    } else {
      if (digest) exactByDigest.set(digest, { photos: [photo], hasFingerprint: Boolean(fingerprint) });
      if (fingerprint) addVisualMatch({ photo, fingerprint }, visualIndex, similarGroups);
      else visualSkippedCount++;
    }
  }

  signal?.throwIfAborted();
  return {
    exactGroups: [...exactByDigest.values()].map(group => group.photos).filter(photos => photos.length > 1),
    similarGroups: similarGroups.map(group => group.map(member => member.photo)),
    scannedCount,
    skippedCount,
    visualSkippedCount,
  };
}
