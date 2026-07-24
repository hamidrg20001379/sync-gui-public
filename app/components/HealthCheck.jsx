'use client';
import { useState, useEffect, useRef } from 'react';

const INFO = {
  bash: {
    label: 'Bash',
    why: 'Command shell required to execute rsync and system commands',
    level: 'critical',
    fix: {
      linux: 'Pre-installed on all Linux distributions',
      win: 'Installed automatically with MSYS2',
    },
  },
  rsync: {
    label: 'rsync',
    why: 'File synchronization engine — transfers, compares, and deletes files',
    level: 'critical',
    fix: {
      linux: 'sudo apt install rsync',
      win: 'Installed automatically with MSYS2 (pacman -S rsync)',
    },
  },
  sshpass: {
    label: 'sshpass',
    why: [
      'Lets rsync connect to SSH servers using a password without prompting the terminal.',
      'Without it, password-based SSH authentication will fail (key-based auth still works).',
      'Ubuntu does not ship sshpass by default because passwords passed as CLI arguments can be visible to other processes on the same machine.',
      'If you use SSH keys for authentication, this tool is not needed.',
    ],
    level: 'recommended',
    fix: {
      linux: 'sudo apt install sshpass',
      win: 'pacman -S sshpass (inside MSYS2)',
    },
  },
  ssh: {
    label: 'SSH client',
    why: 'Secure shell connection to remote servers for file transfer',
    level: 'critical',
    fix: {
      linux: 'sudo apt install openssh-client',
      win: 'Installed automatically with MSYS2 (pacman -S openssh)',
    },
  },
};

function CodeBlock({ text }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      fontFamily: 'ui-monospace, "Cascadia Code", monospace',
      fontSize: 12, lineHeight: 1.5,
      background: '#292524', borderRadius: 6, overflow: 'hidden',
    }}>
      <div style={{ flex: 1, padding: '8px 12px', color: '#a7f3d0', whiteSpace: 'pre-wrap' }}>
        {text}
      </div>
      <button onClick={copy} style={{
        border: 'none', background: copied ? '#065f46' : '#44403c',
        color: copied ? '#6ee7b7' : '#d6d3d1',
        cursor: 'pointer', padding: '8px 12px', fontSize: 12,
        fontWeight: 600, borderRadius: 0, flexShrink: 0,
      }}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function HealthCheck() {
  const [deps, setDeps] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/deps')
      .then(r => r.json())
      .then(data => { if (!cancelled) setDeps(data); })
      .catch(() => { if (!cancelled) setDeps({ ok: false, deps: {}, error: 'API unreachable' }); });
    return () => { cancelled = true; };
  }, []);

  if (!deps || deps.ok) return null;

  const missing = deps.deps
    ? Object.entries(deps.deps).filter(([, v]) => !v).map(([k]) => ({ name: k, info: INFO[k] }))
    : [];

  const isWin = deps.platform === 'win32';

  return (
    <div style={{
      background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 12,
      margin: '0 24px 16px', fontSize: 13, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', cursor: 'pointer',
      }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <span style={{ fontWeight: 700, color: '#92400e' }}>
          {missing.length} system tool{missing.length > 1 ? 's' : ''} missing
        </span>
        <span style={{ color: '#a16207', fontSize: 12 }}>
          {missing.map(m => m.info?.label || m.name).join(', ')}
        </span>
        <span style={{ marginLeft: 'auto', color: '#a16207', fontSize: 11 }}>
          {expanded ? '▲' : '▼'} {expanded ? 'less' : 'details'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 14px', display: 'grid', gap: 12 }}>
          {isWin && !deps.msys2 && (
            <div style={{ background: '#fef2f2', borderRadius: 8, padding: '10px 14px', border: '1px solid #fecaca' }}>
              <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>MSYS2 not installed</div>
              <div style={{ color: '#7f1d1d', fontSize: 12, lineHeight: 1.6 }}>
                MSYS2 provides the Unix environment (bash, rsync, ssh, sshpass) required on Windows.
                Run <strong>setup-win.ps1</strong> or download from msys2.org.
              </div>
            </div>
          )}

          {missing.map(({ name, info }) => (
            <div key={name} style={{
              background: info?.level === 'critical' ? '#fef2f2' : '#fffbeb',
              borderRadius: 8, padding: '10px 14px',
              border: `1px solid ${info?.level === 'critical' ? '#fecaca' : '#fde68a'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: '#1c1917', fontSize: 14 }}>{info?.label || name}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                  background: info?.level === 'critical' ? '#fecaca' : '#fde68a',
                  color: info?.level === 'critical' ? '#991b1b' : '#92400e',
                  textTransform: 'uppercase',
                }}>
                  {info?.level === 'critical' ? 'REQUIRED' : 'RECOMMENDED'}
                </span>
              </div>

              <div style={{ color: '#44403c', fontSize: 12, lineHeight: 1.6, marginBottom: 6 }}>
                {Array.isArray(info?.why)
                  ? info.why.map((line, i) => <div key={i} style={{ marginBottom: i < info.why.length - 1 ? 4 : 0 }}>{line}</div>)
                  : info?.why}
              </div>

              <CodeBlock text={isWin ? info?.fix?.win : info?.fix?.linux} />
            </div>
          ))}

          <div style={{ textAlign: 'center', color: '#78716c', fontSize: 11, paddingTop: 2 }}>
            {isWin
              ? 'Run setup-win.ps1 to install all dependencies automatically'
              : 'Quick install:  sudo apt install rsync sshpass openssh-client'}
          </div>
        </div>
      )}
    </div>
  );
}
