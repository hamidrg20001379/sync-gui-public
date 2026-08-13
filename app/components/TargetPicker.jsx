'use client';
import { useState } from 'react';
import { X } from '@phosphor-icons/react';

export default function TargetPicker({ item, remotes, direction, onStart, onClose }) {
  const targets = item?.targets || [];
  const [selectedUp, setSelectedUp] = useState(() => targets.map((_, i) => i));
  const [selectedDown, setSelectedDown] = useState(0);

  function resolveLabel(target) {
    const remoteIds = target.remoteIds?.length ? target.remoteIds : [target.remoteId].filter(Boolean);
    const remote = remotes.find(r => r.id === remoteIds[0]);
    const tag = remote ? `${remote.name} (${remote.kind})${remoteIds.length > 1 ? ` +${remoteIds.length - 1}` : ''}` : '?';
    return target.name ? `${target.name} — ${tag}` : tag;
  }

  function handleConfirm(e) {
    if (e) e.preventDefault();
    if (!targets.length) return;

    let selected = [];
    if (direction === 'up') {
      selected = selectedUp;
    } else {
      if (selectedDown !== null && selectedDown >= 0 && selectedDown < targets.length) {
        selected = [selectedDown];
      }
    }

    if (!selected.length) return;
    onStart(selected);
  }

  function toggleUpIndex(idx) {
    setSelectedUp(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal target-picker"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        tabIndex={-1}
      >
        <header>
          <h2>{direction === 'up' ? 'Upload targets' : 'Download target'}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="tp-item-name">{item?.name || 'Sync Item'}</p>
          {direction === 'up' && <p className="tp-hint">Select targets to sync <strong>to</strong>:</p>}
          {direction === 'down' && <p className="tp-hint">Select which target to sync <strong>from</strong>:</p>}

          {!targets.length && <p className="empty-state-sm">No targets configured.</p>}

          <div className="tp-list">
            {targets.map((t, i) => (
              <label key={i} className={`tp-item ${direction === 'down' ? 'tp-radio' : ''}`}>
                {direction === 'up' ? (
                  <input
                    type="checkbox"
                    checked={selectedUp.includes(i)}
                    onChange={() => toggleUpIndex(i)}
                  />
                ) : (
                  <input
                    type="radio"
                    name="target"
                    value={i}
                    checked={selectedDown === i}
                    onChange={() => setSelectedDown(i)}
                  />
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
          <button
            type="button"
            className="primary"
            disabled={!targets.length || (direction === 'up' && !selectedUp.length)}
            onClick={handleConfirm}
          >
            {direction === 'up' ? 'Upload' : 'Download'}
          </button>
        </footer>
      </div>
    </div>
  );
}
