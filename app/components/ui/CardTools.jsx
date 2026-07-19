export function CardTools({ onEdit, onDelete }) {
  return (
    <div className="card-tools" onClick={(event) => event.stopPropagation()}>
      <button className="settings-icon" title="Edit" onClick={onEdit}>{'\u2699'}</button>
      <button className="delete-icon" title="Delete" onClick={onDelete}>×</button>
    </div>
  );
}
