export function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label>
      {label}
      <input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
