'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { blankProject, blankStream, blankRemote, blankCategory, blankMapping } from './utils/constants';
import { getRemoteKind, getProjectRemotes, getProjectRemotesList, getProjectStreamsList, getRemote, getCategory, uniqueId, resolveCategoryPath } from './utils/config-helpers';
import { remoteKeys, categoryKeys, mappingKey, categoryLiveKey, collectCategoryTargets } from './utils/sync-helpers';
import { cleanValue, validateModalValue } from './utils/validation';
import { pickProject, pickRemote, pickProjectStream, pickCategory, renameCategoryTargets, removeCategoryTargets } from './utils/entity-pickers';
import { CardStage } from './components/cards/CardStage';
import { ProjectCard } from './components/cards/ProjectCard';
import { RemoteCard } from './components/cards/RemoteCard';
import { MappingCard } from './components/cards/MappingCard';
import { CategoryCard } from './components/cards/CategoryCard';
import { AddCard } from './components/cards/AddCard';
import { EditorModal } from './components/modals/EditorModal';

export default function Page() {
  const [config, setConfig] = useState({ projects: [], remotes: [] });
  const [paths, setPaths] = useState({});
  const [projectId, setProjectId] = useState('');
  const [remoteId, setRemoteId] = useState('');
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
  const projectRemotesList = useMemo(
    () => (project ? getProjectRemotesList(config, project) : []),
    [config, project]
  );
  const projectStreamsList = useMemo(
    () => (project ? getProjectStreamsList(config, project) : []),
    [config, project]
  );
  const remote = useMemo(
    () => projectRemotes.find((item) => item.id === remoteId),
    [projectRemotes, remoteId]
  );
  const liveTargets = useMemo(() => collectCategoryTargets(config), [config]);
  const activeLiveTargets = useMemo(
    () => liveTargets.filter((target) => liveCategoryIds.includes(target.id)),
    [liveTargets, liveCategoryIds]
  );
  const view = remote ? 'categories' : project ? 'remotes' : 'projects';

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
    setCategoryPath(data.config.ui?.categoryPath || []);
    setModal(null);
    setDirty(false);
    setStatus('Ready');
  }

  async function saveConfig(nextConfig = config) {
    setStatus('Saving');
    const toSave = { ...nextConfig, ui: { ...(nextConfig.ui || {}), projectId, remoteId, categoryPath } };
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

  function openProjectStream(item = null) {
    if (!project) return;
    const firstGlobalRemoteId = (config.remotes || [])[0]?.id || '';
    setModal({
      kind: 'projectStream',
      title: item ? 'Edit stream' : 'Add stream',
      projectId: project.id,
      originalId: item?.id || '',
      globalRemoteIds: (config.remotes || []).map((remote) => remote.id),
      value: item
        ? pickProjectStream(item)
        : { ...blankStream, id: uniqueId(project.streams || project.remotes || [], 'stream'), label: 'New stream', remoteId: firstGlobalRemoteId }
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
          next.projects.push({ ...value, remotes: [], streams: [], categories: [] });
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
              for (const projectStream of nextProject.streams || []) {
                if (projectStream.remoteId === modal.originalId) projectStream.remoteId = value.id;
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
      if (modal.kind === 'projectStream') {
        if (!Array.isArray(nextProject.streams)) nextProject.streams = [];
        if (!Array.isArray(nextProject.remotes)) nextProject.remotes = [];
        if (modal.originalId) {
          const item = nextProject.streams.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value, { categories: item.categories || [] });
          const remoteItem = nextProject.remotes.find((entry) => entry.id === modal.originalId);
          if (remoteItem) Object.assign(remoteItem, value, { categories: remoteItem.categories || item.categories || [] });
          if (modal.originalId !== value.id) {
            renameCategoryTargets(nextProject.categories || [], modal.originalId, value.id);
            if (remoteId === modal.originalId) setRemoteId(value.id);
          }
        } else {
          nextProject.streams.push({ ...value, categories: [] });
          nextProject.remotes.push({ ...value, categories: [] });
          setRemoteId(value.id);
        }
        return;
      }

      const nextRemote = nextProject.remotes.find((entry) => entry.id === modal.remoteId);
      if (modal.kind === 'category') {
        if (modal.originalId) {
          const item = nextRemote.categories.find((entry) => entry.id === modal.originalId);
          Object.assign(item, value);
        } else {
          nextRemote.categories.push({ ...value, mappings: [] });
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
  }

  function deleteStream(item) {
    if (!project || !confirm(`Remove stream "${item.label || item.id}" from this project?`)) return;
    mutate((next) => {
      const nextProject = next.projects.find((entry) => entry.id === project.id);
      nextProject.streams = (nextProject.streams || []).filter((entry) => entry.id !== item.id);
      nextProject.remotes = nextProject.remotes.filter((entry) => entry.id !== item.id);
      removeCategoryTargets(nextProject.categories || [], item.id);
    });
    setRemoteId('');
    setCategoryPath([]);
  }

  function deleteGlobalRemote(item) {
    if (!confirm(`Delete global remote "${item.label || item.id}"?`)) return;
    mutate((next) => {
      next.remotes = (next.remotes || []).filter((entry) => entry.id !== item.id);
      for (const nextProject of next.projects) {
        nextProject.streams = (nextProject.streams || []).filter((entry) => (entry.remoteId || entry.id) !== item.id);
        nextProject.remotes = nextProject.remotes.filter((entry) => (entry.remoteId || entry.id) !== item.id);
      }
    });
    if (remote && (remote.remoteId || remote.id) === item.id) {
      setRemoteId('');
      setCategoryPath([]);
    }
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
            <button onClick={() => { setProjectId(''); setRemoteId(''); setCategoryPath([]); }}>Projects</button>
            {project && <button onClick={() => { setRemoteId(''); setCategoryPath([]); }}>{project.label || project.id}</button>}
            {remote && categoryPath.length === 0 && <span>{remote.label || remote.id}</span>}
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
            {projectRemotesList.map((item) => (
              <RemoteCard
                key={item.id}
                remote={item}
                onOpen={() => setRemoteId(item.id)}
                onEdit={() => openProjectStream(item)}
                onDelete={() => deleteStream(item)}
                onUp={() => runKeys(remoteKeys(project, item), 'up')}
                onDown={() => runKeys(remoteKeys(project, item), 'down')}
              />
            ))}
            <AddCard label="Add remote" onClick={() => openProjectStream()} />
          </CardStage>

          <CardStage title={`${project.label || project.id} streams`}>
            {projectStreamsList.map((item) => (
              <RemoteCard
                key={item.id}
                remote={item}
                onOpen={() => setRemoteId(item.id)}
                onEdit={() => openProjectStream(item)}
                onDelete={() => deleteStream(item)}
                onUp={() => runKeys(remoteKeys(project, item), 'up')}
                onDown={() => runKeys(remoteKeys(project, item), 'down')}
              />
            ))}
            <AddCard label="Add stream" onClick={() => openProjectStream()} />
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
