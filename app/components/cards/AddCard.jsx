export function AddCard({ label, onClick }) {
  return (
    <button className="card add-card" onClick={onClick}>
      <span>+</span>
      <strong>{label}</strong>
    </button>
  );
}
