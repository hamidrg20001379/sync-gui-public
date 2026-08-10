import fs from 'node:fs/promises';
import path from 'node:path';

export const configPath = process.env.SYNC_CONFIG || (process.cwd() + '/sync-config.json');

function migrationV1(config) {
  let changed = false;
  for (const item of config.items || []) {
    if (item.dest && !item.targets) {
      const project = config.projects?.find(p => p.id === item.projectId);
      item.targets = [{ name: 'Default', remoteId: project?.remoteId || '', dest: item.dest }];
      delete item.dest;
      changed = true;
    }
  }
  if (changed) config._migrated = true;
  return config;
}

function migrateFromFlat(config) {
  const remotes = [], projects = [];
  const remoteKey = r => JSON.stringify({ kind: r.kind, host: r.host, port: r.port, username: r.username });

  for (const item of config.items || []) {
    const conn = item.connection || { kind: 'local' };
    const key = remoteKey(conn);
    let remote = remotes.find(r => remoteKey(r) === key);
    if (!remote) {
      remote = { id: 'r-' + remotes.length, name: conn.host || 'local', ...conn };
      remotes.push(remote);
    }
    const group = item.group || 'Default';
    let project = projects.find(p => p.name === group && p.remoteId === remote.id);
    if (!project) {
      project = { id: 'p-' + projects.length, name: group, remoteId: remote.id };
      projects.push(project);
    }
    delete item.connection;
    delete item.group;
    delete item.direction;
    item.projectId = project.id;
  }
  return migrationV1({ remotes, projects, items: config.items || [] });
}

function migrateFromOld(config) {
  const items = [];
  for (const project of config.projects || []) {
    const remote = config.remotes?.find(r => r.id === project.remoteId);
    const connection = remote ? {
      kind: remote.kind, host: remote.host || '', port: remote.port || 22,
      username: remote.username || '', password: remote.password || '',
    } : { kind: 'local' };
    for (const mapping of project.mappings || []) {
      items.push({
        id: mapping.id || (project.id + '-' + items.length),
        name: mapping.name || (mapping.source || '').split('/').pop() || 'Unnamed',
        source: mapping.source || '', dest: mapping.dest || '',
        type: mapping.type || 'folder',
        projectId: project.id,
      });
    }
  }
  return migrateFromFlat({ items });
}

function migrate(config) {
  if (config.items?.some(i => i.connection || i.group || i.direction)) return migrateFromFlat(config);
  if (config.projects && config.projects.some(p => p.mappings)) return migrateFromOld(config);
  config.remotes ??= [];
  config.projects ??= [];
  config.categories ??= [];
  config.items ??= [];
  config.settings ??= {};
  config.settings.restrictToChangedFiles = Boolean(config.settings.restrictToChangedFiles);
  const categoryIds = new Set(config.categories.map(category => category.id));
  for (const categoryId of [...new Set(config.items.map(item => item.categoryId).filter(Boolean))]) {
    if (categoryIds.has(categoryId)) continue;
    const item = config.items.find(candidate => candidate.categoryId === categoryId);
    // ponytail: recover only the missing top-level shell; if parent/category metadata grows, store tombstones.
    config.categories.push({
      id: categoryId,
      name: categoryId.split('-')[0] || 'Recovered category',
      projectId: item?.projectId || '',
      parentId: ''
    });
    categoryIds.add(categoryId);
    config._migrated = true;
  }
  return migrationV1(config);
}

function itemUsesRemote(item, config, remoteId) {
  if (config.projects?.find(p => p.id === item.projectId)?.remoteId === remoteId) return true;
  return (item.targets || []).some(target => {
    const remoteIds = target.remoteIds?.length ? target.remoteIds : [target.remoteId].filter(Boolean);
    return remoteIds.includes(remoteId);
  });
}

function applyKnownPathTokens(pattern, values) {
  return pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => (
    values[name] === undefined ? token : values[name]
  ));
}

async function pathExists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

async function removeEmptyParents(startDir, stopDir) {
  let current = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  while (current.startsWith(stop) && current !== stop) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length) break;
      await fs.rmdir(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

export async function applyRemoteRenameMigrations(previousConfig, nextConfig) {
  const previousRemotes = new Map((previousConfig.remotes || []).map(remote => [remote.id, remote]));
  for (const remote of nextConfig.remotes || []) {
    const previous = previousRemotes.get(remote.id);
    if (!previous || previous.name === remote.name) continue;

    for (const item of nextConfig.items || []) {
      if (!item.source?.includes('{SERVER_NAME}')) continue;
      if (!itemUsesRemote(item, nextConfig, remote.id)) continue;

      const oldPath = path.resolve(applyKnownPathTokens(item.source, { SERVER_NAME: previous.name }));
      const newPath = path.resolve(applyKnownPathTokens(item.source, { SERVER_NAME: remote.name }));
      if (oldPath === newPath) continue;
      if (!await pathExists(oldPath)) continue;
      if (await pathExists(newPath)) continue;

      // ponytail: rename only exact existing {SERVER_NAME}-derived paths; if both old and new exist, leave them unchanged.
      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.rename(oldPath, newPath);
      await removeEmptyParents(path.dirname(oldPath), process.cwd());
    }
  }
}

export async function readConfig() {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = migrate(JSON.parse(raw));
    if (config._migrated) {
      delete config._migrated;
      await writeConfig(config);
    }
    return config;
  } catch {
    return { remotes: [], projects: [], categories: [], items: [], settings: { restrictToChangedFiles: false } };
  }
}

export async function writeConfig(config, options = {}) {
  config.remotes ??= [];
  config.projects ??= [];
  config.categories ??= [];
  config.items ??= [];
  config.settings ??= {};
  config.settings.restrictToChangedFiles = Boolean(config.settings.restrictToChangedFiles);
  if (options.previousConfig) {
    await applyRemoteRenameMigrations(options.previousConfig, config);
  }
  const out = { remotes: config.remotes, projects: config.projects, categories: config.categories, items: config.items, settings: config.settings };
  await fs.writeFile(configPath, JSON.stringify(out, null, 2), 'utf8');
}
