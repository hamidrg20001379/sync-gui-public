import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readConfig } from '../../../../lib/config.js';
import { prepareSshAuth, sshInvocation, sshShellPathPrefix } from '../../../../lib/ssh.js';

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

async function checkSsh(remote) {
  if (!remote.host || !remote.username) {
    return { ok: false, error: 'SSH remote needs host and username.' };
  }

  const auth = await prepareSshAuth(remote.password);
  return new Promise(resolve => {
    const bash = process.env.SYNC_GUI_BASH || (process.platform === 'win32' ? 'C:\\msys64\\usr\\bin\\bash.exe' : 'bash');
    const ssh = [
      sshInvocation(Boolean(remote.password)),
      `-p ${shq(String(remote.port || 22))}`,
      '-o BatchMode=no',
      '-o ConnectTimeout=5',
      '-o StrictHostKeyChecking=accept-new',
      process.env.SYNC_GUI_KNOWN_HOSTS ? `-o UserKnownHostsFile=${shq(process.env.SYNC_GUI_KNOWN_HOSTS)}` : '',
      shq(`${remote.username}@${remote.host}`),
      shq('printf ok')
    ].filter(Boolean).join(' ');

    const child = spawn(bash, ['-lc', `${sshShellPathPrefix()}\n${ssh}`], {
      cwd: process.cwd(),
      env: { ...process.env, ...auth.env, SSHPASS: remote.password || '' },
      windowsHide: true,
    });

    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    child.on('error', error => auth.cleanup().finally(() => resolve({ ok: false, error: error.message })));
    child.on('close', code => {
      const result = code === 0 && output.includes('ok')
        ? { ok: true, message: 'SSH connection works.' }
        : { ok: false, error: output.trim() || `SSH exited with code ${code ?? 1}.` };
      auth.cleanup().finally(() => resolve(result));
    });
  });
}

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
