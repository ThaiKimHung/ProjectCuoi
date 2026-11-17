import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fs from 'fs-extra';
import { initStorage } from '../server/storage.js';

test('startup removes stale state temp files but keeps fresh ones', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-tmp-'));
  t.after(() => fs.remove(dir));
  const photos = path.join(dir, 'photos');
  await fs.ensureDir(photos);
  const stale = path.join(dir, 'viewed_state.json.tmp.1.1.abcd');
  const fresh = path.join(dir, 'viewed_state.json.tmp.2.2.efgh');
  const other = path.join(dir, 'notes.tmp.1.1.abcd');
  for (const file of [stale, fresh, other]) await fs.writeFile(file, '{}');
  const old = new Date(Date.now() - 10 * 60_000);
  await fs.utimes(stale, old, old);
  await fs.utimes(other, old, old);

  await initStorage({ dataDir: dir, photosDir: photos });

  assert.equal(await fs.pathExists(stale), false);
  assert.equal(await fs.pathExists(fresh), true);
  assert.equal(await fs.pathExists(other), true);
});
