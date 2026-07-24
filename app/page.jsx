'use client';
import { useState, useEffect } from 'react';
import SyncListView from './components/SyncListView';
import ProjectsView from './components/ProjectsView';
import RemotesView from './components/RemotesView';
import HealthCheck from './components/HealthCheck';
import ToastContainer from './components/Toast';

export default function Page() {
  const [tab, setTab] = useState('items');
  const [config, setConfig] = useState({ remotes: [], projects: [], items: [] });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    const r = await fetch('/api/config');
    if (r.ok) setConfig((await r.json()).config);
  }

  function refresh() { loadConfig(); setRefreshKey(k => k + 1); }
  function goItems() { setTab('items'); refresh(); }

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
        </div>
      </header>
      <HealthCheck />
      {tab === 'items' && <SyncListView key={'il' + refreshKey} config={config} onRefresh={refresh} />}
      {tab === 'projects' && <ProjectsView key={'pv' + refreshKey} config={config} onBack={goItems} onRefresh={refresh} />}
      {tab === 'remotes' && <RemotesView key={'rv' + refreshKey} config={config} onBack={goItems} onRefresh={refresh} />}
      <ToastContainer />
    </div>
  );
}
