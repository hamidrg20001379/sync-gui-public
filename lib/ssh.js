import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function sshExecutable() {
  const configured = process.env.SYNC_GUI_SSH?.trim();
  if (configured) return toMsysPath(configured);

  if (process.platform === 'win32') {
    const bundled = bundledSsh();
    if (bundled) return toMsysPath(bundled);

    const systemSsh = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (fs.existsSync(systemSsh)) return toMsysPath(systemSsh);
  }

  return 'ssh';
}

function bundledSsh() {
  const candidates = [];
  const bash = process.env.SYNC_GUI_BASH?.trim();
  const bin = process.env.SYNC_GUI_WIN_TOOLS_BIN?.trim();
  if (bash) candidates.push(path.join(path.dirname(bash), 'ssh.exe'));
  if (bin) candidates.push(path.join(bin, 'ssh.exe'));
  candidates.push(path.join(process.cwd(), 'vendor', 'win-tools', 'usr', 'bin', 'ssh.exe'));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app', 'vendor', 'win-tools', 'usr', 'bin', 'ssh.exe'));
  }
  return candidates.find(candidate => fs.existsSync(candidate));
}

export function sshInvocation(usePassword = true) {
  const executable = sshExecutable();
  const command = usesNativeWindowsOpenSsh(executable)
    ? 'env BASH_ENV=/tmp/sync-gui-bash-noop.sh bash.exe /tmp/sync-gui-ssh-wrapper.sh'
    : usesWindowsOpenSsh(executable)
      ? 'ssh'
    : executable === 'ssh' ? executable : shq(executable);
  return usePassword && !usesWindowsOpenSsh(executable) ? 'sshpass -e ' + command : command;
}

export function sshShellPathPrefix() {
  const executable = sshExecutable();
  if (usesWindowsOpenSsh(executable)) {
    return `PATH=${shq(path.posix.dirname(executable))}:/usr/bin:$PATH`;
  }
  return 'PATH=/usr/bin:$PATH';
}

export function usesWindowsOpenSsh(executable = sshExecutable()) {
  return process.platform === 'win32' && /\/ssh\.exe$/i.test(executable);
}

export function usesNativeWindowsOpenSsh(executable = sshExecutable()) {
  return process.platform === 'win32' && /\/Windows\/System32\/OpenSSH\/ssh\.exe$/i.test(executable);
}

export async function prepareSshAuth(password, { direct = false } = {}) {
  if (!password || !usesWindowsOpenSsh()) return { env: {}, cleanup: async () => {} };

  const bash = direct ? 'C:\\msys64\\usr\\bin\\bash.exe' : process.env.SYNC_GUI_BASH?.trim() || 'C:\\msys64\\usr\\bin\\bash.exe';
  if (direct) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-gui-askpass-'));
    const script = path.join(directory, 'askpass.sh');
    await fsp.writeFile(script, 'printf "%s" "${SSHPASS:-}"\nexit 0\n', 'utf8');
    return {
      env: { SSH_ASKPASS: bash, BASH_ENV: script, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: '1' },
      cleanup: () => fsp.rm(directory, { recursive: true, force: true })
    };
  }
  const msysRoot = path.dirname(path.dirname(path.dirname(bash)));
  const directory = path.join(msysRoot, 'tmp');
  await fsp.mkdir(directory, { recursive: true });
  const script = path.join(directory, 'sync-gui-askpass.sh');
  const noop = path.join(directory, 'sync-gui-bash-noop.sh');
  const wrapper = path.join(directory, 'sync-gui-ssh-wrapper.sh');
  await fsp.writeFile(
    script,
    'printf "%s" "${SSHPASS:-}"\nexit 0\n',
    'utf8'
  );
  await fsp.writeFile(noop, '', 'utf8');
  await fsp.writeFile(wrapper, 'MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" BASH_ENV=/tmp/sync-gui-askpass.sh exec C:/Windows/System32/OpenSSH/ssh.exe "$@"\n', 'utf8');
  await fsp.chmod(script, 0o755);
  return {
    // Native Windows OpenSSH needs an executable; bash reads BASH_ENV before the prompt argument.
    env: usesNativeWindowsOpenSsh(sshExecutable())
      ? { SSH_ASKPASS: bash, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: '1', MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }
      : { SSH_ASKPASS: toMsysPath(script), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: '1' },
    cleanup: async () => {}
  };
}

function toMsysPath(value) {
  const normalized = String(value).replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  const prefix = process.env.SYNC_GUI_DRIVE_PREFIX?.trim() || '';
  return drive ? `${prefix || '/' + drive[1].toLowerCase()}/${prefix ? drive[1].toLowerCase() + '/' : ''}${drive[2]}` : normalized;
}

function shq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
