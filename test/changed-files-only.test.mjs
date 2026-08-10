import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('changed-files-only sync preserves newer destination files', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-gui-changed-only-'));
  const source = path.join(tmp, 'source');
  const destination = path.join(tmp, 'destination');
  const configPath = path.join(tmp, 'sync-config.json');
  const oldTime = new Date('2026-01-01T00:00:00Z');
  const newTime = new Date('2026-01-02T00:00:00Z');

  await fsp.mkdir(source);
  await fsp.mkdir(destination);
  await fsp.writeFile(path.join(source, 'a.txt'), 'local changed');
  await fsp.writeFile(path.join(destination, 'a.txt'), 'old target');
  await fsp.writeFile(path.join(source, 'b.txt'), 'old local');
  await fsp.writeFile(path.join(destination, 'b.txt'), 'server changed');
  await fsp.writeFile(path.join(destination, 'server-only.txt'), 'server only');
  await fsp.utimes(path.join(source, 'a.txt'), newTime, newTime);
  await fsp.utimes(path.join(destination, 'a.txt'), oldTime, oldTime);
  await fsp.utimes(path.join(source, 'b.txt'), oldTime, oldTime);
  await fsp.utimes(path.join(destination, 'b.txt'), newTime, newTime);
  await fsp.writeFile(configPath, JSON.stringify({
    settings: { restrictToChangedFiles: true },
    remotes: [{ id: 'local', name: 'Local', kind: 'local' }],
    projects: [],
    items: [{
      id: 'project',
      name: 'Project',
      source,
      type: 'folder',
      targets: [{ remoteIds: ['local'], dest: destination }]
    }]
  }));

  process.env.SYNC_CONFIG = configPath;
  const { runSync } = await import(`../lib/sync.js?changed-only=${Date.now()}`);
  const result = await runSync({ direction: 'up', itemTargets: { project: [0] } });

  assert.equal(result.exitCode, 0, result.output);
  assert.equal(await fsp.readFile(path.join(destination, 'a.txt'), 'utf8'), 'local changed');
  assert.equal(await fsp.readFile(path.join(destination, 'b.txt'), 'utf8'), 'server changed');
  assert.equal(await fsp.readFile(path.join(destination, 'server-only.txt'), 'utf8'), 'server only');
});
