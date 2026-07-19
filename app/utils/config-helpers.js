export function getRemoteKind(remote) {
  const kind = remote.kind || 'ssh';
  return kind === 'path' ? 'share' : kind;
}

export function remoteSummary(remote) {
  const kind = getRemoteKind(remote);
  if (kind === 'ssh') return remote.host || remote.hostEnv || 'SSH server';
  if (kind === 'share') return remote.root || 'Network share';
  return remote.root || 'Local folder';
}

function resolveLinkedRemotes(config, project, items) {
  return (items || []).map((projectRemote) => {
    const globalRemote = (config.remotes || []).find((item) => item.id === (projectRemote.remoteId || projectRemote.id)) || {};
    return {
      ...globalRemote,
      ...projectRemote,
      remoteId: projectRemote.remoteId || projectRemote.id,
      label: projectRemote.label || globalRemote.label || projectRemote.id,
      categories: projectRemote.categories || []
    };
  });
}

export function getProjectRemotes(config, project) {
  const projectRemotes = (project.streams?.length ? project.streams : project.remotes) || [];
  return resolveLinkedRemotes(config, project, projectRemotes);
}

export function getProjectRemotesList(config, project) {
  return resolveLinkedRemotes(config, project, project.remotes);
}

export function getProjectStreamsList(config, project) {
  return resolveLinkedRemotes(config, project, project.streams);
}

export function uniqueId(items, base) {
  const used = new Set(items.map((item) => item.id));
  let id = base;
  let index = 2;
  while (used.has(id)) id = `${base}-${index++}`;
  return id;
}

export function resolveCategoryPath(categories, path) {
  let current = null;
  let items = categories;
  const ancestors = [];
  for (const id of path) {
    const found = items.find((c) => c.id === id);
    if (!found) return { current: null, ancestors };
    ancestors.push(found);
    current = found;
    items = found.categories || [];
  }
  return { current, ancestors };
}

export function getRemote(config, projectId, remoteId) {
  return config.projects.find((item) => item.id === projectId).remotes.find((item) => item.id === remoteId);
}

export function getCategory(config, projectId, remoteId, categoryId) {
  return getRemote(config, projectId, remoteId).categories.find((item) => item.id === categoryId);
}
