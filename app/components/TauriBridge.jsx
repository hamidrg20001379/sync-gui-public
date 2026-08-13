'use client';

if (typeof window !== 'undefined') {
  // Try to load Tauri invoke. Since this might be executed during ssr compilation or when running outside Tauri,
  // we do a try-catch to keep it safe.
  let invoke;
  try {
    invoke = require('@tauri-apps/api/core').invoke;
  } catch (e) {
    console.warn('Tauri API core load failed. Probably not running inside Tauri.', e);
  }

  if (invoke) {
    const originalFetch = window.fetch;

    window.fetch = async (url, options = {}) => {
      const urlStr = typeof url === 'string' ? url : (url.url || '');
      
      if (urlStr.startsWith('/api/')) {
        const method = (options.method || 'GET').toUpperCase();
        let body = {};
        if (options.body) {
          try {
            body = JSON.parse(options.body);
          } catch (e) {
            // ignore
          }
        }
        
        // Parse query string parameters
        const parsedUrl = new URL(urlStr, 'http://localhost');
        const query = Object.fromEntries(parsedUrl.searchParams.entries());

        try {
          if (urlStr.startsWith('/api/config')) {
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
          
          if (urlStr.startsWith('/api/export')) {
            const config = await invoke('export_config');
            return new Response(JSON.stringify({ config }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          if (urlStr.startsWith('/api/import')) {
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

          if (urlStr.startsWith('/api/deps')) {
            const deps = await invoke('check_dependencies');
            return new Response(JSON.stringify(deps), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          if (urlStr.startsWith('/api/history')) {
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

          if (urlStr.startsWith('/api/run')) {
            const id = query.id;
            if (method === 'GET' && id) {
              const job = await invoke('get_sync_job', { id });
              return new Response(JSON.stringify({ job }), {
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
              return new Response(JSON.stringify({ ok: true, job }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }

          if (urlStr.startsWith('/api/remotes/terminal')) {
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

          if (urlStr.startsWith('/api/remotes/check')) {
            const remoteId = body.remoteId;
            const result = await invoke('check_remote_connection', { remoteId });
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
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
}

export default function TauriBridge() {
  return null;
}
