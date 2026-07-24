'use client';
import { useEffect } from 'react';

export default function EditorModal({ title, children, onClose, onSave, saveLabel = 'Save' }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </header>
        <div className="modal-body">{children}</div>
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSave}>{saveLabel}</button>
        </footer>
      </div>
    </div>
  );
}
