import fs from 'fs-extra';

/**
 * Lightweight, zero-dependency EXIF parser for JPEG files.
 * Reads only the initial header bytes (up to 64KB) to avoid loading multi-megabyte photos into memory.
 */
export async function readExifFromFile(filePath) {
  let fd = null;
  try {
    fd = await fs.open(filePath, 'r');
    // 64KB is typically more than enough for all EXIF metadata headers
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await fs.read(fd, buffer, 0, 65536, 0);
    if (bytesRead < 32) return null;

    return parseJpegExif(buffer.subarray(0, bytesRead));
  } catch (err) {
    return null;
  } finally {
    if (fd !== null) {
      try { await fs.close(fd); } catch {}
    }
  }
}

/**
 * Parses EXIF data from JPEG APP1 marker
 */
export function parseJpegExif(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 14) return null;
  // Verify JPEG SOI marker (0xFFD8)
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

  let offset = 2;
  while (offset < buffer.length - 4) {
    if (buffer[offset] !== 0xFF) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];
    // SOS (Start of Scan) - image data starts, no more metadata
    if (marker === 0xDA || marker === 0xD9) break;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;

    // APP1 marker (0xFFE1) - contains EXIF
    if (marker === 0xE1) {
      const exifHeaderOffset = offset + 4;
      // Check for "Exif\0\0"
      if (
        buffer.length >= exifHeaderOffset + 6 &&
        buffer.toString('ascii', exifHeaderOffset, exifHeaderOffset + 4) === 'Exif' &&
        buffer[exifHeaderOffset + 4] === 0x00 &&
        buffer[exifHeaderOffset + 5] === 0x00
      ) {
        const tiffOffset = exifHeaderOffset + 6;
        return parseTiffHeader(buffer.subarray(tiffOffset, offset + 2 + length));
      }
    }

    offset += 2 + length;
  }

  return null;
}

function parseTiffHeader(tiffBuf) {
  if (tiffBuf.length < 8) return null;

  const isLE = tiffBuf[0] === 0x49 && tiffBuf[1] === 0x49; // 'II'
  const isBE = tiffBuf[0] === 0x4D && tiffBuf[1] === 0x4D; // 'MM'
  if (!isLE && !isBE) return null;

  const readU16 = (pos) => isLE ? tiffBuf.readUInt16LE(pos) : tiffBuf.readUInt16BE(pos);
  const readU32 = (pos) => isLE ? tiffBuf.readUInt32LE(pos) : tiffBuf.readUInt32BE(pos);

  // Check 0x002A
  if (readU16(2) !== 42) return null;

  const ifd0Offset = readU32(4);
  if (ifd0Offset >= tiffBuf.length) return null;

  const result = {};

  function readTagValue(type, count, valOrOffset) {
    if (type === 2) { // ASCII
      const strOffset = count <= 4 ? valOrOffset : valOrOffset;
      if (strOffset + count <= tiffBuf.length) {
        let str = tiffBuf.toString('utf-8', strOffset, strOffset + count);
        // Strip trailing nulls
        const nullIdx = str.indexOf('\0');
        if (nullIdx !== -1) str = str.slice(0, nullIdx);
        return str.trim();
      }
      return null;
    }
    if (type === 3) { // SHORT
      return valOrOffset & 0xFFFF;
    }
    if (type === 4) { // LONG
      return valOrOffset;
    }
    if (type === 5) { // RATIONAL (numerator / denominator)
      if (valOrOffset + 8 <= tiffBuf.length) {
        const num = readU32(valOrOffset);
        const den = readU32(valOrOffset + 4);
        if (den === 0) return 0;
        return num / den;
      }
      return null;
    }
    return null;
  }

  function parseIFD(offset) {
    if (offset + 2 > tiffBuf.length) return;
    const numEntries = readU16(offset);
    let entryOffset = offset + 2;

    for (let i = 0; i < numEntries; i++) {
      if (entryOffset + 12 > tiffBuf.length) break;
      const tag = readU16(entryOffset);
      const type = readU16(entryOffset + 2);
      const count = readU32(entryOffset + 4);
      let valOrOffset;

      // In TIFF, if data fits in 4 bytes, it's stored directly in entryOffset + 8
      if (type === 3 && count === 1) { // 2 bytes
        valOrOffset = isLE ? tiffBuf.readUInt16LE(entryOffset + 8) : tiffBuf.readUInt16BE(entryOffset + 8);
      } else if ((type === 1 || type === 2) && count <= 4) {
        valOrOffset = entryOffset + 8;
      } else {
        valOrOffset = readU32(entryOffset + 8);
      }

      switch (tag) {
        case 0x010F: // Make
          result.make = readTagValue(type, count, valOrOffset);
          break;
        case 0x0110: // Model
          result.model = readTagValue(type, count, valOrOffset);
          break;
        case 0x8769: // Exif SubIFD Offset
          if (valOrOffset < tiffBuf.length) {
            parseIFD(valOrOffset);
          }
          break;
        case 0x829A: { // ExposureTime
          const sec = readTagValue(type, count, valOrOffset);
          if (sec) {
            if (sec < 1) {
              result.shutterSpeed = `1/${Math.round(1 / sec)}s`;
            } else {
              result.shutterSpeed = `${sec}s`;
            }
          }
          break;
        }
        case 0x829D: { // FNumber
          const f = readTagValue(type, count, valOrOffset);
          if (f) result.aperture = `f/${Math.round(f * 10) / 10}`;
          break;
        }
        case 0x8827: { // ISO
          const iso = readTagValue(type, count, valOrOffset);
          if (iso) result.iso = `ISO ${iso}`;
          break;
        }
        case 0x9003: // DateTimeOriginal
        case 0x9004: // DateTimeDigitized
          if (!result.dateTimeOriginal) {
            result.dateTimeOriginal = readTagValue(type, count, valOrOffset);
          }
          break;
        case 0x920A: { // FocalLength
          const fl = readTagValue(type, count, valOrOffset);
          if (fl) result.focalLength = `${Math.round(fl)}mm`;
          break;
        }
        case 0xA434: // LensModel
          result.lens = readTagValue(type, count, valOrOffset);
          break;
      }

      entryOffset += 12;
    }
  }

  parseIFD(ifd0Offset);

  // Clean up camera model string
  let camera = result.model || result.make || null;
  if (result.make && result.model && !result.model.toLowerCase().includes(result.make.toLowerCase())) {
    camera = `${result.make} ${result.model}`;
  }

  return {
    camera: camera ? camera.replace(/\0/g, '').trim() : null,
    lens: result.lens ? result.lens.replace(/\0/g, '').trim() : null,
    focalLength: result.focalLength || null,
    aperture: result.aperture || null,
    shutterSpeed: result.shutterSpeed || null,
    iso: result.iso || null,
    dateTimeOriginal: result.dateTimeOriginal ? result.dateTimeOriginal.replace(/\0/g, '').trim() : null,
  };
}
