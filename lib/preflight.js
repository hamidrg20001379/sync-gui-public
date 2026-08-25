import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { statePath } from './config.js';
import {
  expandPathPairs,
  hasPathTokens,
  readSyncIgnore,
  resolveSyncMappings,
  runBashProcess,
  shq,
  sshKnownHostsOption,
} from './sync.js';
import { sshInvocation } from './ssh.js';

const maxReportedChanges = 100;
let stateWriteQueue = Promise.resolve();

export async function preflightSync({ config, direction = 'up', itemTargets = {} }) {
  const mappings = resolveSyncMappings(config, direction, itemTargets);
  const state = await readState();
  const result = {
    safe: true,
    baselineReady: true,
    needsBaseline: false,
    summary: { expectedLocal: 0, targetDrift: 0, conflicts: 0, unchanged: 0 },
    mappings: [],
  };

  for (const mapping of mappings) {
    const concreteMappings = await expandConcreteMappings(mapping);
    for (const concrete of concreteMappings) {
      const key = mappingKey(mapping, concrete);
      const baseline = state.mappings[key];
      const current = await snapshotSides(mapping, concrete);
      const entry = {
        key,
        itemId: mapping.item.id,
        itemName: mapping.item.name,
        targetIndex: mapping.targetIndex,
        targetName: mapping.target.name || `Target ${mapping.targetIndex + 1}`,
        remoteName: mapping.remote.name || mapping.remote.id || 'local',
        source: concrete.localPath,
        destination: concrete.targetPath,
        status: 'safe',
        changes: [],
      };

      if (!baseline) {
        result.baselineReady = false;
        if (Object.keys(current.target).length) {
          entry.status = 'baseline-missing';
          result.safe = false;
        } else {
          entry.status = 'initial-safe';
          result.needsBaseline = true;
        }
        result.mappings.push(entry);
        continue;
      }

      const changes = compareSnapshots(baseline, current);
      entry.changes = changes.slice(0, maxReportedChanges);
      for (const change of changes) result.summary[change.kind] += 1;
      if (changes.some(change => change.kind === 'conflicts')) {
        entry.status = 'conflict';
        result.safe = false;
      } else if (changes.some(change => change.kind === 'targetDrift')) {
        entry.status = 'target-drift';
        result.safe = false;
      } else if (changes.some(change => change.kind === 'expectedLocal')) {
        entry.status = 'expected-local-change';
      } else {
        entry.status = 'unchanged';
      }
      result.mappings.push(entry);
    }
  }
  return result;
}

export async function trustCurrentState({ config, direction = 'up', itemTargets = {} }) {
  const mappings = resolveSyncMappings(config, direction, itemTargets);
  const records = [];
  for (const mapping of mappings) {
    for (const concrete of await expandConcreteMappings(mapping)) {
      const current = await snapshotSides(mapping, concrete);
      records.push({
        key: mappingKey(mapping, concrete),
        itemId: mapping.item.id,
        itemName: mapping.item.name,
        targetIndex: mapping.targetIndex,
        targetName: mapping.target.name || `Target ${mapping.targetIndex + 1}`,
        remoteName: mapping.remote.name || mapping.remote.id || 'local',
        source: concrete.localPath,
        destination: concrete.targetPath,
        local: current.local,
        target: current.target,
        recordedAt: new Date().toISOString(),
      });
    }
  }
  await mergeState(records);
  return { trusted: records.length };
}

export async function recordBaseline(mapping) {
  const records = [];
  for (const concrete of await expandConcreteMappings(mapping)) {
    const current = await snapshotSides(mapping, concrete);
    records.push({
      key: mappingKey(mapping, concrete),
      itemId: mapping.item.id,
      itemName: mapping.item.name,
      targetIndex: mapping.targetIndex,
      targetName: mapping.target.name || `Target ${mapping.targetIndex + 1}`,
      remoteName: mapping.remote.name || mapping.remote.id || 'local',
      source: concrete.localPath,
      destination: concrete.targetPath,
      local: current.local,
      target: current.target,
      recordedAt: new Date().toISOString(),
    });
  }
  await mergeState(records);
}

async function expandConcreteMappings(mapping) {
  if (mapping.targetIsSsh && (hasPathTokens(mapping.localPattern) || hasPathTokens(mapping.targetPattern))) {
    throw new Error('Preflight does not support wildcard SSH uploads. Resolve the paths first.');
  }
  if (!hasPathTokens(mapping.localPattern) && !hasPathTokens(mapping.targetPattern)) {
    return [{
      localPath: path.resolve(mapping.localPattern),
      targetPath: mapping.targetIsSsh ? mapping.targetPattern : path.resolve(mapping.targetPattern),
    }];
  }
  const pairs = await expandPathPairs(
    mapping.item.type,
    mapping.localPattern,
    mapping.targetPattern,
  );
  return pairs.map(pair => ({
    localPath: path.resolve(pair.src),
    targetPath: mapping.targetIsSsh ? pair.dst : path.resolve(pair.dst),
  }));
}

async function snapshotSides(mapping, concrete) {
  const localIgnore = await createIgnoreMatcher(
    concrete.localPath,
    mapping.item.type,
    mapping.item.localSyncIgnore,
  );
  const targetIgnore = mapping.targetIsSsh
    ? await createIgnoreMatcher(
        concrete.localPath,
        mapping.item.type,
        `${mapping.item.localSyncIgnore}\n${mapping.target.remoteSyncIgnore || ''}`,
      )
    : await createIgnoreMatcher(
        concrete.targetPath,
        mapping.item.type,
        mapping.target.remoteSyncIgnore,
      );
  const local = await snapshotLocal(mapping.item.type, concrete.localPath, localIgnore, false);
  const target = mapping.targetIsSsh
    ? await snapshotRemote(mapping.item.type, concrete.targetPath, targetIgnore, mapping.remote)
    : await snapshotLocal(mapping.item.type, concrete.targetPath, targetIgnore, true);
  return { local, target };
}

async function createIgnoreMatcher(root, type, extraContents) {
  if (type === 'file') return () => false;
  return readSyncIgnore(root, extraContents);
}

async function snapshotLocal(type, root, isIgnored, allowMissing) {
  const entries = {};
  let stat;
  try {
    stat = await fsp.stat(root);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return entries;
    throw new Error(`Path not found: ${root}`);
  }

  if (type === 'file') {
    if (!stat.isFile()) throw new Error(`Not a file: ${root}`);
    entries['.'] = await fileFingerprint(root);
    return entries;
  }
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`);
  await walkLocal(root, root, isIgnored, entries);
  return entries;
}

async function walkLocal(root, current, isIgnored, entries) {
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (isIgnored(relative)) continue;
    if (entry.isDirectory()) await walkLocal(root, absolute, isIgnored, entries);
    else if (entry.isFile()) entries[relative] = await fileFingerprint(absolute);
  }
}

async function snapshotRemote(type, root, isIgnored, remote) {
  const command = type === 'file'
    ? `if [ -f ${shq(root)} ]; then sha256sum ${shq(root)}; fi`
    : `if [ -d ${shq(root)} ]; then find ${shq(root)} -type f -exec sha256sum {} +; fi`;
  const ssh = [
    sshInvocation(),
    `-p ${shq(String(remote.port || 22))}`,
    '-o StrictHostKeyChecking=accept-new',
    sshKnownHostsOption(),
    shq(`${remote.username}@${remote.host}`),
    shq(command),
  ].filter(Boolean).join(' ');
  const result = await runBashProcess(ssh, remote.password);
  if (result.code !== 0) throw new Error(result.output || `SSH exited with code ${result.code}.`);

  const entries = {};
  for (const line of result.output.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) continue;
    const remoteFile = match[2];
    const relative = type === 'file' ? '.' : path.posix.relative(root.replace(/\/+$/, ''), remoteFile);
    if (relative && relative !== '.' && !relative.startsWith('../') && !isIgnored(relative)) {
      entries[relative] = { hash: match[1].toLowerCase() };
    } else if (type === 'file' && relative === '.') {
      entries['.'] = { hash: match[1].toLowerCase() };
    }
  }
  return entries;
}

async function fileFingerprint(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { hash: hash.digest('hex') };
}

function compareSnapshots(baseline, current) {
  const paths = new Set([
    ...Object.keys(baseline.local || {}),
    ...Object.keys(baseline.target || {}),
    ...Object.keys(current.local || {}),
    ...Object.keys(current.target || {}),
  ]);
  const changes = [];
  for (const filePath of [...paths].sort()) {
    const baselineLocal = baseline.local?.[filePath]?.hash || null;
    const baselineTarget = baseline.target?.[filePath]?.hash || null;
    const currentLocal = current.local?.[filePath]?.hash || null;
    const currentTarget = current.target?.[filePath]?.hash || null;
    const localChanged = baselineLocal !== currentLocal;
    const targetChanged = baselineTarget !== currentTarget;
    if (targetChanged && localChanged && currentLocal !== currentTarget) {
      changes.push({ path: filePath, kind: 'conflicts' });
    } else if (targetChanged) {
      changes.push({ path: filePath, kind: 'targetDrift' });
    } else if (currentLocal !== currentTarget) {
      changes.push({ path: filePath, kind: 'expectedLocal' });
    }
  }
  return changes;
}

function mappingKey(mapping, concrete) {
  return JSON.stringify([
    mapping.item.id,
    mapping.targetIndex,
    mapping.remote.id || mapping.remote.name || 'local',
    concrete.localPath,
    concrete.targetPath,
  ]);
}

async function readState() {
  try {
    const value = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    return { version: 1, mappings: value.mappings || {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, mappings: {} };
    throw new Error(`Could not read sync state: ${error.message}`);
  }
}

async function mergeState(records) {
  const operation = stateWriteQueue.then(async () => {
    const state = await readState();
    for (const record of records) state.mappings[record.key] = record;
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    await fsp.writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(temporaryPath, statePath);
  });
  stateWriteQueue = operation.catch(() => {});
  return operation;
}
