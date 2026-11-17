// Resolve a "from … to …" range typed by the user into the photos it covers.
// mode 'index': 1-based positions (STT) in the visible list.
// mode 'name': a file name, the name without extension, or a number that
// appears in exactly one file name (e.g. "1234" → "DSC_1234.jpg").

const stripExt = name => name.replace(/\.[^.]+$/, '');
const fold = text => text.normalize('NFC').trim().toLowerCase();

const numberGroups = name => (stripExt(name).match(/\d+/g) || []).map(Number);

// When a typed number has no photo (gaps in camera numbering), take the nearest
// photo inside the range: the next one up for "from", the next one down for "to".
function snapToNearest(photos, value, direction) {
  let best = null;
  photos.forEach((p, index) => {
    for (const n of numberGroups(p.name)) {
      const inside = direction === 'up' ? n >= value : n <= value;
      if (!inside) continue;
      const gap = Math.abs(n - value);
      if (!best || gap < best.gap) best = { index, gap, n, name: p.name };
    }
  });
  return best;
}

function findByName(photos, query, direction) {
  const q = fold(query);
  const byFull = photos.findIndex(p => fold(p.name) === q);
  if (byFull >= 0) return { index: byFull };
  const byBase = photos.findIndex(p => fold(stripExt(p.name)) === q);
  if (byBase >= 0) return { index: byBase };
  // "DSC_6833" with no exact file falls through to the number match below.
  const tail = q.match(/^[^\d]*?[_\-\s]?(\d+)$/);
  if (tail && !/^\d+$/.test(q)) return findByName(photos, tail[1], direction);

  let matches;
  if (/^\d+$/.test(q)) {
    // Compare number groups by value so "12" matches "IMG_0012" but not "IMG_0120".
    const value = Number(q);
    matches = photos
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => (stripExt(p.name).match(/\d+/g) || []).some(group => Number(group) === value));
  } else {
    matches = photos.map((p, index) => ({ p, index })).filter(({ p }) => fold(p.name).includes(q));
  }

  if (matches.length === 1) return { index: matches[0].index };
  if (matches.length === 0 && direction) {
    const digits = q.match(/(\d+)$/);
    const snapped = digits && snapToNearest(photos, Number(digits[1]), direction);
    if (snapped) return { index: snapped.index, snapped: snapped.name, snappedNumber: snapped.n };
  }
  if (matches.length === 0) return { error: `Không tìm thấy ảnh nào khớp “${query}”.` };
  const sample = matches.slice(0, 3).map(({ p }) => p.name).join(', ');
  return { error: `“${query}” khớp ${matches.length} ảnh (${sample}${matches.length > 3 ? ', …' : ''}). Hãy gõ tên đầy đủ hơn.` };
}

function findByIndex(photos, query) {
  const text = String(query).trim();
  if (!/^\d+$/.test(text)) return { error: `STT “${query}” phải là số.` };
  const n = Number(text);
  if (n < 1 || n > photos.length) return { error: `STT ${n} nằm ngoài danh sách (1 – ${photos.length}).` };
  return { index: n - 1 };
}

export function resolvePhotoRange(photos, from, to, mode = 'index') {
  if (!photos.length) return { error: 'Không có ảnh nào trong danh sách hiện tại.' };
  if (!String(from ?? '').trim()) return { error: 'Vui lòng nhập điểm bắt đầu.' };
  const toText = String(to ?? '').trim() ? to : from;

  const find = mode === 'name' ? findByName : findByIndex;
  const fromNum = Number(String(from).match(/(\d+)\s*$/)?.[1]);
  const toNum = Number(String(toText).match(/(\d+)\s*$/)?.[1]);
  const descending = fromNum > toNum;
  const start = find(photos, from, descending ? 'down' : 'up');
  if (start.error) return { error: start.error };
  const end = find(photos, toText, descending ? 'up' : 'down');
  if (end.error) return { error: end.error };

  if (start.snapped || end.snapped) {
    const a = start.snappedNumber ?? fromNum;
    const b = end.snappedNumber ?? toNum;
    if (descending ? a < b : a > b) return { error: `Không có ảnh nào trong khoảng “${from}” – “${toText}”.` };
  }

  const lo = Math.min(start.index, end.index);
  const hi = Math.max(start.index, end.index);
  const snapped = [start.snapped && `“${from}” → ${start.snapped}`, end.snapped && `“${toText}” → ${end.snapped}`].filter(Boolean);
  return { photos: photos.slice(lo, hi + 1), startIndex: lo, endIndex: hi, snapped };
}

// ---------------------------------------------------------------------------
// Several ranges / single photos in one text, optionally one folder per line.
//   "6832-6840, 6855, 6900 đến 6912"
//   "Ảnh cổng: 6832-6840\nAlbum cưới: 6900-6950, 7001"

const WORD_SEPARATORS = [/\s*(?:->|→|–|—|\.\.)\s*/, /\s+(?:đến|den|tới|toi|to)\s+/i, /\s+-\s+/];

function splitRange(token) {
  for (const separator of WORD_SEPARATORS) {
    const parts = token.split(separator);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) return [parts[0].trim(), parts[1].trim()];
  }
  // Plain "-": split where both sides look like photo numbers ("6832-6840", "IMG-12-IMG-20").
  for (let i = token.indexOf('-'); i > 0; i = token.indexOf('-', i + 1)) {
    const left = token.slice(0, i).trim();
    const right = token.slice(i + 1).trim();
    if (/\d$/.test(left) && /\d/.test(right)) return [left, right];
  }
  return null;
}

function resolveSingle(photos, token, mode) {
  return mode === 'name' ? findByName(photos, token) : findByIndex(photos, token);
}

function exactName(photos, token) {
  const q = fold(token);
  return photos.some(p => fold(p.name) === q || fold(stripExt(p.name)) === q);
}

export function resolvePhotoSpec(photos, spec, mode = 'index') {
  const items = [];
  const picked = new Set();
  const pieces = String(spec ?? '').split(/[,;\n]+/).map(piece => piece.trim()).filter(Boolean);

  for (const piece of pieces) {
    const range = mode === 'name' && exactName(photos, piece) ? null : splitRange(piece);
    if (range) {
      const result = resolvePhotoRange(photos, range[0], range[1], mode);
      if (result.error) items.push({ text: piece, error: result.error });
      else {
        for (let i = result.startIndex; i <= result.endIndex; i++) picked.add(i);
        items.push({ text: piece, count: result.photos.length, snapped: result.snapped });
      }
      continue;
    }
    // "6832 6840 6855" — a plain list separated by spaces.
    const singles = mode === 'name' && exactName(photos, piece) ? [piece] : piece.split(/\s+/);
    for (const single of singles) {
      const result = resolveSingle(photos, single, mode);
      if (result.error) items.push({ text: single, error: result.error });
      else {
        picked.add(result.index);
        items.push({ text: single, count: 1 });
      }
    }
  }

  const indexes = [...picked].sort((a, b) => a - b);
  return {
    photos: indexes.map(i => photos[i]),
    items,
    errors: items.filter(item => item.error).map(item => item.error),
  };
}

export function sanitizeFolderName(name) {
  const clean = String(name ?? '').trim().replace(/[/\\:*?"<>|]/g, '-');
  return clean === '.' || clean === '..' ? '' : clean;
}

export function resolvePhotoGrouping(photos, text, mode = 'index') {
  const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  const labeled = lines.some(line => line.includes(':'));

  if (!labeled) {
    const result = resolvePhotoSpec(photos, lines.join(','), mode);
    return { multi: false, groups: [{ folder: null, ...result }], photos: result.photos, errors: result.errors };
  }

  const byFolder = new Map();
  const errors = [];
  lines.forEach((line, index) => {
    const colon = line.indexOf(':');
    if (colon < 0) {
      errors.push(`Dòng ${index + 1} thiếu tên thư mục (dạng “Tên thư mục: 1-20”).`);
      return;
    }
    const folder = sanitizeFolderName(line.slice(0, colon));
    if (!folder) {
      errors.push(`Dòng ${index + 1} có tên thư mục không hợp lệ.`);
      return;
    }
    const spec = line.slice(colon + 1);
    const key = folder.toLowerCase();
    const group = byFolder.get(key) ?? { folder, specs: [] };
    group.specs.push(spec);
    byFolder.set(key, group);
  });

  const owner = new Map();
  const groups = [...byFolder.values()].map(({ folder, specs }) => {
    const result = resolvePhotoSpec(photos, specs.join(','), mode);
    for (const error of result.errors) errors.push(`${folder}: ${error}`);
    for (const photo of result.photos) {
      const other = owner.get(photo.relPath);
      if (other && other !== folder) errors.push(`${photo.name} nằm trong cả “${other}” và “${folder}”.`);
      else owner.set(photo.relPath, folder);
    }
    return { folder, ...result };
  });

  const order = new Map(photos.map((photo, index) => [photo.relPath, index]));
  const all = [...owner.keys()].sort((a, b) => order.get(a) - order.get(b)).map(relPath => photos[order.get(relPath)]);
  return { multi: true, groups, photos: all, errors };
}
