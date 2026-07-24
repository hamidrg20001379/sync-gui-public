'use client';
import { useState } from 'react';

export default function ImportModal({ analysis, onApply, onClose }) {
  const [remotesRes, setRemotesRes] = useState({});
  const [projectsRes, setProjectsRes] = useState({});
  const [itemsRes, setItemsRes] = useState({});

  function setRes(type, name, field, value) {
    const fn = type === 'remote' ? setRemotesRes : setProjectsRes;
    fn(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  }

  function itemKey(item) { return item.imported.name + '@' + item.projectName; }
  function itemRes(item) { return itemsRes[itemKey(item)] || {}; }

  function hasConflicts() {
    return analysis.remotes.some(r => r.conflict) ||
      analysis.projects.some(p => p.conflict) ||
      analysis.items.some(i => i.conflict);
  }

  async function handleApply() {
    const resolutions = {
      remotes: {},
      projects: {},
      items: {},
    };
    for (const r of analysis.remotes) resolutions.remotes[r.imported.name] = remotesRes[r.imported.name] || { action: 'replace' };
    for (const p of analysis.projects) resolutions.projects[p.imported.name] = projectsRes[p.imported.name] || { action: 'replace' };
    for (const item of analysis.items) {
      const key = itemKey(item);
      resolutions.items[key] = itemsRes[key] || { action: 'replace' };
    }
    onApply(resolutions);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={e => e.stopPropagation()}
        onKeyDown={e => e.key === 'Escape' && onClose()} tabIndex={-1}>
        <header>
          <h2>Import configuration</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </header>
        <div className="modal-body">
          <div className="import-summary">
            {analysis.summary.remotesNew > 0 && <span className="import-badge new">{analysis.summary.remotesNew} new remote(s)</span>}
            {analysis.summary.remotesConflict > 0 && <span className="import-badge conflict">{analysis.summary.remotesConflict} remote conflict(s)</span>}
            {analysis.summary.projectsNew > 0 && <span className="import-badge new">{analysis.summary.projectsNew} new project(s)</span>}
            {analysis.summary.projectsConflict > 0 && <span className="import-badge conflict">{analysis.summary.projectsConflict} project conflict(s)</span>}
            {analysis.summary.itemsNew > 0 && <span className="import-badge new">{analysis.summary.itemsNew} new item(s)</span>}
            {analysis.summary.itemsConflict > 0 && <span className="import-badge conflict">{analysis.summary.itemsConflict} item conflict(s)</span>}
          </div>

          {analysis.remotes.filter(r => r.conflict).length > 0 && (
            <div className="import-group">
              <h4>Remote conflicts</h4>
              {analysis.remotes.filter(r => r.conflict).map(r => (
                <ConflictRow key={r.imported.name}
                  label={r.imported.name}
                  imported={<span><span className="badge badge-ssh">{r.imported.kind}</span> {r.imported.host}</span>}
                  existing={<span><span className="badge badge-ssh">{r.existing.kind}</span> {r.existing.host}</span>}
                  value={remotesRes[r.imported.name] || {}}
                  onChange={(f, v) => setRes('remote', r.imported.name, f, v)}
                />
              ))}
            </div>
          )}

          {analysis.projects.filter(p => p.conflict).length > 0 && (
            <div className="import-group">
              <h4>Project conflicts</h4>
              {analysis.projects.filter(p => p.conflict).map(p => (
                <ConflictRow key={p.imported.name}
                  label={p.imported.name}
                  imported={<span>remote: {p.remoteName}</span>}
                  existing={<span>remote: {p.existing?.remoteId}</span>}
                  value={projectsRes[p.imported.name] || {}}
                  onChange={(f, v) => setRes('project', p.imported.name, f, v)}
                />
              ))}
            </div>
          )}

          {analysis.items.filter(i => i.conflict).length > 0 && (
            <div className="import-group">
              <h4>Item conflicts</h4>
              {analysis.items.filter(i => i.conflict).map(i => {
                const k = itemKey(i);
                return (
                  <ConflictRow key={k}
                    label={i.imported.name}
                    sub={`in project "${i.projectName}"`}
                    imported={<span>{i.imported.source} &rarr; {i.imported.dest}</span>}
                    existing={<span>{i.existing?.source} &rarr; {i.existing?.dest}</span>}
                    value={itemsRes[k] || {}}
                    onChange={(f, v) => {
                      setItemsRes(prev => ({ ...prev, [k]: { ...prev[k], [f]: v } }));
                    }}
                  />
                );
              })}
            </div>
          )}

          {!hasConflicts() && (
            <p className="import-no-conflicts">No conflicts found — all items will be added.</p>
          )}
        </div>
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleApply}>
            {hasConflicts() ? 'Apply with choices' : 'Import all'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ConflictRow({ label, sub, imported, existing, value, onChange }) {
  const action = value.action || 'replace';
  return (
    <div className="import-conflict-row">
      <div className="import-conflict-info">
        <strong>{label}</strong>
        {sub && <span className="import-sub">{sub}</span>}
      </div>
      <div className="import-conflict-sides">
        <div className="import-side imported-side">
          <span className="import-side-label">Import</span>
          {imported}
        </div>
        <div className="import-side existing-side">
          <span className="import-side-label">Current</span>
          {existing}
        </div>
      </div>
      <div className="import-conflict-action">
        <select value={action} onChange={e => onChange('action', e.target.value)}>
          <option value="replace">Replace</option>
          <option value="skip">Skip</option>
          <option value="rename">Rename</option>
        </select>
        {action === 'rename' && (
          <input
            type="text"
            placeholder="New name..."
            value={value.newName || ''}
            onChange={e => onChange('newName', e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
