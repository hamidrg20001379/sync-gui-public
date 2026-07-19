export function CardStage({ title, children, actions }) {
  return (
    <section className="stage">
      <div className="stage-title">
        <h2>{title}</h2>
        {actions && <div className="stage-actions">{actions}</div>}
      </div>
      <div className="card-grid">{children}</div>
    </section>
  );
}
