import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { getPostCommitHook, setPostCommitHook } from '../lib/git-hooks.js';

const execFileAsync = promisify(execFile);

test('post-commit hook installs, preserves, and removes one sync item', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'sync-gui-hook-'));
  try {
    await execFileAsync('git', ['init', repo], { windowsHide: true });
    const item = { id: "item-'one", source: repo };
    const hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
    await writeFile(hookPath, '#!/bin/sh\necho existing\n', 'utf8');

    const installed = await setPostCommitHook(item, 'install');
    assert.equal(installed.installed, true);
    const contents = await readFile(hookPath, 'utf8');
    assert.match(contents, /echo existing/);
    assert.match(contents, /git diff-tree/);
    assert.match(contents, /-- '\.'/);
    assert.match(contents, /api\/run/);
    assert.equal((await getPostCommitHook(item)).installed, true);

    await setPostCommitHook(item, 'remove');
    assert.match(await readFile(hookPath, 'utf8'), /echo existing/);
    assert.equal((await getPostCommitHook(item)).installed, false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('file sources and malformed blocks are handled without losing hook content', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'sync-gui-hook-file-'));
  try {
    await execFileAsync('git', ['init', repo], { windowsHide: true });
    const source = path.join(repo, 'tracked.txt');
    const hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
    await writeFile(source, 'content\n', 'utf8');
    await writeFile(hookPath, '#!/bin/sh\n# sync-gui post-commit begin ZmlsZS1pdGVt\necho keep-me\n', 'utf8');

    const item = { id: 'file-item', source };
    await setPostCommitHook(item, 'install');
    const installed = await readFile(hookPath, 'utf8');
    assert.match(installed, /-- 'tracked\.txt'/);
    assert.match(installed, /echo keep-me/);

    await setPostCommitHook(item, 'remove');
    const removed = await readFile(hookPath, 'utf8');
    assert.match(removed, /echo keep-me/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
