export function SyncTools({ onUp, onDown }) {
  return (
    <div className="sync-tools" onClick={(event) => event.stopPropagation()}>
      <button className="btn-up" title="Sync up" onClick={onUp}>↑</button>
      <button className="btn-down" title="Sync down" onClick={onDown}>↓</button>
    </div>
  );
}
