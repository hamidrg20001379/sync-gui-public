'use client';

export default function TargetPicker({ item, remotes, direction, onStart, onClose }) {
  const targets = item.targets || [];
  const allIndices = targets.map((_, i) => i);

  function resolveLabel(target) {
    const remote = remotes.find(r => r.id === target.remoteId);
    const tag = remote ? `${remote.name} (${remote.kind})` : '?';
    return target.name ? `${target.name} — ${tag}` : tag;
  }

  function handleForm(e) {
    e.preventDefault();
    const data = new FormData(e.target);
    const selected = direction === 'up'
      ? allIndices.filter(i => data.get(`t${i}`) === 'on')
      : [parseInt(data.get('target'))];
    if (!selected.length) return;
    onStart(selected);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal target-picker" onClick={e => e.stopPropagation()}
        onKeyDown={e => e.key === 'Escape' && onClose()} tabIndex={-1}>
        <header>
          <h2>{direction === 'up' ? 'Upload targets' : 'Download target'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </header>
        <form onSubmit={handleForm}>
          <div className="modal-body">
            <p className="tp-item-name">{item.name}</p>
            {direction === 'up' && <p className="tp-hint">Select targets to sync <strong>to</strong>:</p>}
            {direction === 'down' && <p className="tp-hint">Select which target to sync <strong>from</strong>:</p>}

            {!targets.length && <p className="empty-state-sm">No targets configured.</p>}

            <div className="tp-list">
              {targets.map((t, i) => (
                <label key={i} className={`tp-item ${direction === 'down' ? 'tp-radio' : ''}`}>
                  {direction === 'up' ? (
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
              {direction === 'up' ? 'Upload' : 'Download'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
