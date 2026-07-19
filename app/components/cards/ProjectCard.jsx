import { CardTools } from '../ui/CardTools';

export function ProjectCard({ project, remotes, onOpen, onEdit, onDelete }) {
  const remoteCount = remotes.length;
  const streams = project.streams || [];
  const streamNames = streams.map((stream) => stream.label || stream.id).join(', ');
  const mappingCount = remotes.flatMap((remote) => remote.categories).flatMap((category) => category.mappings).length;
  return (
    <article className="card project-card" onClick={onOpen}>
      <div className="card-main">
        <h3>{project.label || project.id}</h3>
        {streams.length > 0 && <small className="project-streams" title={streamNames}>Streams: {streamNames}</small>}
      </div>
      <div className="stats">
        <span>{streams.length} streams</span>
        <span>{remoteCount} remotes</span>
        <span>{mappingCount} mappings</span>
      </div>
      <CardTools onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}
