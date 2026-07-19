'use client';

import { useState } from 'react';
import { Field } from '../ui/Field';
import { getRemoteKind } from '../../utils/config-helpers';

export function EditorModal({ modal, setModal, onApply, projectRoot, globalRemotes }) {
  const value = modal.value;
  const [browsing, setBrowsing] = useState(false);

  const update = (field, fieldValue) => {
    const next = { ...value, [field]: fieldValue };
    if (field === 'label') {
      next.id = fieldValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    setModal({ ...modal, value: next });
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
          <Field label="Label" value={value.label || ''} onChange={(next) => update('label', next)} />
          {modal.kind === 'project' && (
            <Field label="Root folder" value={value.root} onChange={(next) => update('root', next)} />
          )}
          {modal.kind === 'projectStream' && (
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
          {modal.kind === 'category' && null}
          {modal.kind === 'mapping' && (
            <>
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
                label={modal.remoteKind === 'ssh' ? 'Remote path' : 'Remote path under root'}
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
