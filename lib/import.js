export function analyzeImport(existing, data) {
  const existingRemote = new Map(existing.remotes.map(r => [r.name, r]));
  const existingProject = new Map(existing.projects.map(p => [p.name, p]));
  const importProjectById = {};
  for (const p of data.projects || []) importProjectById[p.id] = p;

  const remotes = (data.remotes || []).map((r, i) => {
    const ex = existingRemote.get(r.name);
    return { idx: i, imported: r, existing: ex || null, conflict: !!ex };
  });
  const projects = (data.projects || []).map((p, i) => {
    const ex = existingProject.get(p.name);
    return { idx: i, imported: p, existing: ex || null, conflict: !!ex, remoteName: ((data.remotes || []).find(r => r.id === p.remoteId) || {}).name };
  });
  const items = (data.items || []).map((item, i) => {
    const impProject = importProjectById[item.projectId];
    const projName = impProject?.name || '?';
    const exProject = existingProject.get(projName);
    const ex = exProject
      ? existing.items.find(e => e.name === item.name && e.projectId === exProject.id)
      : null;
    return { idx: i, imported: item, existing: ex || null, conflict: !!ex, projectName: projName };
  });

  const summary = {
    remotesNew: remotes.filter(r => !r.conflict).length,
    remotesConflict: remotes.filter(r => r.conflict).length,
    projectsNew: projects.filter(p => !p.conflict).length,
    projectsConflict: projects.filter(p => p.conflict).length,
    itemsNew: items.filter(i => !i.conflict).length,
    itemsConflict: items.filter(i => i.conflict).length,
  };

  return { summary, remotes, projects, items };
}

function nextId(prefix, existing) {
  const max = existing
    .map(e => { const n = parseInt(e.id?.slice(prefix.length) || '0', 10); return isNaN(n) ? -1 : n; })
    .reduce((a, b) => Math.max(a, b), -1);
  return prefix + (max + 1);
}

export function applyImport(existing, data, resolutions) {
  const remapRemoteId = {};
  const remapProjectId = {};

  const remoteRes = resolutions.remotes || {};
  for (const r of data.remotes || []) {
    const res = remoteRes[r.name];
    if (!res) { r.id = nextId('r-', existing.remotes); existing.remotes.push(r); remapRemoteId[r.id] = r.id; continue; }
    if (res.action === 'skip') continue;
    const copy = { ...r };
    if (res.action === 'rename') copy.name = res.newName || (r.name + ' (imported)');
    if (res.action === 'replace') {
      const idx = existing.remotes.findIndex(e => e.name === r.name);
      if (idx !== -1) existing.remotes[idx] = { ...existing.remotes[idx], ...copy, id: existing.remotes[idx].id };
      remapRemoteId[r.id] = existing.remotes[idx].id;
      continue;
    }
    copy.id = nextId('r-', existing.remotes);
    existing.remotes.push(copy);
    remapRemoteId[r.id] = copy.id;
  }

  const projectRes = resolutions.projects || {};
  for (const p of data.projects || []) {
    const res = projectRes[p.name];
    const copy = { ...p, remoteId: remapRemoteId[p.remoteId] || p.remoteId };
    if (!res) { copy.id = nextId('p-', existing.projects); existing.projects.push(copy); remapProjectId[p.id] = copy.id; continue; }
    if (res.action === 'skip') continue;
    if (res.action === 'rename') copy.name = res.newName || (p.name + ' (imported)');
    if (res.action === 'replace') {
      const idx = existing.projects.findIndex(e => e.name === p.name);
      if (idx !== -1) existing.projects[idx] = { ...existing.projects[idx], ...copy, id: existing.projects[idx].id };
      remapProjectId[p.id] = existing.projects[idx].id;
      continue;
    }
    copy.id = nextId('p-', existing.projects);
    existing.projects.push(copy);
    remapProjectId[p.id] = copy.id;
  }

  const itemRes = resolutions.items || {};
  for (const item of data.items || []) {
    const impProject = data.projects?.find(p => p.id === item.projectId);
    const projName = impProject?.name || '?';
    const resolvedPid = remapProjectId[item.projectId] || item.projectId;
    const key = item.name + '@' + projName;
    const res = itemRes[key];
    const copy = { ...item, projectId: resolvedPid };
    if (!res || res.action === 'replace') {
      const idx = existing.items.findIndex(e => e.name === item.name && e.projectId === resolvedPid);
      if (idx !== -1) { existing.items[idx] = { ...existing.items[idx], ...copy, id: existing.items[idx].id }; continue; }
      copy.id = nextId('i-', existing.items); existing.items.push(copy);
      continue;
    }
    if (res.action === 'skip') continue;
    if (res.action === 'rename') {
      copy.name = res.newName || (item.name + ' (imported)');
      copy.id = nextId('i-', existing.items); existing.items.push(copy);
    }
  }

  return existing;
}
