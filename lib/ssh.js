import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function sshExecutable() {
  const configured = process.env.SYNC_GUI_SSH?.trim();
  if (configured) return toMsysPath(configured);

  if (process.platform === 'win32') {
    const systemSsh = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (fs.existsSync(systemSsh)) return toMsysPath(systemSsh);
  }

  return 'ssh';
}

export function sshInvocation(usePassword = true) {
  const executable = sshExecutable();
  const command = executable === 'ssh' ? executable : shq(executable);
  return usePassword && !usesWindowsOpenSsh(executable) ? 'sshpass -e ' + command : command;
}

export function usesWindowsOpenSsh(executable = sshExecutable()) {
  return process.platform === 'win32' && /\/Windows\/System32\/OpenSSH\/ssh\.exe$/i.test(executable);
}

export async function prepareSshAuth(password) {
  if (!password || !usesWindowsOpenSsh()) return { env: {}, cleanup: async () => {} };

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-gui-askpass-'));
  const script = path.join(directory, 'askpass.cmd');
  await fsp.writeFile(
    script,
    '@echo off\r\npowershell.exe -NoProfile -NonInteractive -Command "[Console]::Write($env:SSHPASS)"\r\n',
    'utf8'
  );
  return {
    env: { SSH_ASKPASS: script, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: '1' },
    cleanup: () => fsp.rm(directory, { recursive: true, force: true })
  };
}

function toMsysPath(value) {
  const normalized = String(value).replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? '/' + drive[1].toLowerCase() + '/' + drive[2] : normalized;
}

function shq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
