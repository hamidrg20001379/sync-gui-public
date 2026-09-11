import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows launcher exits outside the Start-Process invocation', async () => {
  const { windowsStartProcessScript } = await import(`../lib/sync.js?launcher=${Date.now()}`);
  const script = windowsStartProcessScript();

  assert.match(script, /-RedirectStandardError \$env:SYNC_GUI_STDERR ; exit \$p\.ExitCode$/);
});

test('SSH sync has no SCP fallback', async () => {
  const syncSource = await readFile(new URL('../lib/sync.js', import.meta.url), 'utf8');

  assert.doesNotMatch(syncSource, /\bscp\b/i);
});

test('bundled MSYS2 SSH keeps password authentication without sshpass', async () => {
  if (process.platform !== 'win32') return;

  const { sshExecutable, sshInvocation, usesNativeWindowsOpenSsh } = await import(`../lib/ssh.js?password=${Date.now()}`);
  if (usesNativeWindowsOpenSsh(sshExecutable())) return;

  assert.match(sshInvocation(true), /bash\.exe \/tmp\/sync-gui-ssh-wrapper\.sh$/);
  assert.doesNotMatch(sshInvocation(true), /sshpass/);
});

test('folder transfers address the folder contents, not the folder itself', async () => {
  const { rsyncFolderContents } = await import(`../lib/sync.js?contents=${Date.now()}`);

  assert.equal(
    rsyncFolderContents('/home/shapoor/domains/files_program/user/shapoorsangin2/backend'),
    '/home/shapoor/domains/files_program/user/shapoorsangin2/backend/.'
  );
  assert.equal(
    rsyncFolderContents('/cygdrive/c/Users/hamid/Documents/Work Projects/shapoorsangin/backend/backend/'),
    '/cygdrive/c/Users/hamid/Documents/Work Projects/shapoorsangin/backend/backend/.'
  );
});
