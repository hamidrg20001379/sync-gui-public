import fs from 'node:fs/promises';
import path from 'node:path';

export const workspaceRoot = process.cwd();
export const configPath = process.env.SYNC_GUI_CONFIG || path.join(workspaceRoot, 'sync-projects.json');
export const envPath = process.env.SYNC_GUI_ENV || path.join(workspaceRoot, '.env');

export async function readConfig() {
  const raw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(raw);
  normalizeConfig(config);
  validateConfig(config);
  return config;
}

export async function writeConfig(config) {
  normalizeConfig(config);
  validateConfig(config);
  const tempPath = `${configPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, configPath);
}

export async function readEnv(filePath = envPath) {
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

export function validateConfig(config) {
  if (!Array.isArray(config.projects)) throw new Error('config.projects must be an array');
  if (!Array.isArray(config.remotes)) throw new Error('config.remotes must be an array');

  const globalRemoteIds = new Set();
  for (const remote of config.remotes) {
    requireId(remote.id, 'remote id');
    if (globalRemoteIds.has(remote.id)) throw new Error(`Duplicate remote id: ${remote.id}`);
    validateRemoteConnection(remote, `Remote ${remote.id}`);
    globalRemoteIds.add(remote.id);
  }

  const projectIds = new Set();

  for (const project of config.projects) {
    requireId(project.id, 'project id');
    if (projectIds.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`);
    if (!project.root) throw new Error(`Project ${project.id} is missing root`);
    if (!Array.isArray(project.remotes)) throw new Error(`Project ${project.id} remotes must be an array`);
    projectIds.add(project.id);

    const remoteIds = new Set();
    for (const projectRemote of project.remotes) {
      requireId(projectRemote.id, 'remote id');
      if (remoteIds.has(projectRemote.id)) throw new Error(`Duplicate remote id in ${project.id}: ${projectRemote.id}`);
      const connectionId = getRemoteConnectionId(projectRemote);
      requireId(connectionId, 'remote connection id');
      if (!globalRemoteIds.has(connectionId)) throw new Error(`Project ${project.id} uses unknown remote: ${connectionId}`);
      const remote = mergeRemote(projectRemote, config.remotes.find((entry) => entry.id === connectionId));
      const remoteKind = getRemoteKind(remote);
      if (!Array.isArray(projectRemote.categories)) throw new Error(`Remote ${project.id}/${projectRemote.id} categories must be an array`);
      remoteIds.add(projectRemote.id);

      const categoryIds = new Set();
      for (const category of projectRemote.categories) {
        validateCategory(category, `${project.id}/${projectRemote.id}`, categoryIds, remoteKind);
      }
    }
  }
}

function validateRemoteConnection(remote, label) {
  const remoteKind = getRemoteKind(remote);
  if (!['ssh', 'share', 'local'].includes(remoteKind)) throw new Error(`${label} kind must be ssh, share, or local`);
  if (remoteKind !== 'ssh' && !remote.root) throw new Error(`${label} is missing root path`);
}

function validateCategory(category, parentPath, siblingIds, remoteKind) {
  requireId(category.id, 'category id');
  if (siblingIds.has(category.id)) throw new Error(`Duplicate category id in ${parentPath}: ${category.id}`);
  if (!Array.isArray(category.categories)) throw new Error(`Category ${parentPath}/${category.id} categories must be an array`);
  if (!Array.isArray(category.mappings)) throw new Error(`Category ${parentPath}/${category.id} mappings must be an array`);
  siblingIds.add(category.id);

  const categoryIds = new Set();
  for (const child of category.categories) {
    validateCategory(child, `${parentPath}/${category.id}`, categoryIds, remoteKind);
  }

  const mappingIds = new Set();
  for (const mapping of category.mappings) {
    requireId(mapping.id, 'mapping id');
    if (mappingIds.has(mapping.id)) throw new Error(`Duplicate mapping id in ${parentPath}/${category.id}: ${mapping.id}`);
    if (mapping.type !== 'file' && mapping.type !== 'dir') throw new Error(`Mapping ${mapping.id} type must be file or dir`);
    if (!mapping.local) throw new Error(`Mapping ${mapping.id} is missing local path`);
    if (!mapping.remote) throw new Error(`Mapping ${mapping.id} is missing remote path`);
    if (remoteKind === 'ssh' && !mapping.remote.startsWith('/')) throw new Error(`Mapping ${mapping.id} remote path must start with /`);
    mappingIds.add(mapping.id);
  }
}
export function normalizeConfig(config) {
  if (!Array.isArray(config.projects)) return config;
  if (!Array.isArray(config.remotes)) config.remotes = [];

  const globalRemoteIds = new Set(config.remotes.map((remote) => remote.id));
  config.remotes = config.remotes.map(normalizeRemoteConnection);

  for (const project of config.projects) {
    if (!Array.isArray(project.remotes)) project.remotes = [];
    if (!Array.isArray(project.streams)) project.streams = [];
    if (Array.isArray(project.categories)) {
      normalizeStreamMappings(project);
    }
    if (Array.isArray(project.remoteIds)) {
      for (const id of project.remoteIds) {
        if (!project.remotes.some((remote) => remote.id === id)) {
          project.remotes.push({ id, categories: [] });
        }
      }
      delete project.remoteIds;
    }

    project.remotes = project.remotes.map((remote) => {
      const connectionId = getRemoteConnectionId(remote);
      if (!globalRemoteIds.has(connectionId)) {
        const globalRemote = normalizeRemoteConnection({ ...remote, id: connectionId });
        config.remotes.push(stripRemoteConnection(globalRemote));
        globalRemoteIds.add(connectionId);
      }

      if (!Array.isArray(remote.categories)) {
        remote.categories = [];
      }

      if (Array.isArray(remote.mappings)) {
        for (const mapping of remote.mappings) {
          remote.categories.push({
            id: mapping.id,
            label: mapping.label || mapping.id,
            categories: [],
            mappings: [mapping]
          });
        }
        delete remote.mappings;
      }

      for (const category of remote.categories) {
        normalizeCategory(category);
      }

      return {
        id: remote.id,
        ...(remote.remoteId ? { remoteId: remote.remoteId } : {}),
        ...(remote.label ? { label: remote.label } : {}),
        categories: remote.categories
      };
    });
  }

  return config;
}

function normalizeStreamMappings(project) {
  const streams = new Map(project.streams.map((stream) => [stream.id, {
    id: stream.id,
    ...(stream.remoteId ? { remoteId: stream.remoteId } : {}),
    ...(stream.label ? { label: stream.label } : {}),
    categories: []
  }]));

  for (const category of project.categories) {
    normalizeCategory(category);
    addStreamCategoryMappings(streams, category);
  }

  project.streams = [...streams.values()];
  project.remotes = project.streams.map((stream) => ({
    id: stream.id,
    ...(stream.remoteId ? { remoteId: stream.remoteId } : {}),
    ...(stream.label ? { label: stream.label } : {}),
    categories: stream.categories.map(toRemoteCategory)
  }));
}

function addStreamCategoryMappings(streams, category) {
  const mappingsByStream = new Map();
  for (const mapping of category.mappings) {
    for (const target of mapping.targets || []) {
      if (!streams.has(target.streamId)) {
        streams.set(target.streamId, { id: target.streamId, categories: [] });
      }
      const nextMapping = {
        id: mapping.id,
        ...(mapping.label ? { label: mapping.label } : {}),
        type: mapping.type,
        local: mapping.local,
        remotePaths: [target.remote]
      };
      const mappings = mappingsByStream.get(target.streamId) || [];
      mappings.push(nextMapping);
      mappingsByStream.set(target.streamId, mappings);
    }
  }

  const childCategoriesByStream = new Map();
  for (const child of category.categories) {
    for (const [streamId, childCategory] of addStreamCategoryMappings(streams, child)) {
      const childCategories = childCategoriesByStream.get(streamId) || [];
      childCategories.push(childCategory);
      childCategoriesByStream.set(streamId, childCategories);
    }
  }

  const streamIds = new Set([...mappingsByStream.keys(), ...childCategoriesByStream.keys()]);
  const categoriesByStream = new Map();
  for (const streamId of streamIds) {
    const streamCategory = {
      id: category.id,
      ...(category.label ? { label: category.label } : {}),
      categories: childCategoriesByStream.get(streamId) || [],
      mappings: mappingsByStream.get(streamId) || []
    };
    streams.get(streamId).categories.push(streamCategory);
    categoriesByStream.set(streamId, streamCategory);
  }

  return categoriesByStream;
}

function toRemoteCategory(category) {
  return {
    id: category.id,
    ...(category.label ? { label: category.label } : {}),
    categories: category.categories.map(toRemoteCategory),
    mappings: category.mappings.flatMap((mapping) => (
      (mapping.remotePaths || []).map((remote) => ({
        id: mapping.id,
        ...(mapping.label ? { label: mapping.label } : {}),
        type: mapping.type,
        local: mapping.local,
        remote
      }))
    ))
  };
}

function normalizeRemoteConnection(remote) {
  if (!remote.kind) remote.kind = 'ssh';
  if (remote.kind === 'path') remote.kind = 'share';
  if (!remote.root && remote.path) remote.root = remote.path;
  return remote;
}

function stripRemoteConnection(remote) {
  const copy = { ...remote };
  delete copy.remoteId;
  delete copy.categories;
  delete copy.mappings;
  return copy;
}

function normalizeCategory(category) {
  if (!Array.isArray(category.categories)) category.categories = [];
  if (!Array.isArray(category.mappings)) category.mappings = [];
  for (const child of category.categories) {
    normalizeCategory(child);
  }
}

function requireId(value, label) {
  if (!/^[A-Za-z0-9._-]+$/.test(value || '')) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function resolveRemote(remote, env) {
  const host = remote.host || env[remote.hostEnv];
  const username = remote.username || env[remote.usernameEnv];
  const password = remote.password || env[remote.passwordEnv];
  const port = String(remote.port || env[remote.portEnv] || 22);

  if (!host) throw new Error(`Remote ${remote.id} is missing host`);
  if (!username) throw new Error(`Remote ${remote.id} is missing username`);
  if (!password) throw new Error(`Remote ${remote.id} is missing password`);

  return { host, username, password, port };
}

export function getRemoteKind(remote) {
  const kind = remote.kind || 'ssh';
  return kind === 'path' ? 'share' : kind;
}

export function getProjectRemotes(config, project) {
  return project.remotes.map((projectRemote) => {
    const globalRemote = config.remotes.find((remote) => remote.id === getRemoteConnectionId(projectRemote)) || {};
    return mergeRemote(projectRemote, globalRemote);
  });
}

function mergeRemote(projectRemote, globalRemote) {
  return {
    ...globalRemote,
    ...projectRemote,
    remoteId: getRemoteConnectionId(projectRemote),
    label: projectRemote.label || globalRemote.label || projectRemote.id,
    categories: projectRemote.categories || []
  };
}

function getRemoteConnectionId(projectRemote) {
  return projectRemote.remoteId || projectRemote.id;
}

export function resolveProjectRoot(project) {
  return path.isAbsolute(project.root)
    ? project.root
    : path.resolve(path.dirname(configPath), project.root);
}

export function resolveLocalPath(project, target) {
  const projectRoot = resolveProjectRoot(project);
  return path.isAbsolute(target.local)
    ? target.local
    : path.resolve(projectRoot, target.local);
}

export function resolveRemotePath(remote, target) {
  if (isFullWindowsPath(target.remote)) return path.win32.normalize(target.remote);
  const relative = target.remote.replace(/^[\\/]+/, '');
  return path.win32.normalize(path.win32.join(remote.root, relative));
}

function isFullWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

export function flattenMappings(config) {
  const rows = [];
  for (const project of config.projects) {
    for (const remote of getProjectRemotes(config, project)) {
      for (const category of remote.categories) {
        flattenCategoryMappings(rows, project, remote, category, [category.id]);
      }
    }
  }
  return rows;
}

function flattenCategoryMappings(rows, project, remote, category, categoryPath) {
  for (const mapping of category.mappings) {
    rows.push({
      key: `${project.id}/${remote.id}/${categoryPath.join('/')}/${mapping.id}`,
      project,
      remote,
      category,
      categoryPath,
      mapping
    });
  }

  for (const child of category.categories) {
    flattenCategoryMappings(rows, project, remote, child, [...categoryPath, child.id]);
  }
}
