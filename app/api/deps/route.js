import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { access } from 'node:fs/promises';
import { bundledWindowsToolStatus, resolveBashPath, runtimeToolEnv } from '../../../lib/runtime-tools.mjs';

function commandExists(command, locationOutput) {
  return locationOutput.split(/\r?\n/).some((line) => {
    const normalized = line.trim().replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith(`/${command.toLowerCase()}`) || normalized.endsWith(`/${command.toLowerCase()}.exe`);
  });
}

function check(cmd) {
  return new Promise(resolve => {
    exec(`command -v ${cmd}`, { timeout: 2000 }, err => resolve(!err));
  });
}

export const dynamic = 'force-dynamic';

export async function GET() {
  if (platform() === 'win32') {
    const msys2Bash = resolveBashPath();
    const bundledStatus = bundledWindowsToolStatus();
    let msys2 = false;
    try { await access(msys2Bash); msys2 = true; } catch {}
    const deps = { bash: false, rsync: false, sshpass: false, ssh: false };
    if (msys2) {
      try {
        const out = await new Promise((resolve, reject) => {
          exec(`"${msys2Bash}" -lc "command -v bash rsync sshpass ssh"`, { timeout: 5000, env: runtimeToolEnv() }, (err, stdout) => {
            if (err) reject(err); else resolve(stdout);
          });
        });
        for (const command of Object.keys(deps)) {
          deps[command] = commandExists(command, out);
        }
      } catch { /* deps stay false */ }
    }
    return Response.json({
      ok: Object.values(deps).every(Boolean),
      platform: 'win32',
      deps,
      msys2,
      bundled: bundledStatus.bundled,
    });
  }

  const tools = ['bash', 'rsync', 'sshpass', 'ssh'];
  const deps = {};
  for (const t of tools) deps[t] = await check(t);
  return Response.json({ ok: Object.values(deps).every(Boolean), platform: 'linux', deps });
}
