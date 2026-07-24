import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { access } from 'node:fs/promises';

function check(cmd) {
  return new Promise(resolve => {
    exec(`command -v ${cmd}`, { timeout: 2000 }, err => resolve(!err));
  });
}

export const dynamic = 'force-dynamic';

export async function GET() {
  if (platform() === 'win32') {
    const msys2Bash = process.env.SYNC_GUI_BASH || 'C:\\msys64\\usr\\bin\\bash.exe';
    let msys2 = false;
    try { await access(msys2Bash); msys2 = true; } catch {}
    const deps = { bash: false, rsync: false, sshpass: false, ssh: false };
    if (msys2) {
      try {
        const out = await new Promise((resolve, reject) => {
          exec(`"${msys2Bash}" -lc "command -v bash rsync sshpass ssh"`, { timeout: 5000 }, (err, stdout) => {
            if (err) reject(err); else resolve(stdout);
          });
        });
        for (const f of out.trim().split('\n')) deps[f.trim()] = true;
      } catch { /* deps stay false */ }
    }
    return Response.json({ ok: Object.values(deps).every(Boolean), platform: 'win32', deps, msys2 });
  }

  const tools = ['bash', 'rsync', 'sshpass', 'ssh'];
  const deps = {};
  for (const t of tools) deps[t] = await check(t);
  return Response.json({ ok: Object.values(deps).every(Boolean), platform: 'linux', deps });
}
