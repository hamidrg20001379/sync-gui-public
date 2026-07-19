import { getRemoteKind } from './config-helpers';

export function pickProject(project) {
  return {
    id: project.id,
    label: project.label || '',
    root: project.root,
    remotes: project.remotes || [],
    streams: project.streams || [],
    categories: project.categories || []
  };
}

export function pickRemote(remote) {
  return {
    id: remote.id,
    label: remote.label || '',
    kind: getRemoteKind(remote),
    root: remote.root || remote.path || '',
    hostEnv: remote.hostEnv || '',
    portEnv: remote.portEnv || '',
    usernameEnv: remote.usernameEnv || '',
    passwordEnv: remote.passwordEnv || '',
    host: remote.host || '',
    port: remote.port || '',
    username: remote.username || '',
    password: remote.password || ''
  };
}

export function pickProjectStream(remote) {
  return {
    id: remote.id,
    label: remote.label || '',
    remoteId: remote.remoteId || remote.id
  };
}

export function pickCategory(category) {
  return {
    id: category.id,
    label: category.label || '',
    categories: category.categories || [],
    mappings: category.mappings || []
  };
}

export function renameCategoryTargets(categories, oldStreamId, newStreamId) {
  for (const category of categories) {
    for (const mapping of category.mappings || []) {
      for (const target of mapping.targets || []) {
        if (target.streamId === oldStreamId) target.streamId = newStreamId;
      }
    }
    renameCategoryTargets(category.categories || [], oldStreamId, newStreamId);
  }
}

export function removeCategoryTargets(categories, streamId) {
  for (const category of categories) {
    for (const mapping of category.mappings || []) {
      mapping.targets = (mapping.targets || []).filter((target) => target.streamId !== streamId);
    }
    removeCategoryTargets(category.categories || [], streamId);
  }
}
