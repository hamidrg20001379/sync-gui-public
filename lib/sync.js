import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { flattenMappings, getRemoteKind, readConfig, readEnv, resolveLocalPath, resolveProjectRoot, resolveRemote, resolveRemotePath } from './config';

const defaultBash = 'C:\\msys64\\usr\\bin\\bash.exe';

export async function checkConfig(selectedIds = []) {
  const config = await readConfig();
  const ids = selectedIds.length ? new Set(selectedIds) : null;
  const warnings = [];
  const rows = flattenMappings(config);
  if (ids) {
    const known = new Set(rows.map((row) => row.key));
    const missing = selectedIds.filter((id) => !known.has(id));
    if (missing.length) {
      return { exitCode: 1, output: `Unknown target: ${missing.join(', ')}` };
    }
  }

  for (const row of rows) {
    if (ids && !ids.has(row.key)) continue;
    const localPath = resolveLocalPath(row.project, row.mapping);
    if (!fs.existsSync(localPath)) {
      warnings.push(`[${row.key}] missing local ${row.mapping.type}: ${localPath}`);
    }
    if (getRemoteKind(row.remote) !== 'ssh' && !fs.existsSync(row.remote.root)) {
      warnings.push(`[${row.key}] missing remote root: ${row.remote.root}`);
    }
  }

  return {
    exitCode: warnings.length ? 1 : 0,
    output: warnings.length ? warnings.join('\n') : 'Config check passed.'
  };
}

export async function runSync({ direction = 'down', dryRun = false, noDelete = false, targetIds = [] }) {
  if (!targetIds.length) throw new Error('Select at least one target.');

  const config = await readConfig();
  const env = await readEnv();
  const projectEnvCache = new Map();
  const rows = flattenMappings(config);
  const selected = rows.filter((row) => targetIds.includes(row.key));

  if (selected.length !== targetIds.length) {
    const known = new Set(selected.map((row) => row.key));
    const missing = targetIds.filter((id) => !known.has(id));
    throw new Error(`Unknown target: ${missing.join(', ')}`);
  }

  const chunks = [];
  let finalCode = 0;

  for (const row of selected) {
    const localPath = resolveLocalPath(row.project, row.mapping);
    const remoteKind = getRemoteKind(row.remote);

    chunks.push(`[${row.key}] ${direction} ${row.mapping.type}`);

    const result = remoteKind === 'ssh'
      ? await runSshSync({ row, env: await envForProject(row.project, env, projectEnvCache), localPath, direction, dryRun, noDelete, chunks })
      : await runPathSync({ row, localPath, direction, dryRun, noDelete, chunks });

    if (result.output) chunks.push(result.output);
    if (result.exitCode !== 0 && finalCode === 0) finalCode = result.exitCode;
    chunks.push(`[${row.key}] exit ${result.exitCode}`);
    if (result.exitCode !== 0) break;
  }

  return {
    exitCode: finalCode,
    output: chunks.join('\n')
  };
}

async function envForProject(project, baseEnv, cache) {
  const projectEnvPath = path.join(resolveProjectRoot(project), '.env');
  if (!cache.has(projectEnvPath)) {
    cache.set(projectEnvPath, readEnv(projectEnvPath));
  }
  return { ...(await cache.get(projectEnvPath)), ...baseEnv };
}

async function runSshSync({ row, env, localPath, direction, dryRun, noDelete, chunks }) {
  const remote = resolveRemote(row.remote, env);
  const command = buildRsyncCommand({ target: row.mapping, remote, localPath, direction, dryRun, noDelete });
  chunks.push(maskCommand(command.display));
  return runBash(command.command, remote.password);
}

async function runPathSync({ row, localPath, direction, dryRun, noDelete, chunks }) {
  const remotePath = resolveRemotePath(row.remote, row.mapping);
  const source = direction === 'up' ? localPath : remotePath;
  const dest = direction === 'up' ? remotePath : localPath;

  chunks.push(`${source} -> ${dest}`);

  if (dryRun) {
    const exists = fs.existsSync(source);
    return {
      exitCode: exists ? 0 : 1,
      output: exists
        ? `Would copy ${row.mapping.type}${row.mapping.type === 'dir' && !noDelete ? ' and delete extras' : ''}.`
        : `Missing source ${row.mapping.type}: ${source}`
    };
  }

  try {
    await copyTarget({ type: row.mapping.type, source, dest, noDelete });
    return { exitCode: 0, output: 'Copied.' };
  } catch (error) {
    return { exitCode: 1, output: error.message };
  }
}

async function copyTarget({ type, source, dest, noDelete }) {
  const stat = await fsp.stat(source);

  if (type === 'file') {
    if (!stat.isFile()) throw new Error(`Source is not a file: ${source}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(source, dest);
    return;
  }

  if (!stat.isDirectory()) throw new Error(`Source is not a folder: ${source}`);
  if (noDelete) {
    await fsp.cp(source, dest, { recursive: true, force: true });
    return;
  }

  await mirrorDir(source, dest);
}

async function mirrorDir(source, dest) {
  assertSafeMirrorDestination(dest);
  await fsp.mkdir(dest, { recursive: true });

  const sourceEntries = await fsp.readdir(source, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

  for (const entry of sourceEntries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await mirrorDir(sourcePath, destPath);
    } else {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.copyFile(sourcePath, destPath);
    }
  }

  // ponytail: shallow delete pass after copy; switch to rsync/robocopy if metadata-perfect mirroring matters.
  const destEntries = await fsp.readdir(dest, { withFileTypes: true });
  for (const entry of destEntries) {
    if (!sourceNames.has(entry.name)) {
      await fsp.rm(path.join(dest, entry.name), { recursive: true, force: true });
    }
  }
}

function assertSafeMirrorDestination(dest) {
  const resolved = path.resolve(dest);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`Refusing to mirror into filesystem root: ${dest}`);
  }
}

function buildRsyncCommand({ target, remote, localPath, direction, dryRun, noDelete }) {
  const ssh = `sshpass -e ssh -p ${posixQuote(remote.port)} -o StrictHostKeyChecking=accept-new`;
  const rsyncFlags = ['-azs', '--human-readable', '--itemize-changes'];
  if (dryRun) rsyncFlags.push('--dry-run');
  if (target.type === 'dir' && !noDelete) rsyncFlags.push('--delete');

  const local = toMsysPath(localPath);
  const remoteSpec = `${remote.username}@${remote.host}:${target.remote}`;
  const remoteDir = target.type === 'dir' ? target.remote.replace(/\/+$/, '') : target.remote.replace(/\/[^/]*$/, '');

  const commands = ['set -Eeuo pipefail'];
  if (direction === 'up' && !dryRun) {
    commands.push(`${ssh} ${posixQuote(`${remote.username}@${remote.host}`)} ${posixQuote(`mkdir -p -- ${posixQuote(remoteDir)}`)}`);
  } else if (direction === 'down' && !dryRun) {
    commands.push(`mkdir -p -- ${posixQuote(target.type === 'dir' ? local : path.posix.dirname(local))}`);
  }

  if (direction === 'up') {
    const source = target.type === 'dir' ? `${local.replace(/\/+$/, '')}/` : local;
    const dest = target.type === 'dir' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
    commands.push(`rsync ${rsyncFlags.join(' ')} -e ${posixQuote(ssh)} ${posixQuote(source)} ${posixQuote(dest)}`);
  } else {
    const source = target.type === 'dir' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
    const dest = target.type === 'dir' ? `${local.replace(/\/+$/, '')}/` : local;
    commands.push(`rsync ${rsyncFlags.join(' ')} -e ${posixQuote(ssh)} ${posixQuote(source)} ${posixQuote(dest)}`);
  }

  return {
    command: commands.join('\n'),
    display: commands.slice(1).join('\n')
  };
}

function runBash(command, password) {
  return new Promise((resolve) => {
    const bash = process.env.SYNC_GUI_BASH || defaultBash;
    const child = spawn(bash, ['-lc', command], {
      cwd: process.cwd(),
      env: { ...process.env, SSHPASS: password },
      windowsHide: true
    });

    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => {
      resolve({ exitCode: 1, output: error.message });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output: output.trim() });
    });
  });
}

function toMsysPath(value) {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/${match[1].toLowerCase()}/${match[2]}`;
}

function posixQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function maskCommand(value) {
  return value.replace(/SSHPASS=[^\s]+/g, 'SSHPASS=***');
}
