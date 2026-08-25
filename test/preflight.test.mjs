import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-gui-preflight-'));
process.env.SYNC_CONFIG = path.join(root, 'sync-config.json');

const { runSync } = await import(`../lib/sync.js?preflight=${Date.now()}`);
const { preflightSync, trustCurrentState } = await import(`../lib/preflight.js?preflight=${Date.now()}`);

async function setup(existingTarget = false) {
  const source = path.join(root, `source-${Date.now()}-${Math.random()}`);
  const target = path.join(root, `target-${Date.now()}-${Math.random()}`);
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'a.txt'), 'original');
  if (existingTarget) {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'target.txt'), 'independent target file');
  }
  const config = {
    remotes: [{ id: 'local', name: 'Local', kind: 'local' }],
    projects: [{ id: 'project', name: 'Test', remoteId: 'local' }],
    categories: [],
    settings: {},
    items: [{
      id: 'item',
      name: 'Test item',
      source,
      type: 'folder',
      projectId: 'project',
      targets: [{ name: 'Target', remoteIds: ['local'], dest: target }],
    }],
  };
  await fs.writeFile(process.env.SYNC_CONFIG, JSON.stringify(config), 'utf8');
  return { source, target, config, itemTargets: { item: [0] } };
}

test('preflight records a baseline and accepts only local changes', async () => {
  const { source, target, config, itemTargets } = await setup();
  const initial = await preflightSync({ config, itemTargets });
  assert.equal(initial.safe, true);
  assert.equal(initial.needsBaseline, true);

  const sync = await runSync({ direction: 'up', itemTargets });
  assert.equal(sync.exitCode, 0, sync.output);

  await fs.writeFile(path.join(source, 'a.txt'), 'changed!');
  const localChange = await preflightSync({ config, itemTargets });
  assert.equal(localChange.safe, true);
  assert.equal(localChange.summary.expectedLocal, 1);

  await fs.writeFile(path.join(target, 'target-only.txt'), 'remote edit');
  const targetChange = await preflightSync({ config, itemTargets });
  assert.equal(targetChange.safe, false);
  assert.equal(targetChange.summary.targetDrift, 1);
});

test('preflight reports a conflict when both sides changed', async () => {
  const { source, target, config, itemTargets } = await setup();
  await runSync({ direction: 'up', itemTargets });
  await fs.writeFile(path.join(source, 'a.txt'), 'local edit');
  await fs.writeFile(path.join(target, 'a.txt'), 'target edit');

  const result = await preflightSync({ config, itemTargets });
  assert.equal(result.safe, false);
  assert.equal(result.summary.conflicts, 1);
});

test('existing targets require explicit trust before a baseline exists', async () => {
  const { config, itemTargets } = await setup(true);
  const result = await preflightSync({ config, itemTargets });
  assert.equal(result.safe, false);
  assert.equal(result.baselineReady, false);

  await trustCurrentState({ config, itemTargets });
  const trusted = await preflightSync({ config, itemTargets });
  assert.equal(trusted.safe, true);
  assert.equal(trusted.baselineReady, true);
});
