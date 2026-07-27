import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readConfig } from '../../../../lib/config.js';
import { resolveBashPath, runtimeToolEnv } from '../../../../lib/runtime-tools.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { remoteId } = await request.json();
    const config = await readConfig();
    const remote = config.remotes.find(r => r.id === remoteId);
    if (!remote) return Response.json({ ok: false, error: 'Remote not found.' }, { status: 404 });

    if (remote.kind === 'ssh') {
      const result = await checkSsh(remote);
      return Response.json(result, { status: result.ok ? 200 : 400 });
    }

    const root = remote.root || remote.path;
    if (!root) return Response.json({ ok: false, error: 'Local remote has no root path.' }, { status: 400 });
    await access(path.resolve(root));
    return Response.json({ ok: true, message: 'Local path is reachable.' });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
}

function checkSsh(remote) {
  return new Promise(resolve => {
    if (!remote.host || !remote.username) {
      resolve({ ok: false, error: 'SSH remote needs host and username.' });
      return;
    }

    const bash = resolveBashPath();
    const ssh = [
      'sshpass -e ssh',
      `-p ${shq(String(remote.port || 22))}`,
      '-o BatchMode=no',
      '-o ConnectTimeout=5',
      '-o StrictHostKeyChecking=accept-new',
      shq(`${remote.username}@${remote.host}`),
      shq('printf ok')
    ].join(' ');

    const env = runtimeToolEnv({ SSHPASS: remote.password || '' });
    const child = spawn(bash, ['-lc', ssh], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
    });

    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    child.on('error', error => resolve({ ok: false, error: error.message }));
    child.on('close', code => {
      if (code === 0 && output.includes('ok')) resolve({ ok: true, message: 'SSH connection works.' });
      else resolve({ ok: false, error: output.trim() || `SSH exited with code ${code ?? 1}.` });
    });
  });
}

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
