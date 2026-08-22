import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('SSH terminal command uses sshpass env without inlining password', async () => {
  const { terminalCommand } = await import(`../lib/terminal.js?ssh=${Date.now()}`);
  const spec = await terminalCommand({
    kind: 'ssh',
    name: 'Prod',
    host: 'example.com',
    port: 2200,
    username: 'deploy',
    password: 'secret value'
  });
  const command = spec.args.join('\n');

  assert.match(command, /sshpass -e ssh/);
  assert.match(command, /-tt/);
  assert.match(command, /-p '2200'/);
  assert.match(command, /'deploy@example\.com'/);
  assert.doesNotMatch(command, /secret value/);
  assert.equal(spec.env.SSHPASS, 'secret value');
});

test('SSH terminal command starts in the configured default path', async () => {
  const { terminalCommand } = await import(`../lib/terminal.js?ssh-path=${Date.now()}`);
  const spec = await terminalCommand({
    kind: 'ssh',
    host: 'example.com',
    username: 'deploy',
    defaultPath: "/var/www/My App"
  });
  const command = spec.args.join('\n');

  assert.match(command, /cd -- .*\/var\/www\/My App.*&&/);
});

test('local terminal command opens at the remote root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-gui-local-terminal-'));
  const { terminalCommand } = await import(`../lib/terminal.js?local=${Date.now()}`);
  const spec = await terminalCommand({ kind: 'local', name: 'Local', root });
  const command = spec.args.join('\n');

  assert.match(command, /cd -- /);
  assert.match(command, /exec "\$\{SHELL:-bash\}"/);
});

test('terminal output strips common ANSI and shell control sequences', async () => {
  const { cleanTerminalOutput } = await import(`../lib/terminal.js?clean=${Date.now()}`);
  const raw = '\u001b[?2004h\u001b]0;root@srv: ~\u0007root@srv:~# ls\r\n\u001b[?2004l\u001b[01;31mfile.tar.gz\u001b[0m\r\nroot@srv:/# \u0007\u0007\u0007';

  assert.equal(cleanTerminalOutput(raw), 'root@srv:~# ls\nfile.tar.gz\nroot@srv:/# ');
});

test('terminal output detects clear-screen sequences', async () => {
  const { hasClearScreen } = await import(`../lib/terminal.js?clear=${Date.now()}`);

  assert.equal(hasClearScreen('\u001b[H\u001b[2Jroot@srv:~# '), true);
  assert.equal(hasClearScreen('root@srv:~# ls\n'), false);
});

test('terminal output applies backspace and delete echoes', async () => {
  const { cleanTerminalOutput, mergeTerminalOutput } = await import(`../lib/terminal.js?erase=${Date.now()}`);

  assert.equal(cleanTerminalOutput('abc\b \bd'), 'abd');
  assert.equal(cleanTerminalOutput('abc\x7f \x7fd'), 'abd');
  assert.equal(mergeTerminalOutput('abc', '\b \bd'), 'abd');
  assert.equal(mergeTerminalOutput('abc', '\x7f \x7fd'), 'abd');
});
