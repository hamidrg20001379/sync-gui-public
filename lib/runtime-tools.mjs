import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_BUNDLED_ROOT = path.join('vendor', 'win-tools');
const WINDOWS_BUNDLED_BIN = path.join(WINDOWS_BUNDLED_ROOT, 'usr', 'bin');
const DEFAULT_WINDOWS_BASH = 'C:\\msys64\\usr\\bin\\bash.exe';

export function bundledWindowsToolsRoot(baseDir = process.cwd()) {
  return path.join(baseDir, WINDOWS_BUNDLED_ROOT);
}

export function bundledWindowsBinDir(baseDir = process.cwd()) {
  return path.join(baseDir, WINDOWS_BUNDLED_BIN);
}

export function bundledWindowsBash(baseDir = process.cwd()) {
  return path.join(bundledWindowsBinDir(baseDir), 'bash.exe');
}

export function resolveBashPath(baseDir = process.cwd()) {
  if (process.env.SYNC_GUI_BASH) return process.env.SYNC_GUI_BASH;
  if (process.platform !== 'win32') return 'bash';

  const bundled = bundledWindowsBash(baseDir);
  return fs.existsSync(bundled) ? bundled : DEFAULT_WINDOWS_BASH;
}

export function runtimeToolEnv(extraEnv = {}, baseDir = process.cwd()) {
  if (process.platform !== 'win32') return { ...process.env, ...extraEnv };

  const rootDir = bundledWindowsToolsRoot(baseDir);
  const binDir = bundledWindowsBinDir(baseDir);
  if (!fs.existsSync(binDir)) return { ...process.env, ...extraEnv };

  const tmpDir = path.join(rootDir, 'tmp');
  const homeDir = path.join(rootDir, 'home', process.env.USERNAME || 'user');
  const sshDir = path.join(homeDir, '.ssh');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(sshDir, { recursive: true });

  const pathEntries = [binDir];
  const system32 = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : null;
  if (system32) pathEntries.push(system32);

  return {
    ...process.env,
    ...extraEnv,
    PATH: pathEntries.join(path.delimiter),
    CHERE_INVOKING: '1',
    MSYS2_PATH_TYPE: 'strict',
    TMP: tmpDir,
    TEMP: tmpDir,
    HOME: toPosixHomePath(homeDir),
  };
}

export function bundledWindowsToolStatus(baseDir = process.cwd()) {
  if (process.platform !== 'win32') return { bundled: false, binDir: null, bashPath: 'bash' };

  const binDir = bundledWindowsBinDir(baseDir);
  const bashPath = bundledWindowsBash(baseDir);
  const bundled = fs.existsSync(bashPath);
  return { bundled, binDir, bashPath: bundled ? bashPath : DEFAULT_WINDOWS_BASH };
}

export function bashSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function toPosixHomePath(value) {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : normalized;
}
