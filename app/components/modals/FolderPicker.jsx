'use client';

import { useEffect, useState } from 'react';

export function FolderPicker({ root, currentPath, onSelect, onClose }) {
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
