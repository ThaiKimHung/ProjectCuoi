import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import fs from 'fs-extra';
import { makeProject, startServer } from './helpers/serverProcess.js';

test('server started from another directory keeps its files in the project folder', async t => {
  const { project, elsewhere } = await makeProject(t);
  await startServer(t, project, elsewhere);

  const config = await fs.readJson(path.join(project, 'data', 'config.json'));
  assert.equal(config.photosDir, path.join(project, 'photos'));
  assert.equal(await fs.pathExists(path.join(project, '.cache')), true);
  assert.deepEqual(await fs.readdir(elsewhere), []);
});

test('server started from another directory serves the built UI', async t => {
  const { project, elsewhere } = await makeProject(t);
  await fs.outputFile(path.join(project, 'client', 'dist', 'index.html'), '<p>curator-ui-marker</p>');
  const { url } = await startServer(t, project, elsewhere);

  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /curator-ui-marker/);
});

test('server applies settings from the project .env file', async t => {
  const { project, elsewhere } = await makeProject(t);
  await fs.writeFile(path.join(project, '.env'), 'DATA_DIR=env-data\n');
  await startServer(t, project, elsewhere);

  assert.equal(await fs.pathExists(path.join(project, 'env-data', 'config.json')), true);
  assert.equal(await fs.pathExists(path.join(project, 'data')), false);
});
