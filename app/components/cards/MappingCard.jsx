import { SyncTools } from '../ui/SyncTools';
import { CardTools } from '../ui/CardTools';

export function MappingCard({ mapping, onEdit, onDelete, onUp, onDown }) {
  const isFile = mapping.type === 'file';
  return (
    <article className={`card mapping-card ${isFile ? 'mapping-file' : 'mapping-folder'}`}>
      <div className="mapping-card-head">
        <span className={`mapping-type-badge ${isFile ? 'badge-file' : 'badge-folder'}`}>{isFile ? 'FILE' : 'FOLDER'}</span>
        <h3>{mapping.label || mapping.id}</h3>
        <small className="mapping-paths" title={`${mapping.local} -> ${mapping.remote}`}>
          <span className="path-local">{mapping.local}</span>
          <span className="path-arrow">{'\u2192'}</span>
          <span className="path-remote">{mapping.remote}</span>
        </small>
      </div>
      <SyncTools onUp={onUp} onDown={onDown} />
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}
