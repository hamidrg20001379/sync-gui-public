import { SyncTools } from '../ui/SyncTools';

export function CategoryCard({
  category,
  isLive,
  onOpen,
  onEdit,
  onDelete,
  onAddFileMapping,
  onAddFolderMapping,
  onEditMapping,
  onDeleteMapping,
  onUp,
  onDown,
  onToggleLive,
  onMappingUp,
  onMappingDown,
  dragCategoryId,
  onDragStart,
  onDragEnd,
  onDropCategory
}) {
  const isDragging = dragCategoryId === category.id;
  const isDropTarget = dragCategoryId && dragCategoryId !== category.id;

  return (
    <article
      className={`card category-card ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
      draggable
      onDoubleClick={(event) => {
        if (event.target.closest('button') || event.target.closest('.sync-tools') || event.target.closest('.mapping-list')) return;
        onOpen();
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', category.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!isDropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = event.dataTransfer.getData('text/plain');
        onDropCategory(sourceId);
      }}
    >
      <div className="category-head">
        <div>
          <span className="mapping-type-badge badge-category">CATEGORY</span>
          <h3>{category.label || category.id}</h3>
          <p>{category.mappings.length} mapping{category.mappings.length === 1 ? '' : 's'}{category.categories.length > 0 ? `, ${category.categories.length} sub${category.categories.length === 1 ? '' : ''}` : ''}</p>
        </div>
      </div>
      <SyncTools onUp={onUp} onDown={onDown} />
      <button
        className={`live-toggle ${isLive ? 'active' : ''}`}
        title={isLive ? 'Stop live up sync' : 'Live up sync every 5 seconds'}
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleLive();
        }}
      >
        LIVE
      </button>
      <div className="mapping-list">
        {category.mappings.map((mapping) => (
          <div className="mapping-row" key={mapping.id}>
            <button className="mapping-name" onDoubleClick={(event) => {
              event.stopPropagation();
              onEditMapping(mapping);
            }}>
              <strong>{mapping.label || mapping.id}</strong>
              <span>{mapping.type}</span>
              <small title={`${mapping.local} -> ${mapping.remote}`}>{mapping.local}{' -> '}{mapping.remote}</small>
            </button>
            <button className="btn-up" title="Sync up" onClick={() => onMappingUp(mapping)}>↑</button>
            <button className="btn-down" title="Sync down" onClick={() => onMappingDown(mapping)}>↓</button>
            <button title="Delete" className="danger" onClick={() => onDeleteMapping(mapping)}>×</button>
          </div>
        ))}
      </div>
      <div className="category-actions">
        <button onClick={onAddFileMapping}>+ file</button>
        <button onClick={onAddFolderMapping}>+ folder</button>
      </div>
      <button
        className="settings-icon"
        title="Edit category"
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        {'\u2699'}
      </button>
      <button
        className="delete-icon"
        title="Delete category"
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </article>
  );
}
