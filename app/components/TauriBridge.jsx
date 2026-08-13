'use client';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

function getInvoke() {
  if (typeof window === 'undefined') return null;
  if (typeof tauriInvoke === 'function') return tauriInvoke;
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke;
  if (window.__TAURI__?.primitives?.invoke) return window.__TAURI__.primitives.invoke;
  if (window.__TAURI_INTERNALS__?.invoke) return window.__TAURI_INTERNALS__.invoke;
  if (window.__TAURI_INVOKE__) return window.__TAURI_INVOKE__;
  return null;
}

if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;

  window.fetch = async (url, options = {}) => {
    const urlStr = typeof url === 'string' ? url : (url.url || '');

    if (urlStr.startsWith('/api/') || urlStr.startsWith('http://localhost/api/') || urlStr.startsWith('http://tauri.localhost/api/')) {
      const invoke = getInvoke();
      if (!invoke) {
        console.warn('Tauri invoke not found when calling API:', urlStr);
        return new Response(JSON.stringify({ error: "Tauri backend unavailable" }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const method = (options.method || 'GET').toUpperCase();
      let body = {};
      if (options.body) {
        try {
          body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        } catch (e) {
          // ignore
        }
      }

      // Parse query string parameters
      const parsedUrl = new URL(urlStr, 'http://localhost');
      const query = Object.fromEntries(parsedUrl.searchParams.entries());

      try {
        if (parsedUrl.pathname.startsWith('/api/config')) {
          if (method === 'GET') {
            const config = await invoke('read_config');
            return new Response(JSON.stringify({ config }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'POST' || method === 'PUT') {
            const configToSend = body.config;
            await invoke('write_config', { config: configToSend });
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (parsedUrl.pathname.startsWith('/api/export')) {
          const config = await invoke('export_config');
          return new Response(JSON.stringify({ config }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (parsedUrl.pathname.startsWith('/api/import')) {
          const action = body.action || query.action;
          const importData = body.data;

          if (action === 'analyze') {
            const existing = await invoke('read_config');
            const analysis = await invoke('analyze_import', { existing, data: importData });
            return new Response(JSON.stringify(analysis), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (action === 'apply') {
            const existing = await invoke('read_config');
            const resolutions = body.resolutions || {};
            const merged = await invoke('apply_import', { existing, data: importData, resolutions });
            return new Response(JSON.stringify({ ok: true, config: merged }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (parsedUrl.pathname.startsWith('/api/deps')) {
          const deps = await invoke('check_dependencies');
          return new Response(JSON.stringify(deps), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (parsedUrl.pathname.startsWith('/api/history')) {
          if (method === 'GET') {
            const history = await invoke('get_sync_history');
            return new Response(JSON.stringify({ history }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'DELETE') {
            const cleared = await invoke('clear_sync_history');
            return new Response(JSON.stringify({ ok: true, cleared }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (parsedUrl.pathname.startsWith('/api/run')) {
          const id = query.id;
          if (method === 'DELETE' && id) {
            const cancelled = await invoke('cancel_sync_job', { id });
            return new Response(JSON.stringify({ ok: cancelled }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'GET' && id) {
            const job = await invoke('get_sync_job', { id });
            return new Response(JSON.stringify(job), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'POST') {
            const job = await invoke('start_sync_job', {
              direction: body.direction,
              dryRun: !!body.dryRun,
              noDelete: !!body.noDelete,
              itemTargets: body.itemTargets || {},
            });
            return new Response(JSON.stringify(job), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (parsedUrl.pathname.startsWith('/api/remotes/terminal')) {
          const id = query.id;
          if (method === 'POST') {
            const session = await invoke('start_terminal_session', { remoteId: body.remoteId });
            return new Response(JSON.stringify({ session }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'PUT' && id) {
            const session = await invoke('write_terminal_input', { id, input: body.input });
            return new Response(JSON.stringify({ session }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'GET' && id) {
            const session = await invoke('get_terminal_session', { id });
            return new Response(JSON.stringify({ session }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'DELETE' && id) {
            const session = await invoke('close_terminal_session', { id });
            return new Response(JSON.stringify({ session }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (parsedUrl.pathname.startsWith('/api/remotes/check')) {
          const remoteId = body.remoteId;
          const result = await invoke('check_remote_connection', { remoteId });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ error: 'Endpoint not handled by TauriBridge: ' + parsedUrl.pathname }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('Tauri bridge error:', err);
        return new Response(JSON.stringify({ error: err.toString(), ok: false }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return originalFetch(url, options);
  };
}

export default function TauriBridge() {
  return null;
}
