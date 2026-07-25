import fs from 'node:fs/promises';

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
    delete item.connection; delete item.group; delete item.direction;
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
  config.remotes ??= []; config.projects ??= []; config.items ??= [];
  return migrationV1(config);
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
    return { remotes: [], projects: [], items: [] };
  }
}

export async function writeConfig(config) {
  config.remotes ??= []; config.projects ??= []; config.items ??= [];
  const out = { remotes: config.remotes, projects: config.projects, items: config.items };
  await fs.writeFile(configPath, JSON.stringify(out, null, 2), 'utf8');
}
