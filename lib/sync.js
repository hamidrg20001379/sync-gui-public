import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig } from './config.js';
import { bashSingleQuote, resolveBashPath, runtimeToolEnv } from './runtime-tools.mjs';

function resolve(item, targetIndex) {
  const target = item.targets?.[targetIndex];
  if (!target) throw new Error(`Item "${item.name}" has no target at index ${targetIndex}`);
  return target;
}

function targetRemoteIds(target) {
  return target.remoteIds?.length ? target.remoteIds : [target.remoteId].filter(Boolean);
}

export async function runSync({ direction = 'up', dryRun = false, noDelete = false, itemTargets = {} }) {
  const config = await readConfig();
  const itemIds = Object.keys(itemTargets);
  const items = itemIds.length ? config.items.filter(i => itemIds.includes(i.id)) : [];

  if (!items.length) {
    if (!itemIds.length) {
      for (const item of config.items) {
        if (!item.targets?.length) continue;
        const allTargets = item.targets.map((_, ti) => ti);
        itemTargets[item.id] = allTargets;
        items.push(item);
      }
    }
  }
  if (!items.length) throw new Error('No items to sync.');

  const chunks = [];
  let finalCode = 0;

  for (const item of items) {
    let targetIndices = itemTargets[item.id] ?? [];
    if (!targetIndices.length) targetIndices = [0];

    if (direction === 'up') {
      for (const ti of targetIndices) {
        const target = resolve(item, ti);
        const project = config.projects.find(p => p.id === item.projectId);
        const remoteIds = targetRemoteIds(target);
        const remotes = remoteIds.length
          ? remoteIds.map(id => config.remotes.find(r => r.id === id)).filter(Boolean)
          : [project ? config.remotes.find(r => r.id === project.remoteId) : null].filter(Boolean);
        if (!remotes.length) remotes.push({ kind: 'local', name: target.name || `target ${ti}` });
        for (const remote of remotes) {
          const label = `${target.name || `target ${ti}`} / ${remote.name || remote.id || 'local'}`;
          chunks.push(`[${item.name} ? ${label}]`);
          const result = remote.kind === 'ssh'
            ? await syncSsh({ item, target, remote, direction, dryRun, noDelete })
            : await syncLocal({ item, target, remote, direction, dryRun, noDelete });
          if (result.output) chunks.push(result.output);
          if (result.code !== 0 && finalCode === 0) finalCode = result.code;
          chunks.push(`[${item.name} ? ${label}] exit ${result.code}`);
        }
      }
    } else {
      if (targetIndices.length > 1) {
        chunks.push(`[${item.name}] ? supports one target, using first.`);
      }
      const ti = targetIndices[0];
      const target = resolve(item, ti);
      const project = config.projects.find(p => p.id === item.projectId);
      const remoteIds = targetRemoteIds(target);
      const remotes = remoteIds.length
        ? remoteIds.map(id => config.remotes.find(r => r.id === id)).filter(Boolean)
        : [project ? config.remotes.find(r => r.id === project.remoteId) : null].filter(Boolean);
      if (!remotes.length) remotes.push({ kind: 'local', name: target.name || `target ${ti}` });
      for (const remote of remotes) {
        const label = `${target.name || ti} / ${remote.name || remote.id || 'local'}`;
        chunks.push(`[${item.name} ? ${label}]`);
        const result = remote.kind === 'ssh'
          ? await syncSsh({ item, target, remote, direction, dryRun, noDelete })
          : await syncLocal({ item, target, remote, direction, dryRun, noDelete });
        if (result.output) chunks.push(result.output);
        if (result.code !== 0 && finalCode === 0) finalCode = result.code;
        chunks.push(`[${item.name} ? ${label}] exit ${result.code}`);
      }
    }
  }

  return { exitCode: finalCode, output: chunks.join('\n') };
}

async function syncSsh({ item, target, remote, direction, dryRun, noDelete }) {
  const values = targetTokenValues(remote, target);
  const local = applyKnownPathTokens(item.source, values);
  const remotePath = applyKnownPathTokens(target.dest, values);
  const source = direction === 'up' ? local : remotePath;
  const dest = direction === 'up' ? remotePath : local;
  if (hasPathTokens(source) || hasPathTokens(dest)) {
    if (direction === 'down') return syncSshWildcardDown({ item, source, dest, remote, dryRun, noDelete, values });
    return { code: 1, output: 'Wildcard capture tokens on SSH targets are only supported for download right now.' };
  }
  const remoteSpec = `${remote.username}@${remote.host}:${remotePath}`;
  const ssh = `sshpass -e ssh -p ${shq(String(remote.port || 22))} -o StrictHostKeyChecking=accept-new`;
  const flags = ['-azs', '--human-readable', '--itemize-changes', '--no-o', '--no-g'];
  if (dryRun) flags.push('--dry-run');
  if (item.type === 'folder' && !noDelete) flags.push('--delete');

  const commands = ['set -Eeuo pipefail'];

  if (direction === 'up') {
    const localSource = toShellPath(source);
    if (!dryRun) {
      const remoteDir = item.type === 'folder' ? dest.replace(/\/+$/, '') : path.posix.dirname(dest);
      commands.push(`${ssh} ${shq(`${remote.username}@${remote.host}`)} ${shq(`mkdir -p -- ${shq(remoteDir)}`)}`);
    }
    const src = item.type === 'folder' ? `${localSource.replace(/\/+$/, '')}/` : localSource;
    const dst = item.type === 'folder' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
    commands.push(`rsync ${flags.join(' ')} -e ${shq(ssh)} ${shq(src)} ${shq(dst)}`);
  } else {
    const localDest = toShellPath(dest);
    if (!dryRun) { const dir = item.type === 'folder' ? localDest : path.posix.dirname(localDest); commands.push(`mkdir -p -- ${shq(dir)}`); }
    const src = item.type === 'folder' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
    const dst = item.type === 'folder' ? `${localDest.replace(/\/+$/, '')}/` : localDest;
    commands.push(`rsync ${flags.join(' ')} -e ${shq(ssh)} ${shq(src)} ${shq(dst)}`);
  }

  return runBash(commands.join('\n'), remote.password);
}

async function syncSshWildcardDown({ item, source, dest, remote, dryRun, noDelete, values }) {
  if (!hasPathTokens(source)) {
    return { code: 1, output: 'Wildcard SSH downloads need {tokens} on the remote source side.' };
  }
  if (item.type !== 'file') {
    return { code: 1, output: 'Wildcard SSH downloads support files right now.' };
  }

  const remoteMatches = await listRemoteMatches(remote, source);
  if (remoteMatches.code !== 0) return remoteMatches;

  const matcher = buildPosixPatternMatcher(source);
  const pairs = remoteMatches.paths
    .map(remotePath => ({ remotePath, values: matcher.match(remotePath) }))
    .filter(entry => entry.values)
    .map(({ remotePath, values: captured }) => ({
      remotePath,
      localPath: applyPathTokens(dest, { ...values, ...captured })
    }));

  if (!pairs.length) return { code: 1, output: `No files matched: ${source}` };
  if (dryRun) return { code: 0, output: `Would download ${pairs.length} file${pairs.length === 1 ? '' : 's'}.` };

  const output = [];
  for (const pair of pairs) {
    const result = await syncSshExactDown({ item, remote, remotePath: pair.remotePath, localPath: pair.localPath, noDelete });
    output.push(`${pair.remotePath} -> ${path.resolve(pair.localPath)}`);
    if (result.output) output.push(result.output);
    if (result.code !== 0) return { code: result.code, output: output.join('\n') };
  }
  return { code: 0, output: output.join('\n') };
}

function listRemoteMatches(remote, pattern) {
  return new Promise(resolve => {
    const findCommand = remoteFindCommand(pattern);
    const ssh = `sshpass -e ssh -p ${shq(String(remote.port || 22))} -o StrictHostKeyChecking=accept-new ${shq(`${remote.username}@${remote.host}`)} ${shq(findCommand)}`;
    const child = spawnHiddenBash(ssh, remote.password);

    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    child.on('error', e => resolve({ code: 1, output: e.message }));
    child.on('close', code => {
      if (code === 0) resolve({ code: 0, paths: output.split(/\r?\n/).filter(Boolean), output: output.trim() });
      else resolve({ code: code ?? 1, output: output.trim() || `SSH exited with code ${code ?? 1}.` });
    });
  });
}

function syncSshExactDown({ item, remote, remotePath, localPath, noDelete }) {
  const remoteSpec = `${remote.username}@${remote.host}:${remotePath}`;
  const ssh = `sshpass -e ssh -p ${shq(String(remote.port || 22))} -o StrictHostKeyChecking=accept-new`;
  const flags = ['-azs', '--human-readable', '--itemize-changes', '--no-o', '--no-g'];
  if (item.type === 'folder' && !noDelete) flags.push('--delete');
  const local = toMsysPath(localPath);
  const src = item.type === 'folder' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
  const dst = item.type === 'folder' ? `${local.replace(/\/+$/, '')}/` : local;
  const command = [
    'set -Eeuo pipefail',
    `mkdir -p -- ${shq(item.type === 'folder' ? local : path.posix.dirname(local))}`,
    `rsync ${flags.join(' ')} -e ${shq(ssh)} ${shq(src)} ${shq(dst)}`
  ].join('\n');
  return runBash(command, remote.password);
}

function remoteFindCommand(pattern) {
  const matcher = buildPosixPatternMatcher(pattern);
  const basename = path.posix.basename(matcher.literalSuffix || pattern);
  const namePattern = hasPathTokens(basename) ? '*' : basename;
  return `find ${shq(matcher.root)} -type f -name ${shq(namePattern)} -print`;
}

async function syncLocal({ item, target, remote, direction, dryRun, noDelete }) {
  const srcPattern = direction === 'up' ? item.source : target.dest;
  const dstPattern = direction === 'up' ? target.dest : item.source;
  const pairs = await expandPathPairs(item.type, srcPattern, dstPattern, targetTokenValues(remote, target));
  if (!pairs.length) return { code: 1, output: `No ${item.type}s matched: ${srcPattern}` };
  if (dryRun) return { code: 0, output: `Would copy ${pairs.length} ${item.type}${pairs.length === 1 ? '' : 's'}` };

  const output = [];
  for (const { src, dst } of pairs) {
    const result = await copyMapping(item.type, src, dst, noDelete);
    output.push(result.output);
    if (result.code !== 0) return { code: result.code, output: output.join('\n') };
  }
  return { code: 0, output: output.join('\n') };
}

async function expandPathPairs(type, srcPattern, dstPattern, initialValues = {}) {
  srcPattern = applyKnownPathTokens(srcPattern, initialValues);
  dstPattern = applyKnownPathTokens(dstPattern, initialValues);
  if (!hasPathTokens(srcPattern) && !hasPathTokens(dstPattern)) {
    return fs.existsSync(srcPattern) ? [{ src: srcPattern, dst: dstPattern }] : [];
  }

  if (!hasPathTokens(srcPattern)) {
    throw new Error('Wildcard mappings need {tokens} on the source side.');
  }

  const matcher = buildPathPatternMatcher(srcPattern);
  const entries = await walkCandidatePaths(matcher.root, type);
  return entries
    .map(src => ({ src, values: matcher.match(src) }))
    .filter(entry => entry.values)
    .map(({ src, values }) => ({ src, dst: applyPathTokens(dstPattern, { ...initialValues, ...values }) }));
}

function targetTokenValues(remote, target) {
  return {
    ...(target.variables || {}),
    SERVER_NAME: remote.name || target.name || remote.id || target.remoteId || ''
  };
}

function hasPathTokens(value) {
  return /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value);
}

function buildPathPatternMatcher(pattern) {
  const normalizedPattern = path.resolve(pattern);
  const firstToken = normalizedPattern.search(/\{[A-Za-z_][A-Za-z0-9_]*\}/);
  const root = firstToken === -1
    ? normalizedPattern
    : path.dirname(normalizedPattern.slice(0, firstToken));
  const names = [];
  let regex = '^';
  let cursor = 0;
  const tokenRegex = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (const match of normalizedPattern.matchAll(tokenRegex)) {
    regex += escapeRegex(normalizedPattern.slice(cursor, match.index));
    regex += '([^\\\\/]+)';
    names.push(match[1]);
    cursor = match.index + match[0].length;
  }
  regex += `${escapeRegex(normalizedPattern.slice(cursor))}$`;
  const compiled = new RegExp(regex, process.platform === 'win32' ? 'i' : '');

  return {
    root,
    match(value) {
      const match = path.resolve(value).match(compiled);
      if (!match) return null;
      const values = {};
      for (let index = 0; index < names.length; index += 1) {
        const oldValue = values[names[index]];
        const nextValue = match[index + 1];
        if (oldValue !== undefined && oldValue !== nextValue) return null;
        values[names[index]] = nextValue;
      }
      return values;
    }
  };
}

function buildPosixPatternMatcher(pattern) {
  const firstToken = pattern.search(/\{[A-Za-z_][A-Za-z0-9_]*\}/);
  const root = firstToken === -1
    ? path.posix.dirname(pattern)
    : path.posix.dirname(pattern.slice(0, firstToken));
  const names = [];
  let regex = '^';
  let cursor = 0;
  const tokenRegex = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (const match of pattern.matchAll(tokenRegex)) {
    regex += escapeRegex(pattern.slice(cursor, match.index));
    regex += '([^/]+)';
    names.push(match[1]);
    cursor = match.index + match[0].length;
  }
  regex += `${escapeRegex(pattern.slice(cursor))}$`;
  const compiled = new RegExp(regex);

  return {
    root: root || '/',
    literalSuffix: pattern.slice(cursor),
    match(value) {
      const match = value.match(compiled);
      if (!match) return null;
      const values = {};
      for (let index = 0; index < names.length; index += 1) {
        const oldValue = values[names[index]];
        const nextValue = match[index + 1];
        if (oldValue !== undefined && oldValue !== nextValue) return null;
        values[names[index]] = nextValue;
      }
      return values;
    }
  };
}

async function walkCandidatePaths(root, type) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (type === 'file' && entry.isFile()) matches.push(entryPath);
    if (type === 'folder' && entry.isDirectory()) matches.push(entryPath);
    if (entry.isDirectory()) matches.push(...await walkCandidatePaths(entryPath, type));
  }
  return matches;
}

function applyPathTokens(pattern, values) {
  return pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => {
    if (values[name] === undefined) throw new Error(`Destination uses unknown wildcard token: ${token}`);
    return values[name];
  });
}

function applyKnownPathTokens(pattern, values) {
  return stripWrappingQuotes(pattern).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => (
    values[name] === undefined ? token : values[name]
  ));
}

function stripWrappingQuotes(value) {
  const text = String(value);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function toMsysPath(value) {
  const raw = String(value).replace(/\\/g, '/');
  const rawMatch = raw.match(/^([A-Za-z]):\/(.*)$/);
  if (rawMatch) return `/${rawMatch[1].toLowerCase()}/${rawMatch[2]}`;

  const normalized = path.resolve(value).replace(/\\/g, '/');
  const normalizedMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (normalizedMatch) return `/${normalizedMatch[1].toLowerCase()}/${normalizedMatch[2]}`;
  return normalized;
}

function toShellPath(value) {
  return toMsysPath(value);
}

async function copyMapping(type, src, dst, noDelete) {
  try {
    const stat = await fsp.stat(src);
    if (type === 'file') {
      if (!stat.isFile()) return { code: 1, output: `Not a file: ${src}` };
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
      return { code: 0, output: `Copied: ${dst}` };
    }
    if (!stat.isDirectory()) return { code: 1, output: `Not a folder: ${src}` };
    if (noDelete) { await fsp.cp(src, dst, { recursive: true, force: true }); return { code: 0, output: `Copied folder: ${dst}` }; }
    await mirrorDir(src, dst);
    return { code: 0, output: `Mirrored: ${dst}` };
  } catch (err) { return { code: 1, output: err.message }; }
}

async function mirrorDir(src, dst) {
  if (path.resolve(dst) === path.parse(dst).root) throw new Error('Refusing mirror into root');
  await fsp.mkdir(dst, { recursive: true });
  const srcEntries = await fsp.readdir(src, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map(e => e.name));
  for (const e of srcEntries) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await mirrorDir(s, d);
    else { await fsp.mkdir(path.dirname(d), { recursive: true }); await fsp.copyFile(s, d); }
  }
  for (const e of await fsp.readdir(dst, { withFileTypes: true }))
    if (!srcNames.has(e.name)) await fsp.rm(path.join(dst, e.name), { recursive: true, force: true });
}

function runBash(command, password) {
  return new Promise(resolve => {
    const child = spawnHiddenBash(command, password);
    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    child.on('error', e => resolve({ code: 1, output: e.message }));
    child.on('close', code => resolve({ code: code ?? 1, output: output.trim() }));
  });
}

function spawnHiddenBash(command, password) {
  const bash = resolveBashPath();
  const env = runtimeToolEnv({ SSHPASS: password || '' });
  return spawn(bash, ['-lc', command], {
    cwd: process.cwd(),
    env,
    windowsHide: true,
  });
}

function shq(v) { return bashSingleQuote(v); }
