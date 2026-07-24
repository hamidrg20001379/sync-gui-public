'use client';
import { useState, useEffect, useRef } from 'react';
import SyncListView from './components/SyncListView';
import ProjectsView from './components/ProjectsView';
import RemotesView from './components/RemotesView';
import HealthCheck from './components/HealthCheck';
import ToastContainer from './components/Toast';
import ImportModal from './components/ImportModal';

export default function Page() {
  const [tab, setTab] = useState('items');
  const [config, setConfig] = useState({ remotes: [], projects: [], items: [] });
  const [refreshKey, setRefreshKey] = useState(0);
  const [importAnalysis, setImportAnalysis] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    const r = await fetch('/api/config');
    if (r.ok) setConfig((await r.json()).config);
  }

  function refresh() { loadConfig(); setRefreshKey(k => k + 1); }
  function goItems() { setTab('items'); refresh(); }

  async function handleExport() {
    const r = await fetch('/api/export');
    if (!r.ok) return;
    const { config } = await r.json();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sync-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleImportPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const r = await fetch('/api/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'analyze', data }),
        });
        if (!r.ok) return;
        const analysis = await r.json();
        analysis._importData = data;
        setImportAnalysis(analysis);
      } catch { /* invalid JSON */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleImportApply(resolutions) {
    const data = importAnalysis._importData;
    const r = await fetch('/api/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', data, resolutions }),
    });
    setImportAnalysis(null);
    if (r.ok) refresh();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>Sync GUI</h1>
          <p className="subtitle">File synchronization</p>
        </div>
        <div className="top-actions">
          <button className={tab === 'items' ? 'primary' : ''} onClick={() => setTab('items')}>Sync Items</button>
          <button className={tab === 'projects' ? 'primary' : ''} onClick={() => setTab('projects')}>Projects</button>
          <button className={tab === 'remotes' ? 'primary' : ''} onClick={() => setTab('remotes')}>Remotes</button>
          <div className="topbar-divider" />
          <button className="topbar-btn" onClick={handleExport}>Export</button>
          <button className="topbar-btn" onClick={() => fileInput.current?.click()}>Import</button>
          <input ref={fileInput} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportPick} />
        </div>
      </header>
      <HealthCheck />
      {tab === 'items' && <SyncListView key={'il' + refreshKey} config={config} onRefresh={refresh} />}
      {tab === 'projects' && <ProjectsView key={'pv' + refreshKey} config={config} onBack={goItems} onRefresh={refresh} />}
      {tab === 'remotes' && <RemotesView key={'rv' + refreshKey} config={config} onBack={goItems} onRefresh={refresh} />}
      <ToastContainer />
      {importAnalysis && (
        <ImportModal
          analysis={importAnalysis}
          onApply={handleImportApply}
          onClose={() => setImportAnalysis(null)}
        />
      )}
    </div>
  );
}
