'use client';
import { useState } from 'react';
import EditorModal from './EditorModal';
import ConfirmModal from './ConfirmModal';
import { toast } from './Toast';

function blankRemote() {
  return { id: '', name: '', kind: 'ssh', host: '', port: 22, username: '', password: '' };
}

export default function RemotesView({ config, onBack, onRefresh }) {
  const { remotes = [] } = config;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  function openNew() { setEditing(blankRemote()); setShowForm(true); }
  function openEdit(r) { setEditing({ ...r }); setShowForm(true); }

  async function save() {
    if (!editing.name) return toast('Name is required.', 'error');
    if (editing.kind === 'ssh' && !editing.host) return toast('Host is required for SSH.', 'error');
    const idx = remotes.findIndex(r => r.id === editing.id);
    const next = [...remotes];
    if (!editing.id) editing.id = editing.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    if (editing.kind === 'local') editing.host = ''; editing.port = 22; editing.username = ''; editing.password = '';
    if (idx >= 0) next[idx] = editing;
    else next.push(editing);
    const r = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { remotes: next, projects: config.projects, items: config.items } })
    });
    if (!r.ok) return toast('Failed to save.', 'error');
    setShowForm(false); onRefresh(); toast('Remote saved.');
  }

  function removeRemote(id) { setConfirmDelete(remotes.find(r => r.id === id)); }
  async function doRemove() {
    const used = config.projects.filter(p => p.remoteId === confirmDelete.id).length;
    if (used > 0) return toast('Cannot delete: remote is used by ' + used + ' project(s).', 'error');
    const next = remotes.filter(r => r.id !== confirmDelete.id);
    const r = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { remotes: next, projects: config.projects, items: config.items } })
    });
    if (!r.ok) return toast('Failed to delete.', 'error');
    setConfirmDelete(null); onRefresh(); toast('Remote deleted.');
  }

  return (
    <div className="stage">
      <div className="stage-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h2>Remotes</h2>
        </div>
        <div className="stage-actions">
          <button className="primary" onClick={openNew}>+ Add</button>
        </div>
      </div>

      {remotes.length === 0 ? (
        <p className="empty-state">No remotes defined.</p>
      ) : (
        <div className="remote-list">
          {remotes.map(r => (
            <div key={r.id} className="remote-row">
              <div className="remote-info">
                <strong>{r.name}</strong>
                <span className={`badge badge-${r.kind}`}>{r.kind}</span>
                {r.kind === 'ssh' && <span className="remote-detail">{r.username}@{r.host}:{r.port}</span>}
                <span className="remote-used-by">{config.projects.filter(p => p.remoteId === r.id).length} project(s)</span>
              </div>
              <div className="remote-actions">
                <button className="card-btn card-btn-edit" onClick={() => openEdit(r)} aria-label="Edit remote">⚙</button>
                <button className="card-btn card-btn-del" onClick={() => removeRemote(r.id)} aria-label="Delete remote">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <EditorModal title={editing.id ? 'Edit Remote' : 'New Remote'} onClose={() => setShowForm(false)} onSave={save}>
          <div className="form">
            <label>Name <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Production Server" /></label>
            <label>Kind
              <select value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value, host: '', port: 22, username: '', password: '' })}>
                <option value="ssh">SSH</option>
                <option value="local">Local</option>
              </select>
            </label>
            {editing.kind === 'ssh' && (
              <>
                <label>Host <input value={editing.host} onChange={e => setEditing({ ...editing, host: e.target.value })} placeholder="192.168.1.100" /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <label>Port <input type="number" value={editing.port} onChange={e => setEditing({ ...editing, port: Number(e.target.value) })} /></label>
                  <label>Username <input value={editing.username} onChange={e => setEditing({ ...editing, username: e.target.value })} placeholder="deploy" /></label>
                </div>
                <label>Password
                  <div className="password-wrap">
                    <input type={editing.showPass ? 'text' : 'password'} value={editing.password || ''} onChange={e => setEditing({ ...editing, password: e.target.value })} placeholder="Optional" />
                    <button className="eye-btn" type="button" onClick={() => setEditing({ ...editing, showPass: !editing.showPass })}>{editing.showPass ? '🙈' : '👁'}</button>
                  </div>
                </label>
              </>
            )}
          </div>
        </EditorModal>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Remote" message={`Delete "${confirmDelete.name}"?`} confirmLabel="Delete" onConfirm={doRemove} onCancel={() => setConfirmDelete(null)} />
      )}
    </div>
  );
}
