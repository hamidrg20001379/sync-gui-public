import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('runs post-sync commands only after a successful upload', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-gui-post-sync-'));
  const source = path.join(root, 'source.txt');
  const destination = path.join(root, 'destination.txt');
  const configPath = path.join(root, 'sync-config.json');
  await fsp.writeFile(source, 'synced');
  await fsp.writeFile(configPath, JSON.stringify({
    remotes: [{ id: 'local', name: 'Local', kind: 'local' }],
    projects: [],
    items: [{
      id: 'source', name: 'Source', source, type: 'file',
      targets: [{ remoteIds: ['local'], dest: destination, postSyncCommand: 'printf hook-ran' }],
    }],
  }));

  process.env.SYNC_CONFIG = configPath;
  const { runSync } = await import(`../lib/sync.js?post-sync=${Date.now()}`);
  const success = await runSync({ direction: 'up', itemTargets: { source: [0] } });
  assert.equal(success.exitCode, 0, success.output);
  assert.match(success.output, /hook-ran/);

  await fsp.rm(source);
  const failed = await runSync({ direction: 'up', itemTargets: { source: [0] } });
  assert.notEqual(failed.exitCode, 0);
  assert.doesNotMatch(failed.output, /hook-ran/);
});
