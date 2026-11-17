import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fs from 'fs-extra';
import { deleteVirtualAlbum, initStorage, togglePhotoInVirtualAlbum, updateAlbumQuota } from '../server/storage.js';

test('album operations reject inherited object keys instead of writing to Object.prototype', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'album-id-safety-'));
  t.after(() => fs.remove(temp));
  await initStorage({ dataDir: path.join(temp, 'data'), photosDir: path.join(temp, 'photos') });

  for (const albumId of ['__proto__', 'constructor', 'toString']) {
    await assert.rejects(togglePhotoInVirtualAlbum(albumId, 'a.jpg'), /không tồn tại/);
    await assert.rejects(updateAlbumQuota(albumId, 5), /không tồn tại/);
    await assert.rejects(deleteVirtualAlbum(albumId), /không tồn tại/);
  }
  assert.equal({}.photos, undefined);
  assert.equal({}.quota, undefined);
});
