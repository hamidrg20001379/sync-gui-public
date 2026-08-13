'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('Next.js App Error caught:', error);
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '32px',
      color: '#e2e8f0',
      textAlign: 'center',
      backgroundColor: '#0f172a'
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '32px',
        maxWidth: '560px',
        width: '100%',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '12px', color: '#f87171' }}>
          ⚠️ Application Error
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', fontFamily: 'monospace', wordBreak: 'break-word' }}>
          {error?.message || String(error) || 'An unexpected error occurred in the application interface.'}
        </p>
        <button
          onClick={() => reset()}
          style={{
            background: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px'
          }}
        >
          Reload Interface
        </button>
      </div>
    </div>
  );
}
