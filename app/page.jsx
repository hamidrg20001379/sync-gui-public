'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const blankProject = { id: '', label: '', root: '', remotes: [], streams: [] };
const blankRemote = {
  id: '',
  label: '',
  kind: 'ssh',
  root: '',
  host: '',
  port: '22',
  username: '',
  password: '',
  hostEnv: 'SERVER_HOST',
  portEnv: 'SERVER_PORT',
  usernameEnv: 'SERVER_USERNAME',
  passwordEnv: 'SERVER_PASSWORD',
  categories: []
};
const blankCategory = { id: '', label: '', categories: [], mappings: [] };
const blankMapping = { id: '', label: '', type: 'dir', local: '', remote: '', remoteId: '' };

export default function Page() {
  const [config, setConfig] = useState({ projects: [], remotes: [] });
  const [paths, setPaths] = useState({});
  const [projectId, setProjectId] = useState('');
  const [remoteId, setRemoteId] = useState('');
  const [streamId, setStreamId] = useState('');
  const [modal, setModal] = useState(null);
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('Ready');
  const [dirty, setDirty] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [noDelete, setNoDelete] = useState(false);
  const [dragCategoryId, setDragCategoryId] = useState('');
  const [categoryPath, setCategoryPath] = useState([]);
  const [liveCategoryIds, setLiveCategoryIds] = useState([]);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const liveRunningRef = useRef(new Set());

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem('sync-gui-update-checked')) return;
    sessionStorage.setItem('sync-gui-update-checked', '1');
    checkForUpdates(false);
  }, []);

  const project = useMemo(
    () => config.projects.find((item) => item.id === projectId),
    [config, projectId]
  );
  const projectRemotes = useMemo(
    () => (project ? getProjectRemotes(config, project) : []),
    [config, project]
  );
  const remote = useMemo(
    () => projectRemotes.find((item) => item.id === remoteId),
    [projectRemotes, remoteId]
  );
  const stream = useMemo(
    () => (project?.streams || []).find((item) => item.id === streamId),
    [project, streamId]
  );
  const liveTargets = useMemo(() => collectCategoryTargets(config), [config]);
  const activeLiveTargets = useMemo(
    () => liveTargets.filter((target) => liveCategoryIds.includes(target.id)),
    [liveTargets, liveCategoryIds]
  );
  const view = stream ? 'streamCategories' : remote ? 'categories' : project ? 'remotes' : 'projects';

  useEffect(() => {
    if (!liveCategoryIds.length) return;
    const known = new Set(liveTargets.map((target) => target.id));
    const nextIds = liveCategoryIds.filter((id) => known.has(id));
    if (nextIds.length !== liveCategoryIds.length) setLiveCategoryIds(nextIds);
  }, [liveTargets, liveCategoryIds]);

  useEffect(() => {
    if (!activeLiveTargets.length) return;

    const tick = () => {
      for (const target of activeLiveTargets) {
        if (!target.keys.length || liveRunningRef.current.has(target.id)) continue;
        liveRunningRef.current.add(target.id);
        runLiveUp(target).finally(() => {
          liveRunningRef.current.delete(target.id);
        });
      }
    };

    tick();
    const intervalId = setInterval(tick, 5000);
    return () => clearInterval(intervalId);
  }, [activeLiveTargets, dryRun, noDelete]);

  async function loadConfig() {
    setStatus('Loading');
    const response = await fetch('/api/config');
    const data = await response.json();
    if (!response.ok) {
      setStatus('Failed');
      setOutput(data.error || 'Failed to load config');
      return;
    }
    setConfig(data.config);
    setPaths(data.paths || {});
    setProjectId(data.config.ui?.projectId || '');
    setRemoteId(data.config.ui?.remoteId || '');
    setStreamId(data.config.ui?.streamId || '');
    setCategoryPath(data.config.ui?.categoryPath || []);
    setModal(null);
    setDirty(false);
    setStatus('Ready');
  }

  async function saveConfig(nextConfig = config) {
    setStatus('Saving');
    const toSave = { ...nextConfig, ui: { ...(nextConfig.ui || {}), projectId, remoteId, streamId, categoryPath } };
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSave)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus('Failed');
      setOutput(data.error || 'Failed to save config');
      return false;
    }
    setConfig(toSave);
    setDirty(false);
    setStatus('Saved');
    return true;
  }

  function mutate(mutator) {
    setConfig((oldConfig) => {
      const next = structuredClone(oldConfig);
      mutator(next);
      return next;
    });
    setDirty(true);
  }

  async function runKeys(keys, direction) {
    if (!keys.length) {
      setOutput('No mappings in this box yet.');
      return;
    }

    setStatus('Running');
    setOutput(`> sync --${direction}${dryRun ? ' --dry-run' : ''}${noDelete ? ' --no-delete' : ''} ${keys.join(' ')}\n`);
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, dryRun, noDelete, targetIds: keys })
    });
    const data = await response.json();
    setOutput((old) => `${old}${data.output || data.error || ''}\nExit code: ${data.exitCode ?? 1}`);
    setStatus((data.exitCode ?? 1) === 0 ? 'Done' : 'Failed');
  }

  async function runLiveUp(target) {
    setStatus('Live');
    setOutput(`> live up ${target.label} ${target.keys.join(' ')}\n`);
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up', dryRun, noDelete, targetIds: target.keys })
    });
    const data = await response.json();
    setOutput((old) => `${old}${data.output || data.error || ''}\nExit code: ${data.exitCode ?? 1}`);
    setStatus((data.exitCode ?? 1) === 0 ? 'Live' : 'Failed');
  }

  async function checkForUpdates(manual = true) {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const response = await fetch('/api/update');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check for updates.');

      if (!data.updateAvailable) {
        if (manual) setOutput(`Sync GUI is up to date (${data.currentVersion}).`);
        return;
      }

      const target = data.assetName || 'the latest release';
      const message = `Sync GUI ${data.latestVersion} is available.\n\nDownload ${target}?`;
      if (confirm(message)) {
        window.open(data.downloadUrl || data.releaseUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      if (manual) setOutput(error.message);
    } finally {
      setCheckingUpdate(false);
    }
  }

  function toggleLiveCategory(id) {
    setLiveCategoryIds((oldIds) => (
      oldIds.includes(id)
        ? oldIds.filter((item) => item !== id)
        : [...oldIds, id]
    ));
  }

  function openProject(item = null) {
    setModal({
      kind: 'project',
      title: item ? 'Edit project' : 'Add project',
      originalId: item?.id || '',
      value: item ? pickProject(item) : { ...blankProject, id: uniqueId(config.projects, 'project'), label: 'New project', root: 'new-project' }
    });
  }

  function openRemote(item = null) {
    setModal({
      kind: 'remote',
      title: item ? 'Edit remote' : 'Add remote',
      originalId: item?.id || '',
      value: item ? pickRemote(item) : { ...blankRemote, id: uniqueId(config.remotes || [], 'remote'), label: 'New remote' }
    });
  }

  function openProjectRemotes() {
    if (!project) return;
    setModal({
      kind: 'projectRemotes',
      title: 'Pick remotes',
      projectId: project.id,
      value: { remoteIds: project.remotes.map((item) => item.id) }
    });
  }

  function openProjectRemote(item = null) {
    if (!project) return;
    const firstGlobalRemoteId = (config.remotes || [])[0]?.id || '';
    setModal({
      kind: 'projectRemote',
      title: item ? 'Edit project remote' : 'Add project remote',
      projectId: project.id,
      originalId: item?.id || '',
      globalRemoteIds: (config.remotes || []).map((remote) => remote.id),
      value: item
        ? pickProjectRemote(item)
        : { id: uniqueId(project.remotes, 'remote'), label: 'New remote', remoteId: firstGlobalRemoteId }
    });
  }

  function openCategory(item = null) {
    if (!project || !remote) return;
    setModal({
      kind: 'category',
      title: item ? 'Edit category' : 'Add category',
      projectId: project.id,
      remoteId: remote.id,
      originalId: item?.id || '',
      value: item ? pickCategory(item) : { ...blankCategory, id: uniqueId(remote.categories, 'category'), label: 'New category' }
    });
  }

  function openStream(item = null) {
    if (!project) return;
    setModal({
      kind: 'stream',
      title: item ? 'Edit stream' : 'Add stream',
      projectId: project.id,
      originalId: item?.id || '',
      value: item ? pickStream(item) : { id: uniqueId(project.streams || [], 'stream'), label: 'New stream', categories: [] }
    });
  }

  function openStreamCategory(item = null) {
    if (!project || !stream) return;
    setModal({
      kind: 'streamCategory',
      title: item ? 'Edit category' : 'Add category',
      projectId: project.id,
      streamId: stream.id,
      originalId: item?.id || '',
      value: item ? pickCategory(item) : { ...blankCategory, id: uniqueId(stream.categories || [], 'category'), label: 'New category' }
    });
  }

  function openStreamMapping(category, mapping = null, type = null) {
    if (!project || !stream) return;
    const defaultRemoteId = mapping?.remoteId || projectRemotes[0]?.id || '';
    const base = mapping
      ? { ...mapping, remoteId: defaultRemoteId }
      : { ...blankMapping, id: uniqueId(category.mappings, 'mapping'), label: 'New mapping', remoteId: defaultRemoteId };
    const value = type && !mapping ? { ...base, type } : base;
    const isNewCategory = !(stream.categories || []).find((c) => c.id === category.id);
    setModal({
      kind: 'streamMapping',
      title: mapping ? 'Edit file/folder' : type === 'file' ? 'Add file mapping' : type === 'dir' ? 'Add folder mapping' : 'Add file/folder',
      projectId: project.id,
      streamId: stream.id,
      categoryId: category.id,
      originalId: mapping?.id || '',
      newCategory: isNewCategory ? category : undefined,
      projectRemoteIds: projectRemotes.map((item) => item.id),
      projectRemoteOptions: projectRemotes.map((item) => ({ id: item.id, label: item.label || item.id })),
      remoteKinds: Object.fromEntries(projectRemotes.map((item) => [item.id, getRemoteKind(item)])),
      value
    });
  }

  function openMapping(category, mapping = null, type = null) {
    if (!project || !remote) return;
    const base = mapping ? { ...mapping } : { ...blankMapping, id: uniqueId(category.mappings, 'mapping'), label: 'New mapping' };
    const value = type && !mapping ? { ...base, type } : base;
    const isNewCategory = !remote.categories.find((c) => c.id === category.id);
    setModal({
      kind: 'mapping',
      title: mapping ? 'Edit file/folder' : type === 'file' ? 'Add file mapping' : type === 'dir' ? 'Add folder mapping' : 'Add file/folder',
      projectId: project.id,
      remoteId: remote.id,
      remoteKind: getRemoteKind(remote),
      categoryId: category.id,
      originalId: mapping?.id || '',
      newCategory: isNewCategory ? category : undefined,
      value
    });
  }

  function applyModal() {
    if (!modal) return;
    const value = cleanValue(modal.value);

    try {
      validateModalValue(modal.kind, value, modal);
    } catch (error) {
      setOutput(error.message);
      return;
    }

    mutate((next) => {
      if (modal.kind === 'project') {
        if (modal.originalId) {
          const item = next.projects.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
        } else {
          next.projects.push({ ...value, remotes: [], streams: [] });
        }
        setProjectId(value.id);
        return;
      }

      if (modal.kind === 'remote') {
        if (!Array.isArray(next.remotes)) next.remotes = [];
        if (modal.originalId) {
          const item = next.remotes.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
          if (modal.originalId !== value.id) {
            for (const nextProject of next.projects) {
              for (const projectRemote of nextProject.remotes) {
                if (projectRemote.remoteId === modal.originalId) projectRemote.remoteId = value.id;
                if (!projectRemote.remoteId && projectRemote.id === modal.originalId) projectRemote.remoteId = value.id;
              }
            }
          }
        } else {
          next.remotes.push(value);
        }
        setRemoteId(value.id);
        return;
      }

      const nextProject = next.projects.find((entry) => entry.id === modal.projectId);
      if (modal.kind === 'stream') {
        if (!Array.isArray(nextProject.streams)) nextProject.streams = [];
        if (modal.originalId) {
          const item = nextProject.streams.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value, { categories: item.categories || [] });
          if (modal.originalId !== value.id && streamId === modal.originalId) setStreamId(value.id);
        } else {
          nextProject.streams.push({ ...value, categories: [] });
          setStreamId(value.id);
        }
        return;
      }

      if (modal.kind === 'projectRemote') {
        if (modal.originalId) {
          const item = nextProject.remotes.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value, { categories: item.categories || [] });
          if (modal.originalId !== value.id && remoteId === modal.originalId) setRemoteId(value.id);
        } else {
          nextProject.remotes.push({ ...value, categories: [] });
          setRemoteId(value.id);
        }
        return;
      }

      if (modal.kind === 'projectRemotes') {
        const selectedIds = new Set(value.remoteIds || []);
        nextProject.remotes = [
          ...nextProject.remotes.filter((entry) => selectedIds.has(entry.id)),
          ...(value.remoteIds || [])
            .filter((id) => !nextProject.remotes.some((entry) => entry.id === id))
            .map((id) => ({ id, categories: [] }))
        ];
        if (remoteId && !selectedIds.has(remoteId)) {
          setRemoteId('');
          setCategoryPath([]);
        }
        setLiveCategoryIds((oldIds) => oldIds.filter((id) => !id.startsWith(`${nextProject.id}/`) || selectedIds.has(id.split('/')[1])));
        return;
      }

      const nextRemote = nextProject.remotes.find((entry) => entry.id === modal.remoteId);
      const nextStream = (nextProject.streams || []).find((entry) => entry.id === modal.streamId);
      if (modal.kind === 'category') {
        if (modal.originalId) {
          const item = nextRemote.categories.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
        } else {
          nextRemote.categories.push({ ...value, mappings: [] });
        }
        return;
      }

      if (modal.kind === 'streamCategory') {
        if (modal.originalId) {
          const item = nextStream.categories.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
        } else {
          nextStream.categories.push({ ...value, mappings: [] });
        }
        return;
      }

      if (modal.kind === 'mapping') {
        let category = nextRemote.categories.find((entry) => entry.id === modal.categoryId);
        if (!category && modal.newCategory) {
          category = { ...modal.newCategory, mappings: [] };
          nextRemote.categories.push(category);
        }
        if (modal.originalId) {
          const item = category.mappings.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
        } else {
          category.mappings.push(value);
        }
      }

      if (modal.kind === 'streamMapping') {
        let category = nextStream.categories.find((entry) => entry.id === modal.categoryId);
        if (!category && modal.newCategory) {
          category = { ...modal.newCategory, mappings: [] };
          nextStream.categories.push(category);
        }
        if (modal.originalId) {
          const item = category.mappings.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
        } else {
          category.mappings.push(value);
        }
      }
    });
    setModal(null);
  }

  function deleteProject(item) {
    if (!confirm(`Delete project "${item.label || item.id}"?`)) return;
    mutate((next) => {
      next.projects = next.projects.filter((entry) => entry.id !== item.id);
    });
    setProjectId('');
    setRemoteId('');
    setStreamId('');
  }

  function deleteRemote(item) {
    if (!project || !confirm(`Remove remote "${item.label || item.id}" from this project?`)) return;
    mutate((next) => {
      const nextProject = next.projects.find((entry) => entry.id === project.id);
      nextProject.remotes = nextProject.remotes.filter((entry) => entry.id !== item.id);
    });
    setRemoteId('');
    setCategoryPath([]);
  }

  function deleteGlobalRemote(item) {
    if (!confirm(`Delete global remote "${item.label || item.id}"?`)) return;
    mutate((next) => {
      next.remotes = (next.remotes || []).filter((entry) => entry.id !== item.id);
      for (const nextProject of next.projects) {
        nextProject.remotes = nextProject.remotes.filter((entry) => (entry.remoteId || entry.id) !== item.id);
      }
    });
    if (remote && (remote.remoteId || remote.id) === item.id) {
      setRemoteId('');
      setCategoryPath([]);
    }
  }

  function deleteStream(item) {
    if (!project || !confirm(`Delete stream "${item.label || item.id}"?`)) return;
    mutate((next) => {
      const nextProject = next.projects.find((entry) => entry.id === project.id);
      nextProject.streams = (nextProject.streams || []).filter((entry) => entry.id !== item.id);
    });
    setStreamId('');
    setCategoryPath([]);
  }

  function deleteCategory(item) {
    if (!project || !remote || !confirm(`Delete category "${item.label || item.id}"?`)) return;
    mutate((next) => {
      const nextRemote = getRemote(next, project.id, remote.id);
      nextRemote.categories = nextRemote.categories.filter((entry) => entry.id !== item.id);
    });
    if (categoryPath.includes(item.id)) {
      setCategoryPath(categoryPath.slice(0, categoryPath.indexOf(item.id)));
    }
  }

  function deleteMapping(category, mapping) {
    if (!project || !remote || !confirm(`Delete mapping "${mapping.label || mapping.id}"?`)) return;
    mutate((next) => {
      const nextCategory = getCategory(next, project.id, remote.id, category.id);
      nextCategory.mappings = nextCategory.mappings.filter((entry) => entry.id !== mapping.id);
    });
  }

  function deleteStreamCategory(item) {
    if (!project || !stream || !confirm(`Delete category "${item.label || item.id}"?`)) return;
    mutate((next) => {
      const nextStream = getStream(next, project.id, stream.id);
      nextStream.categories = nextStream.categories.filter((entry) => entry.id !== item.id);
    });
    if (categoryPath.includes(item.id)) {
      setCategoryPath(categoryPath.slice(0, categoryPath.indexOf(item.id)));
    }
  }

  function deleteStreamMapping(category, mapping) {
    if (!project || !stream || !confirm(`Delete mapping "${mapping.label || mapping.id}"?`)) return;
    mutate((next) => {
      const nextCategory = getStreamCategory(next, project.id, stream.id, category.id);
      nextCategory.mappings = nextCategory.mappings.filter((entry) => entry.id !== mapping.id);
    });
  }

  function mergeCategory(sourceId, targetId) {
    if (!project || !remote || sourceId === targetId) return;

    mutate((next) => {
      const nextRemote = getRemote(next, project.id, remote.id);
      const source = nextRemote.categories.find((entry) => entry.id === sourceId);
      const target = nextRemote.categories.find((entry) => entry.id === targetId);
      if (!source || !target) return;

      const id = uniqueId(target.categories, source.id);
      target.categories.push(id === source.id ? source : { ...source, id });
      nextRemote.categories = nextRemote.categories.filter((entry) => entry.id !== sourceId);
    });

    setDragCategoryId('');
    setOutput(`Moved category "${sourceId}" inside "${targetId}". Save config when it looks right.`);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Sync Control</h1>
          <nav className="crumbs">
            <button onClick={() => { setProjectId(''); setRemoteId(''); setStreamId(''); setCategoryPath([]); }}>Projects</button>
            {project && <button onClick={() => { setRemoteId(''); setStreamId(''); setCategoryPath([]); }}>{project.label || project.id}</button>}
            {remote && categoryPath.length === 0 && <span>{remote.label || remote.id}</span>}
            {stream && categoryPath.length === 0 && <span>{stream.label || stream.id}</span>}
            {remote && categoryPath.length > 0 && (
              <>
                <button onClick={() => setCategoryPath([])}>{remote.label || remote.id}</button>
                {(() => {
                  const { ancestors } = resolveCategoryPath(remote.categories, categoryPath);
                  return ancestors.map((cat, i) => {
                    const isLast = i === ancestors.length - 1;
                    return isLast ? (
                      <span key={cat.id}>{cat.label || cat.id}</span>
                    ) : (
                      <button key={cat.id} onClick={() => setCategoryPath(categoryPath.slice(0, i + 1))}>
                        {cat.label || cat.id}
                      </button>
                    );
                  });
                })()}
              </>
            )}
            {stream && categoryPath.length > 0 && (
              <>
                <button onClick={() => setCategoryPath([])}>{stream.label || stream.id}</button>
                {(() => {
                  const { ancestors } = resolveCategoryPath(stream.categories || [], categoryPath);
                  return ancestors.map((cat, i) => {
                    const isLast = i === ancestors.length - 1;
                    return isLast ? (
                      <span key={cat.id}>{cat.label || cat.id}</span>
                    ) : (
                      <button key={cat.id} onClick={() => setCategoryPath(categoryPath.slice(0, i + 1))}>
                        {cat.label || cat.id}
                      </button>
                    );
                  });
                })()}
              </>
            )}
          </nav>
        </div>
        <div className="top-actions">
          {view !== 'projects' && (
            <div className="toggles">
              <label><input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> Dry run</label>
              <label><input type="checkbox" checked={noDelete} onChange={(event) => setNoDelete(event.target.checked)} /> No delete</label>
              {liveCategoryIds.length > 0 && <span>{liveCategoryIds.length} live</span>}
            </div>
          )}
          <span className={`status ${status.toLowerCase()}`}>{dirty ? `${status} - unsaved` : status}</span>
          <button onClick={() => checkForUpdates(true)} disabled={checkingUpdate}>
            {checkingUpdate ? 'Checking...' : 'Check updates'}
          </button>
          <button onClick={loadConfig}>Reload</button>
          <button className="primary" onClick={() => saveConfig()}>Save</button>
        </div>
      </header>

      {view === 'projects' && (
        <>
          <CardStage title="Projects">
            {config.projects.map((item) => (
              <ProjectCard
                key={item.id}
                project={item}
                remotes={getProjectRemotes(config, item)}
                onOpen={() => setProjectId(item.id)}
                onEdit={() => openProject(item)}
                onDelete={() => deleteProject(item)}
              />
            ))}
            <AddCard label="Add project" onClick={() => openProject()} />
          </CardStage>

          <CardStage title="Global remotes">
            {(config.remotes || []).map((item) => (
              <RemoteCard
                key={item.id}
                remote={{ ...item, categories: [] }}
                onOpen={() => openRemote(item)}
                onEdit={() => openRemote(item)}
                onDelete={() => deleteGlobalRemote(item)}
              />
            ))}
            <AddCard label="Add remote" onClick={() => openRemote()} />
          </CardStage>
        </>
      )}

      {view === 'remotes' && project && (
        <>
          <CardStage title={`${project.label || project.id} remotes`}>
            {projectRemotes.map((item) => (
              <RemoteCard
                key={item.id}
                remote={item}
                onOpen={() => { setStreamId(''); setRemoteId(item.id); }}
                onEdit={() => openProjectRemote(item)}
                onDelete={() => deleteRemote(item)}
                onUp={() => runKeys(remoteKeys(project, item), 'up')}
                onDown={() => runKeys(remoteKeys(project, item), 'down')}
              />
            ))}
            <AddCard label="Add remote" onClick={() => openProjectRemote()} />
          </CardStage>

          <CardStage title="Project streams">
            {(project.streams || []).map((item) => (
              <StreamCard
                key={item.id}
                stream={item}
                onOpen={() => { setRemoteId(''); setStreamId(item.id); }}
                onEdit={() => openStream(item)}
                onDelete={() => deleteStream(item)}
                onUp={() => runKeys(streamKeys(project, projectRemotes, item), 'up')}
                onDown={() => runKeys(streamKeys(project, projectRemotes, item), 'down')}
              />
            ))}
            <AddCard label="Add stream" onClick={() => openStream()} />
          </CardStage>
        </>
      )}

      {view === 'categories' && project && remote && (() => {
        const { current: currentCategory, ancestors } = resolveCategoryPath(remote.categories, categoryPath);
        const displayCategories = currentCategory ? (currentCategory.categories || []) : remote.categories;
        const displayMappings = currentCategory ? (currentCategory.mappings || []) : [];
        const categoryPathPrefix = categoryPath;

        return (
          <CardStage
            title={currentCategory ? (currentCategory.label || currentCategory.id) : `${remote.label || remote.id} files and folders`}
          >
            {currentCategory && currentCategory.mappings.map((mapping) => (
              <MappingCard
                key={mapping.id}
                mapping={mapping}
                category={currentCategory}
                categoryPathPrefix={categoryPathPrefix}
                project={project}
                remote={remote}
                onEdit={() => openMapping(currentCategory, mapping)}
                onDelete={() => deleteMapping(currentCategory, mapping)}
                onUp={() => runKeys([mappingKey(project, remote, categoryPathPrefix, mapping)], 'up')}
                onDown={() => runKeys([mappingKey(project, remote, categoryPathPrefix, mapping)], 'down')}
              />
            ))}
            {displayCategories.map((category) => (
              (() => {
                const nextCategoryPath = [...categoryPathPrefix, category.id];
                const liveId = categoryLiveKey(project, remote, nextCategoryPath);
                const isLive = liveCategoryIds.includes(liveId);
                return (
              <CategoryCard
                key={category.id}
                project={project}
                remote={remote}
                category={category}
                isLive={isLive}
                onOpen={() => setCategoryPath(nextCategoryPath)}
                onEdit={() => openCategory(category)}
                onDelete={() => deleteCategory(category)}
                onAddFileMapping={() => openMapping(category, null, 'file')}
                onAddFolderMapping={() => openMapping(category, null, 'dir')}
                onEditMapping={(mapping) => openMapping(category, mapping)}
                onDeleteMapping={(mapping) => deleteMapping(category, mapping)}
                onUp={() => runKeys(categoryKeys(project, remote, category, nextCategoryPath), 'up')}
                onDown={() => runKeys(categoryKeys(project, remote, category, nextCategoryPath), 'down')}
                onToggleLive={() => toggleLiveCategory(liveId)}
                onMappingUp={(mapping) => runKeys([mappingKey(project, remote, nextCategoryPath, mapping)], 'up')}
                onMappingDown={(mapping) => runKeys([mappingKey(project, remote, nextCategoryPath, mapping)], 'down')}
                dragCategoryId={dragCategoryId}
                onDragStart={() => setDragCategoryId(category.id)}
                onDragEnd={() => setDragCategoryId('')}
                onDropCategory={(sourceId) => mergeCategory(sourceId, category.id)}
              />
                );
              })()
            ))}
            <AddCard
              label="Add category"
              onClick={() => openCategory()}
            />
            <button className="card add-card add-mapping-card" onClick={() => {
              const cat = currentCategory || { ...blankCategory, id: uniqueId(remote.categories, 'category'), label: 'New category', mappings: [] };
              openMapping(cat, null, 'file');
            }}>
              <span>+</span>
              <strong>Add file mapping</strong>
            </button>
            <button className="card add-card add-mapping-card" onClick={() => {
              const cat = currentCategory || { ...blankCategory, id: uniqueId(remote.categories, 'category'), label: 'New category', mappings: [] };
              openMapping(cat, null, 'dir');
            }}>
              <span>+</span>
              <strong>Add folder mapping</strong>
            </button>
          </CardStage>
        );
      })()}

      {view === 'streamCategories' && project && stream && (() => {
        const { current: currentCategory } = resolveCategoryPath(stream.categories || [], categoryPath);
        const displayCategories = currentCategory ? (currentCategory.categories || []) : (stream.categories || []);
        const categoryPathPrefix = categoryPath;

        return (
          <CardStage
            title={currentCategory ? (currentCategory.label || currentCategory.id) : `${stream.label || stream.id} stream`}
          >
            {currentCategory && currentCategory.mappings.map((mapping) => (
              <MappingCard
                key={mapping.id}
                mapping={mapping}
                category={currentCategory}
                categoryPathPrefix={categoryPathPrefix}
                project={project}
                remote={projectRemotes.find((item) => item.id === mapping.remoteId)}
                onEdit={() => openStreamMapping(currentCategory, mapping)}
                onDelete={() => deleteStreamMapping(currentCategory, mapping)}
                onUp={() => runKeys([streamMappingKey(project, stream, categoryPathPrefix, mapping)], 'up')}
                onDown={() => runKeys([streamMappingKey(project, stream, categoryPathPrefix, mapping)], 'down')}
              />
            ))}
            {displayCategories.map((category) => {
              const nextCategoryPath = [...categoryPathPrefix, category.id];
              const liveId = streamCategoryLiveKey(project, stream, nextCategoryPath);
              const isLive = liveCategoryIds.includes(liveId);
              return (
                <CategoryCard
                  key={category.id}
                  project={project}
                  remote={projectRemotes.find((item) => item.id === category.mappings[0]?.remoteId) || projectRemotes[0]}
                  category={category}
                  isLive={isLive}
                  onOpen={() => setCategoryPath(nextCategoryPath)}
                  onEdit={() => openStreamCategory(category)}
                  onDelete={() => deleteStreamCategory(category)}
                  onAddFileMapping={() => openStreamMapping(category, null, 'file')}
                  onAddFolderMapping={() => openStreamMapping(category, null, 'dir')}
                  onEditMapping={(mapping) => openStreamMapping(category, mapping)}
                  onDeleteMapping={(mapping) => deleteStreamMapping(category, mapping)}
                  onUp={() => runKeys(streamCategoryKeys(project, stream, category, nextCategoryPath), 'up')}
                  onDown={() => runKeys(streamCategoryKeys(project, stream, category, nextCategoryPath), 'down')}
                  onToggleLive={() => toggleLiveCategory(liveId)}
                  onMappingUp={(mapping) => runKeys([streamMappingKey(project, stream, nextCategoryPath, mapping)], 'up')}
                  onMappingDown={(mapping) => runKeys([streamMappingKey(project, stream, nextCategoryPath, mapping)], 'down')}
                  dragCategoryId={dragCategoryId}
                  onDragStart={() => setDragCategoryId(category.id)}
                  onDragEnd={() => setDragCategoryId('')}
                  onDropCategory={() => setOutput('Moving stream categories is only supported at the current level for now.')}
                />
              );
            })}
            <AddCard
              label="Add category"
              onClick={() => openStreamCategory()}
            />
            <button className="card add-card add-mapping-card" onClick={() => {
              const cat = currentCategory || { ...blankCategory, id: uniqueId(stream.categories || [], 'category'), label: 'New category', mappings: [] };
              openStreamMapping(cat, null, 'file');
            }}>
              <span>+</span>
              <strong>Add file mapping</strong>
            </button>
            <button className="card add-card add-mapping-card" onClick={() => {
              const cat = currentCategory || { ...blankCategory, id: uniqueId(stream.categories || [], 'category'), label: 'New category', mappings: [] };
              openStreamMapping(cat, null, 'dir');
            }}>
              <span>+</span>
              <strong>Add folder mapping</strong>
            </button>
          </CardStage>
        );
      })()}

      {(view !== 'projects' || output) && (
        <section className="console-panel">
          <pre>{output || 'Output will appear here.'}</pre>
        </section>
      )}

      {modal && (
        <EditorModal
          modal={modal}
          setModal={setModal}
          onApply={applyModal}
          projectRoot={project?.root || '.'}
          globalRemotes={config.remotes || []}
        />
      )}
    </main>
  );
}

function CardStage({ title, children, actions }) {
  return (
    <section className="stage">
      <div className="stage-title">
        <h2>{title}</h2>
        {actions && <div className="stage-actions">{actions}</div>}
      </div>
      <div className="card-grid">{children}</div>
    </section>
  );
}

function ProjectCard({ project, remotes, onOpen, onEdit, onDelete }) {
  const remoteCount = remotes.length;
  const mappingCount = remotes.flatMap((remote) => remote.categories).flatMap((category) => category.mappings).length;
  return (
    <article className="card project-card" onClick={onOpen}>
      <div className="card-main">
        <h3>{project.label || project.id}</h3>
        <p>{project.root}</p>
      </div>
      <div className="stats">
        <span>{remoteCount} remotes</span>
        <span>{mappingCount} mappings</span>
      </div>
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}

function RemoteCard({ remote, onOpen, onEdit, onDelete, onUp, onDown }) {
  const categoryCount = remote.categories.length;
  const mappingCount = remote.categories.flatMap((category) => category.mappings).length;
  return (
    <article className="card remote-card" onClick={onOpen}>
      <div className="card-main">
        <h3>{remote.label || remote.id}</h3>
        <p>{remoteSummary(remote)}</p>
      </div>
      <div className="stats">
        <span>{categoryCount} categories</span>
        <span>{mappingCount} mappings</span>
      </div>
      {onUp && onDown && <SyncTools onUp={onUp} onDown={onDown} />}
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}

function StreamCard({ stream, onOpen, onEdit, onDelete, onUp, onDown }) {
  const categoryCount = (stream.categories || []).length;
  const mappingCount = collectCategoryMappings(stream.categories || []).length;
  return (
    <article className="card remote-card" onClick={onOpen}>
      <div className="card-main">
        <h3>{stream.label || stream.id}</h3>
        <p>Project stream</p>
      </div>
      <div className="stats">
        <span>{categoryCount} categories</span>
        <span>{mappingCount} mappings</span>
      </div>
      <SyncTools onUp={onUp} onDown={onDown} />
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}

function MappingCard({ mapping, category, categoryPathPrefix, project, remote, onEdit, onDelete, onUp, onDown }) {
  const isFile = mapping.type === 'file';
  const remoteLabel = mapping.remoteId ? `${remote?.label || mapping.remoteId}: ` : '';
  return (
    <article className={`card mapping-card ${isFile ? 'mapping-file' : 'mapping-folder'}`}>
      <div className="mapping-card-head">
        <span className={`mapping-type-badge ${isFile ? 'badge-file' : 'badge-folder'}`}>{isFile ? 'FILE' : 'FOLDER'}</span>
        <h3>{mapping.label || mapping.id}</h3>
        <small className="mapping-paths" title={`${mapping.local} -> ${mapping.remote}`}>
          <span className="path-local">{mapping.local}</span>
          <span className="path-arrow">{'\u2192'}</span>
          <span className="path-remote">{remoteLabel}{mapping.remote}</span>
        </small>
      </div>
      <SyncTools onUp={onUp} onDown={onDown} />
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}

function CategoryCard({
  project,
  remote,
  category,
  isLive,
  onOpen,
  onEdit,
  onDelete,
  onAddFileMapping,
  onAddFolderMapping,
  onEditMapping,
  onDeleteMapping,
  onUp,
  onDown,
  onToggleLive,
  onMappingUp,
  onMappingDown,
  dragCategoryId,
  onDragStart,
  onDragEnd,
  onDropCategory
}) {
  const isDragging = dragCategoryId === category.id;
  const isDropTarget = dragCategoryId && dragCategoryId !== category.id;

  return (
    <article
      className={`card category-card ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
      draggable
      onDoubleClick={(event) => {
        if (event.target.closest('button') || event.target.closest('.sync-tools') || event.target.closest('.mapping-list')) return;
        onOpen();
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', category.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!isDropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = event.dataTransfer.getData('text/plain');
        onDropCategory(sourceId);
      }}
    >
      <div className="category-head">
        <div>
          <span className="mapping-type-badge badge-category">CATEGORY</span>
          <h3>{category.label || category.id}</h3>
          <p>{category.mappings.length} mapping{category.mappings.length === 1 ? '' : 's'}{category.categories.length > 0 ? `, ${category.categories.length} sub${category.categories.length === 1 ? '' : ''}` : ''}</p>
        </div>
      </div>
      <SyncTools onUp={onUp} onDown={onDown} />
      <button
        className={`live-toggle ${isLive ? 'active' : ''}`}
        title={isLive ? 'Stop live up sync' : 'Live up sync every 5 seconds'}
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleLive();
        }}
      >
        LIVE
      </button>
      <div className="mapping-list">
        {category.mappings.map((mapping) => (
          <div className="mapping-row" key={mapping.id}>
            <button className="mapping-name" onDoubleClick={(event) => {
              event.stopPropagation();
              onEditMapping(mapping);
            }}>
              <strong>{mapping.label || mapping.id}</strong>
              <span>{mapping.type}</span>
              <small title={`${mapping.local} -> ${mapping.remote}`}>{mapping.local}{' -> '}{mapping.remoteId ? `${mapping.remoteId}:` : ''}{mapping.remote}</small>
            </button>
            <button className="btn-up" title="Sync up" onClick={() => onMappingUp(mapping)}>↑</button>
            <button className="btn-down" title="Sync down" onClick={() => onMappingDown(mapping)}>↓</button>
            <button title="Delete" className="danger" onClick={() => onDeleteMapping(mapping)}>×</button>
          </div>
        ))}
      </div>
      <div className="category-actions">
        <button onClick={onAddFileMapping}>+ file</button>
        <button onClick={onAddFolderMapping}>+ folder</button>
      </div>
      <button
        className="settings-icon"
        title="Edit category"
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        {'\u2699'}
      </button>
      <button
        className="delete-icon"
        title="Delete category"
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </article>
  );
}

function AddCard({ label, onClick }) {
  return (
    <button className="card add-card" onClick={onClick}>
      <span>+</span>
      <strong>{label}</strong>
    </button>
  );
}

function SyncTools({ onUp, onDown }) {
  return (
    <div className="sync-tools" onClick={(event) => event.stopPropagation()}>
      <button className="btn-up" title="Sync up" onClick={onUp}>↑</button>
      <button className="btn-down" title="Sync down" onClick={onDown}>↓</button>
    </div>
  );
}

function CardTools({ onEdit, onDelete }) {
  return (
    <div className="card-tools" onClick={(event) => event.stopPropagation()}>
      <button className="settings-icon" title="Edit" onClick={onEdit}>{'\u2699'}</button>
      <button className="delete-icon" title="Delete" onClick={onDelete}>×</button>
    </div>
  );
}

function FolderPicker({ root, currentPath, onSelect, onClose }) {
  const [cwd, setCwd] = useState(root || '.');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/browse?path=${encodeURIComponent(cwd)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setOutput(data.error);
          setFolders([]);
        } else {
          setCwd(data.path);
          setFolders(data.folders);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setFolders([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [cwd]);

  const parent = cwd.split(/[/\\]/).slice(0, -1).join('/') || '/';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal folder-picker-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Browse folders</h2>
          <button onClick={onClose}>{'\u00d7'}</button>
        </header>
        <div className="folder-picker-body">
          <div className="folder-picker-path">
            <span className="folder-picker-cwd">{cwd}</span>
          </div>
          <div className="folder-picker-list">
            <button className="folder-picker-item folder-picker-parent" onClick={() => setCwd(parent)}>
              <span className="folder-glyph">{'\u2191'}</span>
              <strong>..</strong>
            </button>
            {loading && <p className="folder-empty">Loading...</p>}
            {!loading && folders.length === 0 && <p className="folder-empty">No subfolders</p>}
            {!loading && folders.map((name) => (
              <button key={name} className="folder-picker-item" onClick={() => setCwd(`${cwd}/${name}`)}>
                <span className="folder-glyph">{'\u25a1'}</span>
                <strong>{name}</strong>
              </button>
            ))}
          </div>
        </div>
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => { onSelect(cwd); onClose(); }}>Select this folder</button>
        </footer>
      </section>
    </div>
  );
}

function EditorModal({ modal, setModal, onApply, projectRoot, globalRemotes }) {
  const value = modal.value;
  const [browsing, setBrowsing] = useState(false);

  const update = (field, fieldValue) => {
    const next = { ...value, [field]: fieldValue };
    if (field === 'label') {
      next.id = fieldValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    setModal({ ...modal, value: next });
  };

  const updateRemoteSelection = (remoteId, checked) => {
    const current = new Set(value.remoteIds || []);
    if (checked) {
      current.add(remoteId);
    } else {
      current.delete(remoteId);
    }
    setModal({ ...modal, value: { ...value, remoteIds: [...current] } });
  };

  const pickLocalPath = async () => {
    setBrowsing(true);
    try {
      const response = await fetch(`/api/browse?type=${encodeURIComponent(value.type || 'dir')}`);
      const data = await response.json();
      if (response.ok && data.path) update('local', data.path);
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header>
          <h2>{modal.title}</h2>
          <button onClick={() => setModal(null)}>×</button>
        </header>
        <div className="form">
          {modal.kind !== 'projectRemotes' && (
            <Field label="Label" value={value.label || ''} onChange={(next) => update('label', next)} />
          )}
          {modal.kind === 'project' && (
            <Field label="Root folder" value={value.root} onChange={(next) => update('root', next)} />
          )}
          {modal.kind === 'projectRemote' && (
            <label>
              Remote
              <select value={value.remoteId || ''} onChange={(event) => update('remoteId', event.target.value)}>
                <option value="" disabled>Select remote</option>
                {globalRemotes.map((remote) => (
                  <option value={remote.id} key={remote.id}>
                    {remote.label || remote.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {modal.kind === 'projectRemotes' && (
            <div className="remote-picker-list">
              {globalRemotes.map((remote) => (
                <label className="remote-picker-item" key={remote.id}>
                  <input
                    type="checkbox"
                    checked={(value.remoteIds || []).includes(remote.id)}
                    onChange={(event) => updateRemoteSelection(remote.id, event.target.checked)}
                  />
                  <span>{remote.label || remote.id}</span>
                </label>
              ))}
              {globalRemotes.length === 0 && <p className="folder-empty">No global remotes</p>}
            </div>
          )}
          {modal.kind === 'remote' && (
            <>
              <label>
                Connection
                <select value={getRemoteKind(value)} onChange={(event) => update('kind', event.target.value)}>
                  <option value="ssh">server over SSH</option>
                  <option value="share">network share / UNC</option>
                  <option value="local">local folder</option>
                </select>
              </label>
              {getRemoteKind(value) === 'ssh' ? (
                <>
                  <Field label="Host / IP" value={value.host || ''} onChange={(next) => update('host', next)} />
                  <Field label="Port" value={value.port || ''} onChange={(next) => update('port', next)} />
                  <Field label="Username" value={value.username || ''} onChange={(next) => update('username', next)} />
                  <Field label="Password" type="password" value={value.password || ''} onChange={(next) => update('password', next)} />
                </>
              ) : (
                <Field
                  label={getRemoteKind(value) === 'share' ? 'UNC root path' : 'Root folder'}
                  value={value.root || ''}
                  onChange={(next) => update('root', next)}
                />
              )}
            </>
          )}
          {(modal.kind === 'category' || modal.kind === 'streamCategory') && null}
          {(modal.kind === 'mapping' || modal.kind === 'streamMapping') && (
            <>
              {modal.kind === 'streamMapping' && (
                <label>
                  Remote
                  <select value={value.remoteId || ''} onChange={(event) => update('remoteId', event.target.value)}>
                    <option value="" disabled>Select remote</option>
                    {(modal.projectRemoteOptions || []).map((remote) => (
                        <option value={remote.id} key={remote.id}>
                          {remote.label || remote.id}
                        </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field-with-button">
                Local path
                <div className="field-row">
                  <input value={value.local} onChange={(event) => update('local', event.target.value)} />
                  <button
                    type="button"
                    className="browse-btn"
                    onClick={pickLocalPath}
                    disabled={browsing}
                    title={value.type === 'file' ? 'Select file' : 'Select folder'}
                  >
                    {'\u2261'}
                  </button>
                </div>
              </label>
              <Field
                label={(modal.remoteKinds?.[value.remoteId] || modal.remoteKind || 'ssh') === 'ssh' ? 'Remote path' : 'Remote path under root'}
                value={value.remote}
                onChange={(next) => update('remote', next)}
              />
            </>
          )}
        </div>
        <footer>
          <button onClick={() => setModal(null)}>Cancel</button>
          <button className="primary" onClick={onApply}>Apply</button>
        </footer>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label>
      {label}
      <input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function pickProject(project) {
  return { id: project.id, label: project.label || '', root: project.root, remotes: project.remotes, streams: project.streams || [] };
}

function pickRemote(remote) {
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

function pickProjectRemote(remote) {
  return {
    id: remote.id,
    label: remote.label || '',
    remoteId: remote.remoteId || remote.id
  };
}

function pickCategory(category) {
  return {
    id: category.id,
    label: category.label || '',
    categories: category.categories || [],
    mappings: category.mappings || []
  };
}

function pickStream(stream) {
  return {
    id: stream.id,
    label: stream.label || '',
    categories: stream.categories || []
  };
}

function cleanValue(value) {
  const next = { ...value };
  for (const key of Object.keys(next)) {
    if (typeof next[key] === 'string') next[key] = next[key].trim();
  }
  return next;
}

function validateModalValue(kind, value, modal = {}) {
  if (!/^[A-Za-z0-9._-]+$/.test(value.id || '')) throw new Error('Id can use letters, numbers, dot, dash, and underscore.');
  if (kind === 'project' && !value.root) throw new Error('Project root is required.');
  if (kind === 'remote') {
    const remoteKind = getRemoteKind(value);
    if (!['ssh', 'share', 'local'].includes(remoteKind)) throw new Error('Connection must be SSH, network share, or local folder.');
    if (remoteKind !== 'ssh' && !value.root) throw new Error('Remote root path is required.');
  }
  if (kind === 'projectRemote') {
    if (!value.remoteId) throw new Error('Remote is required.');
    if (modal.globalRemoteIds && !modal.globalRemoteIds.includes(value.remoteId)) throw new Error('Remote does not exist.');
  }
  if (kind === 'mapping' || kind === 'streamMapping') {
    if (kind === 'streamMapping') {
      if (!value.remoteId) throw new Error('Remote is required.');
      if (modal.projectRemoteIds && !modal.projectRemoteIds.includes(value.remoteId)) throw new Error('Remote does not belong to this project.');
    }
    if (value.type !== 'file' && value.type !== 'dir') throw new Error('Mapping type must be file or folder.');
    if (!value.local) throw new Error('Local path is required.');
    if (!value.remote) throw new Error('Remote path is required.');
    const remoteKind = modal.remoteKinds?.[value.remoteId] || modal.remoteKind || 'ssh';
    if (remoteKind === 'ssh' && !value.remote.startsWith('/')) throw new Error('Remote path must start with /.');
  }
}

function getRemote(config, projectId, remoteId) {
  return config.projects.find((item) => item.id === projectId).remotes.find((item) => item.id === remoteId);
}

function getCategory(config, projectId, remoteId, categoryId) {
  return getRemote(config, projectId, remoteId).categories.find((item) => item.id === categoryId);
}

function getStream(config, projectId, streamId) {
  return (config.projects.find((item) => item.id === projectId).streams || []).find((item) => item.id === streamId);
}

function getStreamCategory(config, projectId, streamId, categoryId) {
  return getStream(config, projectId, streamId).categories.find((item) => item.id === categoryId);
}

function uniqueId(items, base) {
  const used = new Set(items.map((item) => item.id));
  let id = base;
  let index = 2;
  while (used.has(id)) id = `${base}-${index++}`;
  return id;
}

function remoteKeys(project, remote) {
  return remote.categories.flatMap((category) => categoryKeys(project, remote, category));
}

function categoryKeys(project, remote, category, path = [category.id]) {
  return [
    ...category.mappings.map((mapping) => mappingKey(project, remote, path, mapping)),
    ...category.categories.flatMap((child) => categoryKeys(project, remote, child, [...path, child.id]))
  ];
}

function mappingKey(project, remote, categoryPath, mapping) {
  return `${project.id}/${remote.id}/${categoryPath.join('/')}/${mapping.id}`;
}

function streamKeys(project, projectRemotes, stream) {
  return (stream.categories || []).flatMap((category) => streamCategoryKeys(project, stream, category, [category.id]));
}

function streamCategoryKeys(project, stream, category, path = [category.id]) {
  return [
    ...category.mappings.map((mapping) => streamMappingKey(project, stream, path, mapping)),
    ...category.categories.flatMap((child) => streamCategoryKeys(project, stream, child, [...path, child.id]))
  ];
}

function streamMappingKey(project, stream, categoryPath, mapping) {
  return `${project.id}/streams/${stream.id}/${categoryPath.join('/')}/${mapping.id}`;
}

function categoryLiveKey(project, remote, categoryPath) {
  return `${project.id}/${remote.id}/${categoryPath.join('/')}`;
}

function streamCategoryLiveKey(project, stream, categoryPath) {
  return `${project.id}/streams/${stream.id}/${categoryPath.join('/')}`;
}

function collectCategoryTargets(config) {
  return config.projects.flatMap((project) => (
    [
      ...getProjectRemotes(config, project).flatMap((remote) => (
        remote.categories.flatMap((category) => collectRemoteCategoryTargets(project, remote, category))
      )),
      ...(project.streams || []).flatMap((stream) => (
        (stream.categories || []).flatMap((category) => collectStreamCategoryTargets(project, stream, category))
      ))
    ]
  ));
}

function collectRemoteCategoryTargets(project, remote, category, path = [category.id]) {
  return [
    {
      id: categoryLiveKey(project, remote, path),
      label: `${project.label || project.id}/${remote.label || remote.id}/${path.join('/')}`,
      keys: categoryKeys(project, remote, category, path)
    },
    ...category.categories.flatMap((child) => collectRemoteCategoryTargets(project, remote, child, [...path, child.id]))
  ];
}

function collectStreamCategoryTargets(project, stream, category, path = [category.id]) {
  return [
    {
      id: streamCategoryLiveKey(project, stream, path),
      label: `${project.label || project.id}/${stream.label || stream.id}/${path.join('/')}`,
      keys: streamCategoryKeys(project, stream, category, path)
    },
    ...category.categories.flatMap((child) => collectStreamCategoryTargets(project, stream, child, [...path, child.id]))
  ];
}

function collectCategoryMappings(categories) {
  return categories.flatMap((category) => [
    ...(category.mappings || []),
    ...collectCategoryMappings(category.categories || [])
  ]);
}

function getRemoteKind(remote) {
  const kind = remote.kind || 'ssh';
  return kind === 'path' ? 'share' : kind;
}

function getProjectRemotes(config, project) {
  return project.remotes.map((projectRemote) => {
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

function remoteSummary(remote) {
  const kind = getRemoteKind(remote);
  if (kind === 'ssh') return remote.host || remote.hostEnv || 'SSH server';
  if (kind === 'share') return remote.root || 'Network share';
  return remote.root || 'Local folder';
}

function resolveCategoryPath(categories, path) {
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
