import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import sharp from 'sharp';
import crypto from 'crypto';
import { fileIdentity } from './fileIdentity.js';

export { fileIdentity };

const CACHE_ROOT = path.resolve(process.env.CURATOR_CACHE_DIR || path.join(process.cwd(), '.cache'));

// thumb: gallery cards. preview: Lightbox / Compare, sharp enough for a retina
// screen at "fit" size; the original is only loaded when the user zooms in.
// Previews are JPEG: about twice as fast to encode as WebP at this size.
const KINDS = {
  thumb: { dir: path.join(CACHE_ROOT, 'thumbnails'), size: 480, ext: '.webp', encode: img => img.webp({ quality: 80 }) },
  preview: { dir: path.join(CACHE_ROOT, 'previews'), size: 2560, ext: '.jpg', encode: img => img.jpeg({ quality: 85 }) },
};

export async function initThumbnailCache() {
  await Promise.all(Object.values(KINDS).map(kind => fs.ensureDir(kind.dir)));
}

function cacheFileFor(kind, fullPath, stats) {
  const hash = crypto.createHash('md5').update(fileIdentity(fullPath, stats)).digest('hex');
  return path.join(KINDS[kind].dir, `${hash}${KINDS[kind].ext}`);
}

// ---------------------------------------------------------------------------
// A small job queue: at most MAX_JOBS decodes at once, requests from the screen
// ("high") before background warm-up ("low"), and one job per output file.

const MAX_JOBS = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2)));
const queues = { high: [], low: [] };
const jobs = new Map(); // cacheFile -> job
let running = 0;

function pump() {
  while (running < MAX_JOBS) {
    const job = queues.high.shift() || queues.low.shift();
    if (!job) return;
    job.queue = null;
    running++;
    job.run()
      .then(job.resolve, job.reject)
      .finally(() => {
        running--;
        jobs.delete(job.cacheFile);
        pump();
      });
  }
}

function schedule(cacheFile, run, priority) {
  const existing = jobs.get(cacheFile);
  if (existing) {
    // Someone is looking at it now: move a queued warm-up job to the front.
    if (priority === 'high' && existing.queue === 'low') {
      queues.low.splice(queues.low.indexOf(existing), 1);
      existing.queue = 'high';
      queues.high.push(existing);
    }
    return existing.promise;
  }
  const job = { cacheFile, run, queue: priority };
  job.promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });
  jobs.set(cacheFile, job);
  queues[priority].push(job);
  pump();
  return job.promise;
}

async function render(kind, fullPath, cacheFile) {
  const { size, encode } = KINDS[kind];
  // Write to a temp name and rename, so a concurrent request never serves a half-written file.
  const temp = `${cacheFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.ensureDir(path.dirname(cacheFile));
    const image = sharp(fullPath, { failOnError: false, sequentialRead: true })
      .rotate() // Apply EXIF orientation
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
    await encode(image).toFile(temp);
    await fs.rename(temp, cacheFile);
    return cacheFile;
  } finally {
    await fs.remove(temp).catch(() => {});
  }
}

async function getCachedImage(kind, fullPath, priority = 'high') {
  try {
    const stats = await fs.stat(fullPath);
    const cacheFile = cacheFileFor(kind, fullPath, stats);
    if (await fs.pathExists(cacheFile)) return cacheFile;
    return await schedule(cacheFile, () => render(kind, fullPath, cacheFile), priority);
  } catch (err) {
    console.error(`Failed to generate ${kind} for ${fullPath}:`, err.message);
    return null;
  }
}

export function getThumbnail(fullPath) {
  return getCachedImage('thumb', fullPath);
}

export function getPreview(fullPath) {
  return getCachedImage('preview', fullPath);
}

// Making a preview of a 24 MP photo costs about as much as the browser loading the
// original, so the preview only pays off when it is ready ahead of time. This
// returns the cached preview, or null after scheduling one (caller sends the original).
export async function getReadyPreview(fullPath, priority = 'high') {
  try {
    const stats = await fs.stat(fullPath);
    const cacheFile = cacheFileFor('preview', fullPath, stats);
    if (await fs.pathExists(cacheFile)) return cacheFile;
    schedule(cacheFile, () => render('preview', fullPath, cacheFile), priority).catch(error => {
      console.error(`Failed to generate preview for ${fullPath}:`, error.message);
    });
  } catch (error) {
    console.error(`Failed to read ${fullPath}:`, error.message);
  }
  return null;
}

// Pre-generate thumbnails for the folder the user just opened, in display order.
// A newer call replaces the previous folder's pending warm-up.
let warmGeneration = 0;

export function warmThumbnails(fullPaths) {
  const generation = ++warmGeneration;
  for (const job of queues.low.splice(0)) {
    jobs.delete(job.cacheFile);
    job.resolve(null);
  }
  return (async () => {
    let queued = 0;
    for (const fullPath of fullPaths.slice(0, 5000)) {
      if (generation !== warmGeneration) break;
      try {
        const stats = await fs.stat(fullPath);
        const cacheFile = cacheFileFor('thumb', fullPath, stats);
        if (await fs.pathExists(cacheFile)) continue;
        schedule(cacheFile, () => render('thumb', fullPath, cacheFile), 'low').catch(() => {});
        queued++;
      } catch {
        // Missing or unreadable file: the gallery request will report it.
      }
    }
    return queued;
  })();
}

export async function waitForThumbnailQueue() {
  while (running || queues.high.length || queues.low.length) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export function thumbnailQueueStats() {
  return { running, queued: queues.high.length + queues.low.length, maxJobs: MAX_JOBS };
}
