'use client';

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: '40px', textAlign: 'center' }}>
        <div style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '560px',
          margin: '40px auto',
        }}>
          <h2 style={{ color: '#f87171' }}>Global Application Error</h2>
          <p style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '13px' }}>
            {error?.message || String(error)}
          </p>
          <button
            onClick={() => reset()}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', marginTop: '16px' }}
          >
            Reload Application
          </button>
        </div>
      </body>
    </html>
  );
}
