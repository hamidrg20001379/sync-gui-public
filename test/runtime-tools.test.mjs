import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bundledWindowsBash, bundledWindowsBinDir, runtimeToolEnv } from '../lib/runtime-tools.mjs';

test('bundled Windows tool paths point at vendor/win-tools/usr/bin', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-gui-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binDir = bundledWindowsBinDir(root);

  assert.equal(binDir, path.join(root, 'vendor', 'win-tools', 'usr', 'bin'));
  assert.equal(bundledWindowsBash(root), path.join(binDir, 'bash.exe'));
});

test('bundled Windows runtime env creates an MSYS2 home directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-gui-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(bundledWindowsBinDir(root), { recursive: true });
  const previousPlatform = process.platform;
  const previousUsername = process.env.USERNAME;

  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.USERNAME = 'hamid';

  try {
    const env = runtimeToolEnv({}, root);
    assert.equal(env.HOME, path.join(root, 'vendor', 'win-tools', 'home', 'hamid').replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`));
    assert.equal(fs.existsSync(path.join(root, 'vendor', 'win-tools', 'home', 'hamid', '.ssh')), true);
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
    if (previousUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = previousUsername;
  }
});

test('bundled Bash starts from a Windows working directory containing spaces', { skip: process.platform !== 'win32' }, () => {
  const bash = bundledWindowsBash();
  if (!fs.existsSync(bash)) return;

  const result = spawnSync(bash, ['-lc', 'printf "%s" "$PWD"'], {
    cwd: process.cwd(),
    env: runtimeToolEnv(),
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /My Github Projects/);
});
