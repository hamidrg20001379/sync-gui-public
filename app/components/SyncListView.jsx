'use client';
import { useState, useEffect } from 'react';
import EditorModal from './EditorModal';
import ConfirmModal from './ConfirmModal';
import { toast } from './Toast';

const PAGE_SIZE = 30;
const LS_KEY = 'sync-gui-settings';

function blankItem() {
  return { id: '', name: '', source: '', dest: '', type: 'folder', projectId: '' };
}

function resolveProject(id, projects) { return projects.find(p => p.id === id); }
function resolveRemote(project, remotes) { return remotes.find(r => r.id === project?.remoteId); }

export default function SyncListView({ config, onRefresh }) {
  const { items = [], projects = [], remotes = [] } = config;
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('ready');
  const [history, setHistory] = useState([]);
  const [syncingIds, setSyncingIds] = useState([]);

  const [dryRun, setDryRun] = useState(() => {
    if (typeof window === 'undefined') return false;
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}').dryRun || false;
  });
  const [noDelete, setNoDelete] = useState(() => {
    if (typeof window === 'undefined') return false;
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}').noDelete || false;
  });

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify({ dryRun, noDelete })); }, [dryRun, noDelete]);
  useEffect(() => { loadHistory(); const id = setInterval(loadHistory, 3000); return () => clearInterval(id); }, []);

  async function loadHistory() {
    const r = await fetch('/api/history');
    if (r.ok) setHistory((await r.json()).history || []);
  }

  async function saveConfig(nextItems) {
    const r = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { remotes, projects, items: nextItems } })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    onRefresh();
  }

  function openNew() { setEditing(blankItem()); setShowForm(true); }
  function openEdit(item) { setEditing({ ...item }); setShowForm(true); }

  async function save() {
    if (!editing.name) { toast('Name is required.', 'error'); return; }
    if (!editing.source) { toast('Source path is required.', 'error'); return; }
    if (!editing.dest) { toast('Destination path is required.', 'error'); return; }
    if (!editing.projectId) { toast('Select a project.', 'error'); return; }
    const idx = items.findIndex(i => i.id === editing.id);
    const next = [...items];
    if (!editing.id) editing.id = editing.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    if (idx >= 0) next[idx] = editing;
    else next.push(editing);
    try { await saveConfig(next); setShowForm(false); toast('Item saved.'); }
    catch (e) { toast(e.message, 'error'); }
  }

  function removeItem(id) { setConfirmDelete(items.find(i => i.id === id)); }
  async function doRemove() {
    try { await saveConfig(items.filter(i => i.id !== confirmDelete.id)); setConfirmDelete(null); toast('Item deleted.'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function doSync(itemIds, direction) {
    setStatus('running'); setSyncingIds(itemIds);
    setOutput(`> syncing ${itemIds.length} item(s) ${direction}\n`);
    const r = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, noDelete, direction, itemIds })
    });
    const data = await r.json();
    if (!r.ok) { setOutput(o => o + (data.error || 'Failed') + '\n'); setStatus('failed'); setSyncingIds([]); return; }
    setOutput(o => o + `Job #${data.id} started.\n`);
    pollJob(data.id);
  }

  function pollJob(id) {
    const id_ = setInterval(async () => {
      const r = await fetch(`/api/run?id=${id}`);
      if (!r.ok) return;
      const job = await r.json();
      if (job.status !== 'running') {
        clearInterval(id_);
        setOutput(job.output || '');
        setStatus(job.status === 'succeeded' ? 'done' : 'failed');
        setSyncingIds([]); loadHistory();
        if (job.status === 'succeeded') toast('Sync completed.');
        else toast('Sync failed.', 'error');
      }
    }, 1000);
  }

  const q = search.toLowerCase();
  const filtered = items.filter(i => {
    if (q && !i.name.toLowerCase().includes(q) && !i.source.toLowerCase().includes(q)) return false;
    if (projectFilter && i.projectId !== projectFilter) return false;
    return true;
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="stage">
      <div className="stage-title">
        <h2>Sync Items</h2>
        <div className="stage-actions">
          <label className="search-box">
            <input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
          </label>
          {projects.length > 0 && (
            <select className="filter-select" value={projectFilter} onChange={e => { setProjectFilter(e.target.value); setPage(0); }}>
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="toggles">
            <label><input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} /> Dry-run</label>
            <label><input type="checkbox" checked={noDelete} onChange={e => setNoDelete(e.target.checked)} /> No-delete</label>
          </div>
          <span className={`status ${status}`}>
            {status === 'running' ? `${syncingIds.length} running` : status}
          </span>
          {items.length > 0 && <><button className="primary" onClick={() => doSync(filtered.map(i => i.id), 'up')}>Sync All ↑</button><button className="primary" onClick={() => doSync(filtered.map(i => i.id), 'down')} style={{ marginLeft: 4 }}>Sync All ↓</button></>}
          <button className="primary" onClick={openNew}>+ New</button>
        </div>
      </div>

      {status === 'running' && <div className="progress-bar"><div className="progress-fill" /></div>}

      {items.length === 0 ? (
        <div className="empty-state" style={{ padding: 48, fontSize: 15 }}>
          No sync items yet.
          <br /><button className="primary" onClick={openNew} style={{ marginTop: 16 }}>+ Create your first sync</button>
        </div>
      ) : paged.length === 0 ? (
        <p className="empty-state">No items match your search.</p>
      ) : (
        <div className="item-list">
          {paged.map(item => {
            const project = resolveProject(item.projectId, projects);
            const remote = resolveRemote(project, remotes);
            return (
            <div key={item.id} className={`item-card ${item.type}`}>
              <div className="item-head">
                <span className="type-icon">{item.type === 'folder' ? '📁' : '📄'}</span>
                <span className="item-name">{item.name}</span>
                <div className="item-actions">
                  <button className="btn-up" onClick={() => doSync([item.id], 'up')} title="Sync up" aria-label="Sync up">↑</button>
                  <button className="btn-down" onClick={() => doSync([item.id], 'down')} title="Sync down" aria-label="Sync down">↓</button>
                  <button className="card-btn card-btn-edit" onClick={() => openEdit(item)} aria-label="Edit">⚙</button>
                  <button className="card-btn card-btn-del" onClick={() => removeItem(item.id)} aria-label="Delete">✕</button>
                </div>
              </div>
              <div className="item-paths">
                <span className="item-source">{item.source}</span>
                <span className="mapping-arrow">→</span>
                <span className="item-dest">{item.dest}</span>
              </div>
              <div className="item-meta">
                <span className={`badge badge-${remote?.kind || 'local'}`}>{remote?.kind || 'local'}</span>
                {remote?.kind === 'ssh' && <span className="conn-detail">{remote.username}@{remote.host}</span>}
                <span className={`badge badge-${item.type}`}>{item.type}</span>
                <span className="group-tag">{project?.name || '?'}</span>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span>{page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {(output || status !== 'ready') && (
        <div className="console-panel" style={{ marginTop: 16 }}>
          <div className="console-head">
            <span>Output</span>
            <button onClick={() => setOutput('')}>Clear</button>
          </div>
          <pre>{output || 'Ready to sync.'}</pre>
        </div>
      )}

      {history.length > 0 && (
        <div className="side-panel" style={{ marginTop: 16 }}>
          <div className="side-panel-head">
            <span className="tab active">Recent Jobs</span>
          </div>
          {history.slice(0, 15).map(j => (
            <div key={j.id} className={`history-item-mini ${j.status}`} onClick={() => { setOutput(j.output || ''); setStatus(j.status === 'succeeded' ? 'done' : 'failed'); }}>
              <span className={`status-dot ${j.status}`} />
              <span className="h-direction">{j.direction === 'up' ? '↑' : '↓'}</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>{j.itemIds.length} item(s)</span>
              <span className="h-time">{new Date(j.startedAt).toLocaleTimeString()}</span>
              <span className={`h-status ${j.status}`}>{j.status}</span>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <EditorModal title={editing.id ? 'Edit Sync Item' : 'New Sync Item'} onClose={() => setShowForm(false)} onSave={save}>
          <div className="form">
            <label>Name <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Static assets" /></label>
            <label>Source path (local) <input value={editing.source} onChange={e => setEditing({ ...editing, source: e.target.value })} placeholder="/home/user/project/dist" /></label>
            <label>Destination path <input value={editing.dest} onChange={e => setEditing({ ...editing, dest: e.target.value })} placeholder="/var/www/html" /></label>
            <label>Type
              <select value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value })}>
                <option value="folder">Folder</option>
                <option value="file">File</option>
              </select>
            </label>
            <label>Project
              <select value={editing.projectId} onChange={e => setEditing({ ...editing, projectId: e.target.value })}>
                <option value="">— Select —</option>
                {projects.map(p => {
                  const r = resolveRemote(p, remotes);
                  return <option key={p.id} value={p.id}>{p.name} ({r?.name || r?.kind || '?'})</option>;
                })}
              </select>
            </label>
          </div>
        </EditorModal>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Sync Item" message={`Delete "${confirmDelete.name}"? This cannot be undone.`} confirmLabel="Delete" onConfirm={doRemove} onCancel={() => setConfirmDelete(null)} />
      )}
    </div>
  );
}
