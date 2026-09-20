import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig } from './config.js';
import { categoryPathVariables } from './categories.js';
import { prepareSshAuth, sshAuthMethod, sshExecutable, sshInvocation, sshShellPathPrefix, usesNativeWindowsOpenSsh } from './ssh.js';

function resolve(item, targetIndex) {
  const target = item.targets?.[targetIndex];
  if (!target) throw new Error(`Item "${item.name}" has no target at index ${targetIndex}`);
  return target;
}

function targetRemoteIds(target) {
  return target.remoteIds?.length ? target.remoteIds : [target.remoteId].filter(Boolean);
}

function shouldUseSsh(target, remote) {
  return remote.kind === 'ssh' && !isSharePath(target.dest);
}

export function ignoreRules(value) {
  return String(value || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

export function resolveSyncMappings(config, direction = 'up', itemTargets = {}) {
  const itemIds = Object.keys(itemTargets);
  const items = itemIds.length ? config.items.filter(item => itemIds.includes(item.id)) : config.items;
  if (!items.length) throw new Error('No items to sync.');

  const mappings = [];
  for (const item of items) {
    let targetIndices = itemTargets[item.id] ?? [];
    if (!targetIndices.length) {
      targetIndices = itemIds.length
        ? (item.targets?.length ? [0] : [])
        : item.targets?.map((_, index) => index) || [];
    }
    if (direction === 'down') targetIndices = targetIndices.length ? [targetIndices[0]] : [];

    for (const targetIndex of targetIndices) {
      const target = resolve(item, targetIndex);
      const project = config.projects.find(candidate => candidate.id === item.projectId);
      const remoteIds = targetRemoteIds(target);
      const remotes = remoteIds.length
        ? remoteIds.map(id => config.remotes.find(remote => remote.id === id)).filter(Boolean)
        : [project ? config.remotes.find(remote => remote.id === project.remoteId) : null].filter(Boolean);
      const missingRemoteIds = remoteIds.filter(id => !config.remotes.some(remote => remote.id === id));
      if (missingRemoteIds.length) {
        const targetName = target.name || `target ${targetIndex}`;
        throw new Error(
          `Item "${item.name}" / ${targetName} references unknown remote ${missingRemoteIds.map(id => `"${id}"`).join(', ')}. Select an existing remote for this target.`
        );
      }
      if (!remotes.length) remotes.push({ id: 'local', kind: 'local', name: target.name || `target ${targetIndex}` });

      for (const remote of remotes) {
        const categoryValues = categoryPathVariables(config.categories, item.categoryId);
        const values = targetTokenValues(remote, target, categoryValues);
        const localPattern = applyKnownPathTokens(item.source, values);
        const targetPattern = shouldUseSsh(target, remote)
          ? normalizeRemotePath(applyKnownPathTokens(target.dest, values))
          : applyKnownPathTokens(target.dest, values);
        mappings.push({
          item,
          target,
          targetIndex,
          remote,
          categoryValues,
          localPattern,
          targetPattern,
          targetIsSsh: shouldUseSsh(target, remote),
          direction,
        });
      }
    }
  }
  if (!mappings.length) throw new Error('No items to sync.');
  return mappings;
}

export async function runSync({ direction = 'up', dryRun = false, noDelete = false, itemTargets = {} }) {
  const config = await readConfig();
  const restrictToChangedFiles = Boolean(config.settings?.restrictToChangedFiles);
  const mappings = resolveSyncMappings(config, direction, itemTargets);

  const chunks = [];
  let finalCode = 0;

  let previousDownItem = null;
  for (const mapping of mappings) {
    const { item, target, remote } = mapping;
    if (direction === 'down' && previousDownItem !== item.id) {
      const targetCount = mappings.filter(candidate => candidate.item.id === item.id).length;
      if (targetCount > 1) chunks.push(`[${item.name}] ? supports one target, using first.`);
      previousDownItem = item.id;
    }

    const label = `${target.name || `target ${mapping.targetIndex}`} / ${remote.name || remote.id || 'local'}`;
    chunks.push(`[${item.name} ? ${label}]`);
    const result = mapping.targetIsSsh
      ? await syncSsh({ item, target, remote, direction, dryRun, noDelete, restrictToChangedFiles, categoryValues: mapping.categoryValues })
      : await syncLocal({ item, target, remote, direction, dryRun, noDelete, restrictToChangedFiles, categoryValues: mapping.categoryValues });
    if (result.output) chunks.push(result.output);
    if (result.code !== 0 && finalCode === 0) finalCode = result.code;
    chunks.push(`[${item.name} ? ${label}] exit ${result.code}`);

    if (result.code === 0 && !dryRun) {
      try {
        const { recordBaseline } = await import('./preflight.js');
        await recordBaseline(mapping);
      } catch (error) {
        chunks.push(`[${item.name} ? ${label}] baseline warning: ${error.message}`);
      }
    }
  }

  return { exitCode: finalCode, output: chunks.join('\n') };
}

async function syncSsh({ item, target, remote, direction, dryRun, noDelete, restrictToChangedFiles, categoryValues }) {
  const values = targetTokenValues(remote, target, categoryValues);
  const local = applyKnownPathTokens(item.source, values);
  const remotePath = normalizeRemotePath(applyKnownPathTokens(target.dest, values));
  const source = direction === 'up' ? local : remotePath;
  const dest = direction === 'up' ? remotePath : local;
  if (hasPathTokens(source) || hasPathTokens(dest)) {
    if (direction === 'down') return syncSshWildcardDown({ item, source, dest, remote, dryRun, noDelete, restrictToChangedFiles, values });
    return { code: 1, output: 'Wildcard capture tokens on SSH targets are only supported for download right now.' };
  }
  const remoteSpec = `${remote.username}@${remote.host}:${remotePath}`;
  const ssh = sshInvocation(sshAuthMethod(remote) !== 'key' && Boolean(remote.password), remote.privateKeyPath) + ' -p ' + shq(String(remote.port || 22)) + ' -o StrictHostKeyChecking=accept-new' + sshKnownHostsOption();
  // ponytail: omit rsync's secluded-args mode; the Windows SSH bridge cannot preserve it.
  const flags = ['-az', '--human-readable', '--itemize-changes', '--no-o', '--no-g'];
  if (restrictToChangedFiles) flags.push('--update');
  if (dryRun) flags.push('--dry-run');
  if (item.type === 'folder' && !noDelete && !restrictToChangedFiles) flags.push('--delete');
  if (item.type === 'folder') flags.push('--exclude=.syncignore');
  const ignoreFile = item.type === 'folder' ? path.join(local, '.syncignore') : null;
  if (ignoreFile && fs.existsSync(ignoreFile)) flags.push(`--exclude-from=${shq(toShellPath(ignoreFile))}`);
  if (item.type === 'folder') {
    const configIgnore = direction === 'up' ? item.localSyncIgnore : target.remoteSyncIgnore;
    for (const rule of ignoreRules(configIgnore)) flags.push(`--exclude=${shq(rule)}`);
  }

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

  return runBash(commands.join('\n'), remote.password, remote.keyPassphrase);
}

async function syncSshWildcardDown({ item, source, dest, remote, dryRun, noDelete, restrictToChangedFiles, values }) {
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
    const result = await syncSshExactDown({ item, remote, remotePath: pair.remotePath, localPath: pair.localPath, noDelete, restrictToChangedFiles });
    output.push(`${pair.remotePath} -> ${path.resolve(pair.localPath)}`);
    if (result.output) output.push(result.output);
    if (result.code !== 0) return { code: result.code, output: output.join('\n') };
  }
  return { code: 0, output: output.join('\n') };
}

async function listRemoteMatches(remote, pattern) {
  const findCommand = remoteFindCommand(pattern);
  const ssh = sshInvocation(sshAuthMethod(remote) !== 'key' && Boolean(remote.password), remote.privateKeyPath) + ' -p ' + shq(String(remote.port || 22)) + ' -o StrictHostKeyChecking=accept-new' + sshKnownHostsOption() + ' ' + shq(remote.username + '@' + remote.host) + ' ' + shq(findCommand);
  const result = await runBashProcess(ssh, remote.password, remote.keyPassphrase);
  if (result.code === 0) {
    return { code: 0, paths: result.output.split(/\r?\n/).filter(Boolean), output: result.output };
  }
  return { code: result.code, output: result.output || `SSH exited with code ${result.code}.` };
}

async function syncSshExactDown({ item, remote, remotePath, localPath, noDelete, restrictToChangedFiles }) {
  const remoteSpec = `${remote.username}@${remote.host}:${remotePath}`;
  const ssh = sshInvocation(sshAuthMethod(remote) !== 'key' && Boolean(remote.password), remote.privateKeyPath) + ' -p ' + shq(String(remote.port || 22)) + ' -o StrictHostKeyChecking=accept-new' + sshKnownHostsOption();
  const flags = ['-az', '--human-readable', '--itemize-changes', '--no-o', '--no-g'];
  if (restrictToChangedFiles) flags.push('--update');
  if (item.type === 'folder' && !noDelete && !restrictToChangedFiles) flags.push('--delete');
  if (item.type === 'folder') {
    for (const rule of ignoreRules(item.localSyncIgnore)) flags.push(`--exclude=${shq(rule)}`);
  }
  const local = toMsysPath(localPath);
  const src = item.type === 'folder' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
  const dst = item.type === 'folder' ? `${local.replace(/\/+$/, '')}/` : local;
  await fsp.mkdir(item.type === 'folder' ? localPath : path.dirname(localPath), { recursive: true });
  const command = [
    'set -Eeuo pipefail',
    `rsync ${flags.join(' ')} -e ${shq(ssh)} ${shq(src)} ${shq(dst)}`
  ].join('\n');
  return runBash(command, remote.password, remote.keyPassphrase);
}

function remoteFindCommand(pattern) {
  const matcher = buildPosixPatternMatcher(pattern);
  const basename = path.posix.basename(matcher.literalSuffix || pattern);
  const namePattern = hasPathTokens(basename) ? '*' : basename;
  return `find ${shq(matcher.root)} -type f -name ${shq(namePattern)} -print`;
}

async function syncLocal({ item, target, remote, direction, dryRun, noDelete, restrictToChangedFiles, categoryValues }) {
  const srcPattern = direction === 'up' ? item.source : target.dest;
  const dstPattern = direction === 'up' ? target.dest : item.source;
  const values = targetTokenValues(remote, target, categoryValues);
  const pairs = await expandPathPairs(item.type, srcPattern, dstPattern, values);
  if (!pairs.length) return { code: 1, output: `No ${item.type}s matched: ${applyKnownPathTokens(srcPattern, values)}` };
  if (dryRun) return { code: 0, output: `Would copy ${pairs.length} ${item.type}${pairs.length === 1 ? '' : 's'}` };

  const output = [];
  for (const { src, dst } of pairs) {
    const sourceIgnores = direction === 'up'
      ? [{ root: src, text: item.localSyncIgnore }]
      : [{ root: src, text: target.remoteSyncIgnore }];
    const destIgnores = direction === 'up'
      ? [{ root: src, text: item.localSyncIgnore }, { root: dst, text: target.remoteSyncIgnore }]
      : [{ root: dst, text: item.localSyncIgnore }];
    const result = await copyMapping(
      item.type,
      src,
      dst,
      noDelete,
      restrictToChangedFiles,
      item.type === 'folder' ? sourceIgnores : [],
      item.type === 'folder' ? destIgnores : [],
    );
    output.push(result.output);
    if (result.code !== 0) return { code: result.code, output: output.join('\n') };
  }
  return { code: 0, output: output.join('\n') };
}

export async function expandPathPairs(type, srcPattern, dstPattern, initialValues = {}) {
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

function targetTokenValues(remote, target, categoryValues = {}) {
  return {
    ...categoryValues,
    ...(target.variables || {}),
    SERVER_NAME: remote.name || target.name || remote.id || target.remoteId || ''
  };
}

export function hasPathTokens(value) {
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

function normalizeRemotePath(value) {
  return value.replace(/\\/g, '/');
}

function isSharePath(value) {
  const normalized = stripWrappingQuotes(value).replace(/\//g, '\\');
  return normalized.startsWith('\\\\');
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
  const drivePrefix = process.env.SYNC_GUI_DRIVE_PREFIX || '';
  if (rawMatch) return `${drivePrefix}/${rawMatch[1].toLowerCase()}/${rawMatch[2]}`;

  const normalized = path.resolve(value).replace(/\\/g, '/');
  const normalizedMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (normalizedMatch) return `${drivePrefix}/${normalizedMatch[1].toLowerCase()}/${normalizedMatch[2]}`;
  return normalized;
}

function toShellPath(value) {
  return toMsysPath(value);
}

async function copyMapping(type, src, dst, noDelete, restrictToChangedFiles, sourceIgnores = [], destIgnores = sourceIgnores) {
  try {
    const stat = await fsp.stat(src);
    if (type === 'file') {
      if (!stat.isFile()) return { code: 1, output: `Not a file: ${src}` };
      if (restrictToChangedFiles && await destinationIsNewer(src, dst)) {
        return { code: 0, output: `Skipped newer destination: ${dst}` };
      }
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
      return { code: 0, output: `Copied: ${dst}` };
    }
    if (!stat.isDirectory()) return { code: 1, output: `Not a folder: ${src}` };
    const isIgnored = await readCombinedSyncIgnore(sourceIgnores);
    const isDestIgnored = await readCombinedSyncIgnore(destIgnores);
    if (noDelete && !restrictToChangedFiles) {
      await fsp.cp(src, dst, {
        recursive: true,
        force: true,
        filter: source => !isIgnored(path.relative(src, source))
      });
      return { code: 0, output: `Copied folder: ${dst}` };
    }
    await mirrorDir(src, dst, isIgnored, isDestIgnored, restrictToChangedFiles, !noDelete && !restrictToChangedFiles);
    return { code: 0, output: `Mirrored: ${dst}` };
  } catch (err) { return { code: 1, output: err.message }; }
}

export async function readSyncIgnore(root, extraContents = '') {
  let contents = '';
  try {
    contents = await fsp.readFile(path.join(root, '.syncignore'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const rules = ignoreRules(`${contents}\n${extraContents}`).map(ignoreRuleRegex);
  return relativePath => {
    const normalized = relativePath.split(path.sep).join('/').replace(/^\.?\//, '');
    return normalized === '.syncignore' || rules.some(rule => rule.test(normalized));
  };
}

async function readCombinedSyncIgnore(sources) {
  const checks = await Promise.all(sources.map(source => readSyncIgnore(source.root, source.text)));
  return relativePath => checks.some(check => check(relativePath));
}

function ignoreRuleRegex(rule) {
  const directoryOnly = rule.endsWith('/');
  const normalized = rule.replace(/^\/+|\/+$/g, '');
  const hasSlash = normalized.includes('/');
  let pattern = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*' && normalized[index + 1] === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += escapeRegex(char);
  }
  const prefix = hasSlash ? '^' : '(^|/)';
  const suffix = directoryOnly ? '(/|$)' : '($|/)';
  return new RegExp(`${prefix}${pattern}${suffix}`);
}

async function destinationIsNewer(src, dst) {
  try {
    const [sourceStat, destinationStat] = await Promise.all([fsp.stat(src), fsp.stat(dst)]);
    return destinationStat.mtimeMs > sourceStat.mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function mirrorDir(src, dst, isIgnored, isDestIgnored = isIgnored, restrictToChangedFiles = false, deleteMissing = true, root = src, dstRoot = dst) {
  if (path.resolve(dst) === path.parse(dst).root) throw new Error('Refusing mirror into root');
  await fsp.mkdir(dst, { recursive: true });
  const srcEntries = (await fsp.readdir(src, { withFileTypes: true }))
    .filter(entry => !isIgnored(path.relative(root, path.join(src, entry.name))));
  const srcNames = new Set(srcEntries.map(e => e.name));
  for (const e of srcEntries) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (isDestIgnored(path.relative(dstRoot, d))) continue;
    if (e.isDirectory()) await mirrorDir(s, d, isIgnored, isDestIgnored, restrictToChangedFiles, deleteMissing, root, dstRoot);
    else if (!restrictToChangedFiles || !await destinationIsNewer(s, d)) {
      await fsp.mkdir(path.dirname(d), { recursive: true });
      await fsp.copyFile(s, d);
    }
  }
  if (deleteMissing) {
    for (const e of await fsp.readdir(dst, { withFileTypes: true })) {
      if (isDestIgnored(path.relative(dstRoot, path.join(dst, e.name)))) continue;
      if (!srcNames.has(e.name)) await fsp.rm(path.join(dst, e.name), { recursive: true, force: true });
    }
  }
}

function runBash(command, password, passphrase) {
  return runBashProcess(command, password, passphrase);
}

export async function runBashProcess(command, password, passphrase = '') {
  const auth = await prepareSshAuth(password, { passphrase });
  try {
  return new Promise(resolve => {
    const bash = process.env.SYNC_GUI_BASH || (process.platform === 'win32' ? 'C:\\msys64\\usr\\bin\\bash.exe' : 'bash');
    const child = spawn(bash, ['-lc', `${sshShellPathPrefix()}\n${command}`], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...auth.env,
        ...(usesNativeWindowsOpenSsh(sshExecutable())
          ? { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }
          : {}),
        SSHPASS: password || ''
      },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    child.on('error', e => resolve({ code: 1, output: e.message }));
    child.on('close', code => resolve({ code: code ?? 1, output: output.trim() }));
  });
  } finally {
    await auth.cleanup();
  }
}

export function sshKnownHostsOption() {
  return process.env.SYNC_GUI_KNOWN_HOSTS
    ? ` -o UserKnownHostsFile=${shq(process.env.SYNC_GUI_KNOWN_HOSTS)}`
    : '';
}

export function windowsStartProcessScript() {
  return [
    '$p = Start-Process -FilePath $env:SYNC_GUI_BASH',
    '-ArgumentList @($env:SYNC_GUI_SCRIPT)',
    '-WindowStyle Hidden -Wait -PassThru',
    '-RedirectStandardOutput $env:SYNC_GUI_STDOUT',
    '-RedirectStandardError $env:SYNC_GUI_STDERR',
    '; exit $p.ExitCode'
  ].join(' ');
}

export function shq(v) { return `'${String(v).replace(/'/g, "'\\''")}'`; }
