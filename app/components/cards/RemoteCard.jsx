import { SyncTools } from '../ui/SyncTools';
import { CardTools } from '../ui/CardTools';
import { remoteSummary } from '../../utils/config-helpers';

export function RemoteCard({ remote, onOpen, onEdit, onDelete, onUp, onDown }) {
  const categoryCount = remote.categories.length;
  const mappingCount = remote.categories.flatMap((category) => category.mappings).length;
  return (
    <article className="card remote-card" onClick={onOpen}>
      <div className="card-main">
        <h3>{remote.label || remote.id}</h3>
        <p>{remoteSummary(remote)}</p>
      </div>
      <div className="stats">
        <span>{categoryCount} categories</span>
        <span>{mappingCount} mappings</span>
      </div>
      {onUp && onDown && <SyncTools onUp={onUp} onDown={onDown} />}
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}
