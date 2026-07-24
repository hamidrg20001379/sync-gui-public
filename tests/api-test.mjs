import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3456;
const BASE = `http://localhost:${PORT}`;

let server, tmpDir;

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json();
  return { status: r.status, data, ok: r.ok };
}

// Wait for server to be ready
async function waitForServer(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Server did not start within timeout');
}

before(async () => {
  // Create tmp dir for test data
  tmpDir = await mkdtemp(join(tmpdir(), 'sync-gui-test-'));
  process.env.SYNC_CONFIG = join(tmpDir, 'sync-config.json');
  process.env.SYNC_GUI_PORT = String(PORT);

  // Start dev server
  server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let output = '';
  server.stdout.on('data', d => { output += d.toString(); });
  server.stderr.on('data', d => { output += d.toString(); });

  await waitForServer();
});

after(() => {
  if (server) server.kill();
  rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ─── Config API ───────────────────────────────────────────

describe('Config API', () => {
  it('returns default config when no file exists', async () => {
    const { status, data } = await fetchJson(`${BASE}/api/config`);
    assert.equal(status, 200);
    assert.deepEqual(data.config.remotes, []);
    assert.deepEqual(data.config.projects, []);
    assert.deepEqual(data.config.items, []);
  });

  it('saves and retrieves config', async () => {
    const testConfig = {
      remotes: [{ id: 'r1', name: 'Test', kind: 'local' }],
      projects: [{ id: 'p1', name: 'TestProj', remoteId: 'r1' }],
      items: [{ id: 'i1', name: 'TestItem', source: '/a', dest: '/b', type: 'folder', projectId: 'p1' }],
    };
    const r1 = await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: testConfig }),
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.data.ok, true);

    const r2 = await fetchJson(`${BASE}/api/config`);
    assert.equal(r2.status, 200);
    assert.equal(r2.data.config.remotes.length, 1);
    assert.equal(r2.data.config.projects.length, 1);
    assert.equal(r2.data.config.items.length, 1);
    assert.equal(r2.data.config.items[0].name, 'TestItem');
  });

  it('migrates old flat format (items with inline connection)', async () => {
    const oldConfig = {
      items: [
        { id: 'x1', name: 'X', source: '/a', dest: '/b', type: 'folder', connection: { kind: 'ssh', host: '1.2.3.4', port: 22, username: 'u', password: 'p' }, group: 'G' },
        { id: 'x2', name: 'Y', source: '/c', dest: '/d', type: 'file', connection: { kind: 'ssh', host: '1.2.3.4', port: 22, username: 'u', password: 'p' }, group: 'G' },
      ],
    };
    const r = await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: oldConfig }),
    });
    assert.equal(r.status, 200);

    const r2 = await fetchJson(`${BASE}/api/config`);
    const cfg = r2.data.config;
    assert.equal(cfg.remotes.length, 1);
    assert.equal(cfg.remotes[0].host, '1.2.3.4');
    assert.equal(cfg.projects.length, 1);
    assert.equal(cfg.projects[0].name, 'G');
    assert.equal(cfg.items.length, 2);
    assert.equal(cfg.items[0].projectId, cfg.projects[0].id);
    assert.equal(cfg.items[1].projectId, cfg.projects[0].id);
    assert.ok(!cfg.items[0].connection);
  });
});

// ─── Sync API ─────────────────────────────────────────────

describe('Sync API', () => {
  let srcDir, subDir, srcFile, destDir;

  before(async () => {
    srcDir = join(tmpDir, 'src');
    subDir = join(srcDir, 'sub');
    destDir = join(tmpDir, 'dest');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(srcDir, 'a.txt'), 'hello');
    await writeFile(join(subDir, 'b.txt'), 'world');
    srcFile = join(tmpDir, 'single.txt');
    await writeFile(srcFile, 'single file content');
  });

  it('syncs a folder up (local to local)', async () => {
    // Set up config with local sync
    const cfg = {
      remotes: [{ id: 'r1', name: 'Local', kind: 'local' }],
      projects: [{ id: 'p1', name: 'Test', remoteId: 'r1' }],
      items: [{ id: 'i1', name: 'FolderSync', source: srcDir, dest: destDir, type: 'folder', projectId: 'p1' }],
    };
    await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });

    const r = await fetchJson(`${BASE}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up', dryRun: false, noDelete: false, itemIds: ['i1'] }),
    });
    assert.equal(r.status, 202);
    assert.ok(r.data.id);

    // Poll until done
    let job;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetchJson(`${BASE}/api/run?id=${r.data.id}`);
      job = res.data;
      if (job.status !== 'running') break;
    }
    assert.equal(job.status, 'succeeded');

    // Check files were copied
    const contentA = await readFile(join(destDir, 'a.txt'), 'utf8');
    assert.equal(contentA, 'hello');
    const contentB = await readFile(join(destDir, 'sub', 'b.txt'), 'utf8');
    assert.equal(contentB, 'world');
  });

  it('syncs a file up', async () => {
    const destFile = join(tmpDir, 'single-copy.txt');
    const cfg = {
      remotes: [{ id: 'r1', name: 'Local', kind: 'local' }],
      projects: [{ id: 'p1', name: 'Test', remoteId: 'r1' }],
      items: [{ id: 'i2', name: 'FileSync', source: srcFile, dest: destFile, type: 'file', projectId: 'p1' }],
    };
    await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });

    const r = await fetchJson(`${BASE}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up', dryRun: false, noDelete: false, itemIds: ['i2'] }),
    });
    assert.equal(r.status, 202);

    let job;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetchJson(`${BASE}/api/run?id=${r.data.id}`);
      job = res.data;
      if (job.status !== 'running') break;
    }
    assert.equal(job.status, 'succeeded');
    const content = await readFile(destFile, 'utf8');
    assert.equal(content, 'single file content');
  });

  it('dry-run does not copy files', async () => {
    const noCopy = join(tmpDir, 'should-not-exist.txt');
    const cfg = {
      remotes: [{ id: 'r1', name: 'Local', kind: 'local' }],
      projects: [{ id: 'p1', name: 'Test', remoteId: 'r1' }],
      items: [{ id: 'i3', name: 'DryRun', source: srcFile, dest: noCopy, type: 'file', projectId: 'p1' }],
    };
    await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });

    const r = await fetchJson(`${BASE}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up', dryRun: true, noDelete: false, itemIds: ['i3'] }),
    });
    assert.equal(r.status, 202);

    let job;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetchJson(`${BASE}/api/run?id=${r.data.id}`);
      job = res.data;
      if (job.status !== 'running') break;
    }
    assert.equal(job.status, 'succeeded');
    assert.ok(job.output.includes('Would copy'));

    // File should NOT exist
    try { await readFile(noCopy); assert.fail('File should not exist'); }
    catch (e) { assert.ok(e.code === 'ENOENT'); }
  });

  it('returns error for missing source', async () => {
    const cfg = {
      remotes: [{ id: 'r1', name: 'Local', kind: 'local' }],
      projects: [{ id: 'p1', name: 'Test', remoteId: 'r1' }],
      items: [{ id: 'i4', name: 'Missing', source: '/nonexistent/path', dest: '/tmp/x', type: 'file', projectId: 'p1' }],
    };
    await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });

    const r = await fetchJson(`${BASE}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up', dryRun: false, noDelete: false, itemIds: ['i4'] }),
    });
    assert.equal(r.status, 202);

    let job;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetchJson(`${BASE}/api/run?id=${r.data.id}`);
      job = res.data;
      if (job.status !== 'running') break;
    }
    assert.equal(job.status, 'failed');
    assert.ok(job.output.includes('Not found'));
  });
});

// ─── History API ──────────────────────────────────────────

describe('History API', () => {
  it('returns history list', async () => {
    const { status, data } = await fetchJson(`${BASE}/api/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.history));
  });

  it('contains jobs from previous syncs', async () => {
    const { data } = await fetchJson(`${BASE}/api/history`);
    assert.ok(data.history.length > 0);
    const job = data.history[0];
    assert.ok(job.id);
    assert.ok(job.status);
    assert.ok(Array.isArray(job.itemIds));
  });
});

// ─── Sync down (reverse direction) ────────────────────────

describe('Sync down direction', () => {
  it('syncs from dest back to source', async () => {
    const origSrc = join(tmpDir, 'down-orig.txt');
    const dest = join(tmpDir, 'down-dest.txt');
    await writeFile(origSrc, 'sync down test');

    // First sync up
    const cfg1 = {
      remotes: [{ id: 'r1', name: 'Local', kind: 'local' }],
      projects: [{ id: 'p1', name: 'Test', remoteId: 'r1' }],
      items: [{ id: 'd1', name: 'DownSync', source: origSrc, dest, type: 'file', projectId: 'p1' }],
    };
    await fetchJson(`${BASE}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg1 }),
    });

    // Modify dest
    await writeFile(dest, 'modified at dest');

    // Sync down (dest → source)
    const r = await fetchJson(`${BASE}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'down', dryRun: false, noDelete: false, itemIds: ['d1'] }),
    });

    let job;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetchJson(`${BASE}/api/run?id=${r.data.id}`);
      job = res.data;
      if (job.status !== 'running') break;
    }
    assert.equal(job.status, 'succeeded');

    const content = await readFile(origSrc, 'utf8');
    assert.equal(content, 'modified at dest');
  });
});

console.log('\nAll API tests completed.');
