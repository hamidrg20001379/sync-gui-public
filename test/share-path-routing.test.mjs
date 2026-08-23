import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('share destinations use local sync even when paired with an SSH remote', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-gui-share-routing-'));
  const source = path.join(tmp, 'source');
  const configPath = path.join(tmp, 'sync-config.json');

  await fsp.mkdir(source);
  await fsp.writeFile(path.join(source, 'index.php'), '<?php');
  await fsp.writeFile(configPath, JSON.stringify({
    remotes: [{ id: 'ssh', name: 'Shapoor', kind: 'ssh', host: 'example.test' }],
    projects: [],
    items: [{
      id: 'backend',
      name: 'backend shapoor',
      source,
      type: 'folder',
      targets: [{ remoteIds: ['ssh'], dest: '\\\\192.168.100.208\\www\\backend' }]
    }]
  }));

  process.env.SYNC_CONFIG = configPath;
  const { runSync } = await import('../lib/sync.js?share-routing=' + Date.now());
  const result = await runSync({ direction: 'up', dryRun: true, itemTargets: { backend: [0] } });

  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /Would copy 1 folder/);
});
