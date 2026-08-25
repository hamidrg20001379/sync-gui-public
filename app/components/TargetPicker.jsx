'use client';
import { X } from '@phosphor-icons/react';

export default function TargetPicker({ item, remotes, direction, onStart, onClose }) {
  const targets = item.targets || [];
  const allIndices = targets.map((_, i) => i);
  const checking = direction === 'check';
  const selectingMany = direction === 'up' || checking;

  function resolveLabel(target) {
    const remoteIds = target.remoteIds?.length ? target.remoteIds : [target.remoteId].filter(Boolean);
    const remote = remotes.find(r => r.id === remoteIds[0]);
    const tag = remote ? `${remote.name} (${remote.kind})${remoteIds.length > 1 ? ` +${remoteIds.length - 1}` : ''}` : '?';
    return target.name ? `${target.name} — ${tag}` : tag;
  }

  function handleForm(e) {
    e.preventDefault();
    const data = new FormData(e.target);
    const selected = selectingMany
      ? allIndices.filter(i => data.get(`t${i}`) === 'on')
      : [parseInt(data.get('target'))];
    if (!selected.length) return;
    onStart(selected);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal target-picker" onClick={e => e.stopPropagation()}
        onKeyDown={e => e.key === 'Escape' && onClose()} tabIndex={-1}>
        <header>
          <h2>{checking ? 'Check upload safety' : direction === 'up' ? 'Upload targets' : 'Download target'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <form onSubmit={handleForm}>
          <div className="modal-body">
            <p className="tp-item-name">{item.name}</p>
            {checking && <p className="tp-hint">Select targets to compare before uploading:</p>}
            {direction === 'up' && !checking && <p className="tp-hint">Select targets to sync <strong>to</strong>:</p>}
            {direction === 'down' && <p className="tp-hint">Select which target to sync <strong>from</strong>:</p>}

            {!targets.length && <p className="empty-state-sm">No targets configured.</p>}

            <div className="tp-list">
              {targets.map((t, i) => (
                <label key={i} className={`tp-item ${!selectingMany ? 'tp-radio' : ''}`}>
                  {selectingMany ? (
                    <input type="checkbox" name={`t${i}`} defaultChecked />
                  ) : (
                    <input type="radio" name="target" value={i} defaultChecked={i === 0} required />
                  )}
                  <div className="tp-info">
                    <span className="tp-name">{resolveLabel(t)}</span>
                    <span className="tp-dest">{t.dest}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <footer>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={!targets.length}>
              {checking ? 'Check safety' : direction === 'up' ? 'Upload' : 'Download'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
