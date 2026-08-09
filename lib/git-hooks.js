import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const markerPrefix = '# sync-gui post-commit';

function itemMarker(itemId, boundary) {
  return `${markerPrefix} ${boundary} ${Buffer.from(itemId).toString('base64url')}`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function hookBlock(itemId, sourceRelativePath, eol) {
  const start = itemMarker(itemId, 'begin');
  const end = itemMarker(itemId, 'end');
  const payload = JSON.stringify({ itemIds: [itemId], direction: 'up' });
  const changedFiles = `git diff-tree --root --no-commit-id --name-only -r HEAD -- ${shellQuote(sourceRelativePath)}`;
  return [
    start,
    `changed_files=$(${changedFiles})`,
    'if [ -n "$changed_files" ] && command -v curl >/dev/null 2>&1; then',
    `  curl --silent --show-error --fail --max-time 30 -H 'Content-Type: application/json' --data-raw ${shellQuote(payload)} 'http://127.0.0.1:49173/api/run' >/dev/null 2>&1 || true`,
    'fi',
    end,
  ].join(eol) + eol;
}

function removeHookBlock(contents, itemId) {
  const eol = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  const start = itemMarker(itemId, 'begin');
  const end = itemMarker(itemId, 'end');
  let removed = false;
  const kept = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== start) {
      kept.push(lines[i]);
      continue;
    }
    const nextStart = lines.indexOf(start, i + 1);
    const endIndex = lines.indexOf(end, i + 1);
    if (endIndex === -1 || (nextStart !== -1 && nextStart < endIndex)) {
      kept.push(lines[i]);
      continue;
    }
    removed = true;
    i = endIndex;
  }

  return { contents: kept.join(eol), removed };
}

async function gitOutput(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
    return stdout.trim();
  } catch {
    throw new Error('The sync source is not inside a Git repository.');
  }
}

export async function resolveGitHook(item) {
  if (!item?.source) throw new Error('This sync item has no source path.');
  const configuredSourcePath = path.resolve(item.source);
  let sourcePath = configuredSourcePath;
  let sourceIsFile = false;
  try {
    const stat = await fs.stat(sourcePath);
    sourceIsFile = stat.isFile();
    if (sourceIsFile) sourcePath = path.dirname(sourcePath);
  } catch {
    throw new Error(`Sync source was not found: ${sourcePath}`);
  }

  const repoRoot = await gitOutput(['-C', sourcePath, 'rev-parse', '--show-toplevel'], sourcePath);
  const gitPath = await gitOutput(['-C', repoRoot, 'rev-parse', '--git-path', 'hooks'], repoRoot);
  const hooksPath = path.resolve(repoRoot, gitPath);
  const sourceRelativePath = path.relative(repoRoot, sourceIsFile ? configuredSourcePath : sourcePath).replace(/\\/g, '/') || '.';
  return { repoRoot, hookPath: path.join(hooksPath, 'post-commit'), sourceRelativePath };
}

export async function getPostCommitHook(item) {
  const { repoRoot, hookPath } = await resolveGitHook(item);
  let contents = '';
  try {
    contents = await fs.readFile(hookPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { itemId: item.id, repoRoot, installed: removeHookBlock(contents, item.id).removed };
}

export async function setPostCommitHook(item, action) {
  if (action !== 'install' && action !== 'remove') {
    throw new Error('Hook action must be install or remove.');
  }
  const { repoRoot, hookPath, sourceRelativePath } = await resolveGitHook(item);
  let contents = '';
  let exists = true;
  try {
    contents = await fs.readFile(hookPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    exists = false;
  }

  if (action === 'remove' && !exists) {
    return { itemId: item.id, repoRoot, installed: false };
  }
  const eol = contents.includes('\r\n') ? '\r\n' : '\n';
  const stripped = removeHookBlock(contents, item.id);
  if (action === 'remove' && !stripped.removed) {
    return { itemId: item.id, repoRoot, installed: false };
  }
  contents = stripped.contents;
  if (action === 'install') {
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    if (!contents) contents = `#!/bin/sh${eol}${eol}`;
    else if (!contents.endsWith(eol)) contents += eol;
    contents += hookBlock(item.id, sourceRelativePath, eol);
  }

  await fs.writeFile(hookPath, contents, 'utf8');
  if (process.platform !== 'win32') await fs.chmod(hookPath, 0o755);
  return { itemId: item.id, repoRoot, installed: action === 'install' };
}
