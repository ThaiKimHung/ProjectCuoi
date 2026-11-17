import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { makeProject, startServer } from './helpers/serverProcess.js';

// fetch() won't let a caller choose the Host header, so send the request by hand.
function getWithHost(port, pathname, host) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, headers: { Host: host } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
}

test('server refuses requests addressed to another host name (DNS rebinding)', async t => {
  const { project, elsewhere } = await makeProject(t);
  const { port } = await startServer(t, project, elsewhere);

  assert.equal(await getWithHost(port, '/api/browse-filesystem', `attacker.example:${port}`), 403);
  assert.equal(await getWithHost(port, '/api/config', `127.0.0.1:${port}`), 200);
  assert.equal(await getWithHost(port, '/api/config', `localhost:${port}`), 200);
});
