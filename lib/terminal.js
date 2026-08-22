import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const MAX_OUTPUT = 80_000;
const sessions = globalThis.__syncGuiTerminalSessions ||= new Map();

export async function startTerminalSession(remote) {
  if (!remote) throw new Error('Remote not found.');
  const spec = await terminalCommand(remote);
  const id = crypto.randomUUID();
  const session = {
    id,
    name: remote.name || remote.host || 'Terminal',
    status: 'running',
    output: '',
    child: null,
    createdAt: Date.now()
  };

  const child = spawn(spec.file, spec.args, {
    cwd: spec.cwd || process.cwd(),
    env: { ...process.env, ...spec.env },
    windowsHide: true
  });
  session.child = child;
  sessions.set(id, session);

  append(session, spec.banner || '');
  child.stdout.on('data', data => append(session, data.toString()));
  child.stderr.on('data', data => append(session, data.toString()));
  child.on('error', error => {
    append(session, `\n${error.message}\n`);
    session.status = 'failed';
  });
  child.on('close', code => {
    session.status = code === 0 ? 'closed' : 'failed';
    append(session, `\n[session exited with code ${code ?? 1}]\n`);
  });

  return snapshot(session);
}

export function getTerminalSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  return snapshot(session);
}

export function writeTerminalInput(id, input) {
  const session = sessions.get(id);
  if (!session) throw new Error(`Unknown terminal session: ${id}`);
  if (session.status !== 'running' || !session.child?.stdin?.writable) {
    throw new Error('Terminal session is not running.');
  }
  session.child.stdin.write(String(input || ''));
  return snapshot(session);
}

export function closeTerminalSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.status === 'running') {
    session.child.kill();
    session.status = 'closed';
  }
  sessions.delete(id);
  return snapshot(session);
}

export async function terminalCommand(remote) {
  const bash = process.env.SYNC_GUI_BASH || (process.platform === 'win32' ? 'C:\\msys64\\usr\\bin\\bash.exe' : 'bash');
  if (remote.kind === 'ssh') return sshCommand(remote, bash);
  return localCommand(remote, bash);
}

function sshCommand(remote, bash) {
  if (!remote.host || !remote.username) throw new Error('SSH remote needs host and username.');
  const sshpassPrefix = remote.password ? 'sshpass -e ' : '';
  const defaultPath = remote.defaultPath?.trim();
  const knownHosts = process.env.SYNC_GUI_KNOWN_HOSTS
    ? ` -o UserKnownHostsFile=${shq(process.env.SYNC_GUI_KNOWN_HOSTS)}`
    : '';
  const remoteShell = (defaultPath ? `cd -- ${shq(defaultPath)} && ` : '')
    + 'stty erase ^? 2>/dev/null; exec "${SHELL:-/bin/bash}" -l';
  const ssh = [
    `${sshpassPrefix}ssh`,
    '-tt',
    `-p ${shq(String(remote.port || 22))}`,
    '-o StrictHostKeyChecking=accept-new',
    knownHosts.trim(),
    shq(`${remote.username}@${remote.host}`),
    shq(remoteShell)
  ].filter(Boolean).join(' ');

  return {
    file: bash,
    args: ['-lc', `PATH=/usr/bin:$PATH\n${ssh}`],
    env: { SSHPASS: remote.password || '', TERM: 'xterm' },
    banner: `Connecting to ${remote.name || remote.host}...\n`
  };
}

async function localCommand(remote, bash) {
  const root = remote.defaultPath || remote.root || remote.path;
  if (!root?.trim()) throw new Error('Local remote has no root path.');
  const cwd = path.resolve(root);
  await access(cwd);
  const shellExec = 'stty erase ^? 2>/dev/null; exec "${SHELL:-bash}"';
  return {
    file: bash,
    args: ['-lc', `cd -- ${shq(toBashPath(cwd))}\n${shellExec}`],
    env: { TERM: 'xterm' },
    banner: `Opened ${cwd}\n`
  };
}

function append(session, text) {
  session.output = mergeTerminalOutput(session.output, text);
}

export function mergeTerminalOutput(previous, text) {
  const output = hasClearScreen(text) ? '' : String(previous || '');
  // ponytail: Re-scan the bounded buffer so erase sequences can affect an earlier chunk.
  // If MAX_OUTPUT grows substantially, replace this with a streaming terminal parser.
  return cleanTerminalOutput(`${output}${text}`).slice(-MAX_OUTPUT);
}

function snapshot(session) {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    output: session.output,
    createdAt: session.createdAt
  };
}

function toBashPath(value) {
  if (process.platform !== 'win32') return value;
  const normalized = value.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  const prefix = process.env.SYNC_GUI_DRIVE_PREFIX || '/c';
  if (!match) return normalized;
  if (prefix === '/cygdrive') return `/cygdrive/${match[1].toLowerCase()}/${match[2]}`;
  return `/${match[1].toLowerCase()}/${match[2]}`;
}

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function cleanTerminalOutput(text) {
  const stripped = String(text || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[\?2004[hl]/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x7f/g, '\b')
    .replace(/[\x00-\x06\x07\x0e-\x1f]/g, '');
  return applyBackspaces(stripped);
}

export function hasClearScreen(text) {
  return /\x1b\[(?:2J|3J|H\x1b\[2J|2J\x1b\[H)/.test(String(text || ''));
}

function applyBackspaces(text) {
  const out = [];
  for (const char of String(text || '')) {
    if (char === '\b') out.pop();
    else out.push(char);
  }
  return out.join('');
}
