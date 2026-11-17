import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A throwaway copy of the app (real server code, shared node_modules) plus a separate
// working directory, so the server can be started from outside its project folder.
export async function makeProject(t) {
  const sandbox = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'curator-root-')));
  t.after(() => fs.remove(sandbox));
  const project = path.join(sandbox, 'project');
  const elsewhere = path.join(sandbox, 'elsewhere');
  await fs.copy(path.join(repoRoot, 'server'), path.join(project, 'server'));
  await fs.copy(path.join(repoRoot, 'package.json'), path.join(project, 'package.json'));
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(project, 'node_modules'), 'dir');
  await fs.ensureDir(elsewhere);
  return { project, elsewhere };
}

async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

// Starts the project's server/index.js with `cwd` as working directory; resolves once listening.
export async function startServer(t, project, cwd) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  delete env.DATA_DIR;
  delete env.CURATOR_CACHE_DIR;
  const child = spawn(process.execPath, [path.join(project, 'server', 'index.js')], { cwd, env });
  t.after(() => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  }));

  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10_000);
    const onData = chunk => {
      output += chunk;
      if (/running on/.test(output)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  return { url: `http://127.0.0.1:${port}`, port };
}
