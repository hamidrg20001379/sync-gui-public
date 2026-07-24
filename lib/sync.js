import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig } from './config';

export async function runSync({ direction = 'up', dryRun = false, noDelete = false, itemIds = [] }) {
  const config = await readConfig();
  const items = itemIds.length ? config.items.filter(i => itemIds.includes(i.id)) : config.items;
  if (!items.length) throw new Error('No items to sync.');

  const chunks = [];
  let finalCode = 0;

  for (const item of items) {
    const project = config.projects.find(p => p.id === item.projectId);
    const remote = config.remotes.find(r => r.id === project?.remoteId) || { kind: 'local' };
    chunks.push(`[${item.name}] ${direction === 'up' ? '→' : '←'}`);
    const result = remote.kind === 'ssh'
      ? await syncSsh({ item, remote, direction, dryRun, noDelete })
      : await syncLocal({ item, direction, dryRun, noDelete });
    if (result.output) chunks.push(result.output);
    if (result.code !== 0 && finalCode === 0) finalCode = result.code;
    chunks.push(`[${item.name}] exit ${result.code}`);
  }

  return { exitCode: finalCode, output: chunks.join('\n') };
}

async function syncSsh({ item, remote, direction, dryRun, noDelete }) {
  const remoteSpec = `${remote.username}@${remote.host}:${item.dest}`;
  const ssh = `sshpass -e ssh -p ${shq(String(remote.port || 22))} -o StrictHostKeyChecking=accept-new`;
  const flags = ['-azs', '--human-readable', '--itemize-changes', '--no-o', '--no-g'];
  if (dryRun) flags.push('--dry-run');
  if (item.type === 'folder' && !noDelete) flags.push('--delete');

  const commands = ['set -Eeuo pipefail'];

  if (direction === 'up') {
    if (!dryRun) {
      const remoteDir = item.type === 'folder' ? item.dest.replace(/\/+$/, '') : path.posix.dirname(item.dest);
      commands.push(`${ssh} ${shq(`${remote.username}@${remote.host}`)} ${shq(`mkdir -p -- ${shq(remoteDir)}`)}`);
    }
    const src = item.type === 'folder' ? `${item.source.replace(/\/+$/, '')}/` : item.source;
    const dst = item.type === 'folder' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
    commands.push(`rsync ${flags.join(' ')} -e ${shq(ssh)} ${shq(src)} ${shq(dst)}`);
  } else {
    if (!dryRun) { const dir = item.type === 'folder' ? item.source : path.dirname(item.source); commands.push(`mkdir -p -- ${shq(dir)}`); }
    const src = item.type === 'folder' ? `${remoteSpec.replace(/\/+$/, '')}/` : remoteSpec;
    const dst = item.type === 'folder' ? `${item.source.replace(/\/+$/, '')}/` : item.source;
    commands.push(`rsync ${flags.join(' ')} -e ${shq(ssh)} ${shq(src)} ${shq(dst)}`);
  }

  return runBash(commands.join('\n'), remote.password);
}

async function syncLocal({ item, direction, dryRun, noDelete }) {
  const src = direction === 'up' ? item.source : item.dest;
  const dst = direction === 'up' ? item.dest : item.source;
  if (!fs.existsSync(src)) return { code: 1, output: `Not found: ${src}` };
  if (dryRun) return { code: 0, output: `Would copy: ${src} → ${dst}` };
  return copyMapping(item.type, src, dst, noDelete);
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
    const bash = process.env.SYNC_GUI_BASH || (process.platform === 'win32' ? 'C:\\msys64\\usr\\bin\\bash.exe' : 'bash');
    const child = spawn(bash, ['-lc', command], {
      cwd: process.cwd(),
      env: { ...process.env, SSHPASS: password || '' },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    child.on('error', e => resolve({ code: 1, output: e.message }));
    child.on('close', code => resolve({ code: code ?? 1, output: output.trim() }));
  });
}

function shq(v) { return `'${String(v).replace(/'/g, "'\\''")}'`; }
