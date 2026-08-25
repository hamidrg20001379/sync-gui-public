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
