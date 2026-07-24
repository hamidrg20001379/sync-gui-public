'use client';
import { useState } from 'react';
import EditorModal from './EditorModal';
import ConfirmModal from './ConfirmModal';
import { toast } from './Toast';

function blankProject() {
  return { id: '', name: '', remoteId: '' };
}

export default function ProjectsView({ config, onBack, onRefresh }) {
  const { projects = [], remotes = [] } = config;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showNewRemote, setShowNewRemote] = useState(false);
  const [newRemote, setNewRemote] = useState({ name: '', kind: 'ssh', host: '', port: 22, username: '', password: '' });
  const [showNewPass, setShowNewPass] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  function openNew() { setEditing(blankProject()); setShowNewRemote(false); setShowForm(true); }
  function openEdit(p) { setEditing({ ...p }); setShowNewRemote(false); setShowForm(true); }

  async function save() {
    if (!editing.name) return toast('Name is required.', 'error');
    if (!editing.remoteId) return toast('Select a remote.', 'error');
    const idx = projects.findIndex(p => p.id === editing.id);
    const next = [...projects];
    if (!editing.id) editing.id = editing.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    if (idx >= 0) next[idx] = editing;
    else next.push(editing);
    const r = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { remotes, projects: next, items: config.items } })
    });
    if (!r.ok) return toast('Failed to save.', 'error');
    setShowForm(false); onRefresh(); toast('Project saved.');
  }

  function removeProject(id) { setConfirmDelete(projects.find(p => p.id === id)); }
  async function doRemove() {
    const next = projects.filter(p => p.id !== confirmDelete.id);
    const r = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { remotes, projects: next, items: config.items } })
    });
    if (!r.ok) return toast('Failed to delete.', 'error');
    setConfirmDelete(null); onRefresh(); toast('Project deleted.');
  }

  async function createRemoteAndUse() {
    if (!newRemote.name) return;
    const id = newRemote.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    const remote = { ...(newRemote.kind === 'local' ? { kind: 'local' } : newRemote), id };
    const nextRemotes = [...remotes, remote];
    const r = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { remotes: nextRemotes, projects, items: config.items } })
    });
    if (!r.ok) return;
    setEditing({ ...editing, remoteId: id });
    setShowNewRemote(false);
    setNewRemote({ name: '', kind: 'ssh', host: '', port: 22, username: '', password: '' });
    onRefresh(); toast('Remote created.');
  }

  function remoteName(id) { return remotes.find(r => r.id === id)?.name || id || '—'; }

  return (
    <div className="stage">
      <div className="stage-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h2>Projects</h2>
        </div>
        <div className="stage-actions">
          <button className="primary" onClick={openNew}>+ New</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="empty-state">No projects yet.</p>
      ) : (
        <div className="card-grid">
          {projects.map(p => {
            const r = remotes.find(x => x.id === p.remoteId);
            return (
              <div key={p.id} className="card project-card">
                <button className="card-btn card-btn-del" onClick={() => removeProject(p.id)} title="Delete" aria-label="Delete project">✕</button>
                <button className="card-btn card-btn-edit" onClick={() => openEdit(p)} title="Edit" aria-label="Edit project">⚙</button>
                <div className="card-main">
                  <h3>{p.name}</h3>
                  <div className="remote-kind-badge">
                    <span className={`badge badge-${r?.kind || 'ssh'}`}>{r?.kind || 'ssh'}</span>
                    <span className="remote-label">{r?.name || '?'}</span>
                  </div>
                  <div className="stats">
                    <span>{config.items.filter(i => i.projectId === p.id).length} item(s)</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="card add-card" onClick={openNew}>
            <span>+</span>
            <p>Add Project</p>
          </div>
        </div>
      )}

      {showForm && (
        <EditorModal title={editing.id ? 'Edit Project' : 'New Project'} onClose={() => setShowForm(false)} onSave={save}>
          <div className="form">
            <label>Name <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="My Project" /></label>
            <label>Remote
              <select value={editing.remoteId} onChange={e => {
                setEditing({ ...editing, remoteId: e.target.value });
                if (e.target.value === '__new__') setShowNewRemote(true);
              }}>
                <option value="">— Select —</option>
                {remotes.map(r => <option key={r.id} value={r.id}>{r.name} ({r.kind})</option>)}
                <option value="__new__">+ Create new remote...</option>
              </select>
            </label>
            {showNewRemote && (
              <div className="inline-remote-form">
                <label>Name <input value={newRemote.name} onChange={e => setNewRemote({ ...newRemote, name: e.target.value })} placeholder="My Server" /></label>
                <label>Kind
                  <select value={newRemote.kind} onChange={e => setNewRemote({ ...newRemote, kind: e.target.value })}>
                    <option value="ssh">SSH</option>
                    <option value="local">Local</option>
                  </select>
                </label>
                {newRemote.kind === 'ssh' && (
                  <>
                    <label>Host <input value={newRemote.host} onChange={e => setNewRemote({ ...newRemote, host: e.target.value })} placeholder="192.168.1.100" /></label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <label>Port <input type="number" value={newRemote.port} onChange={e => setNewRemote({ ...newRemote, port: Number(e.target.value) })} /></label>
                      <label>Username <input value={newRemote.username} onChange={e => setNewRemote({ ...newRemote, username: e.target.value })} placeholder="deploy" /></label>
                    </div>
                    <label>Password
                      <div className="password-wrap">
                        <input type={showNewPass ? 'text' : 'password'} value={newRemote.password} onChange={e => setNewRemote({ ...newRemote, password: e.target.value })} placeholder="Optional" />
                        <button className="eye-btn" type="button" onClick={() => setShowNewPass(!showNewPass)}>{showNewPass ? '🙈' : '👁'}</button>
                      </div>
                    </label>
                  </>
                )}
                <button className="primary" onClick={createRemoteAndUse} style={{ justifySelf: 'start' }}>Create & Use</button>
              </div>
            )}
          </div>
        </EditorModal>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Project" message={`Delete "${confirmDelete.name}"? ${config.items.filter(i => i.projectId === confirmDelete.id).length > 0 ? 'Items using this project will be affected.' : ''}`} confirmLabel="Delete" onConfirm={doRemove} onCancel={() => setConfirmDelete(null)} />
      )}
    </div>
  );
}
