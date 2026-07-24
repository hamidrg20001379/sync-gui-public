import { execSync } from 'node:child_process';
import { platform } from 'node:os';

function check(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';

export async function GET() {
  if (platform() === 'win32') {
    const msys2Bash = process.env.SYNC_GUI_BASH || 'C:\\msys64\\usr\\bin\\bash.exe';
    const deps = { bash: false, rsync: false, sshpass: false, ssh: false };
    try {
      const out = execSync(`"${msys2Bash}" -lc "command -v bash rsync sshpass ssh"`, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
      const found = out.toString().trim().split('\n');
      for (const f of found) { deps[f.trim()] = true; }
    } catch { /* deps stay false */ }
    deps.msys2 = require('fs').existsSync(msys2Bash);
    return Response.json({ ok: Object.values(deps).every(Boolean), platform: 'win32', deps, msys2: deps.msys2 });
  }

  const tools = ['bash', 'rsync', 'sshpass', 'ssh'];
  const deps = {};
  for (const t of tools) deps[t] = check(t);
  return Response.json({ ok: Object.values(deps).every(Boolean), platform: 'linux', deps });
}
