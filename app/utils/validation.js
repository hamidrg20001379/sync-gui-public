import { getRemoteKind } from './config-helpers';

export function cleanValue(value) {
  const next = { ...value };
  for (const key of Object.keys(next)) {
    if (typeof next[key] === 'string') next[key] = next[key].trim();
  }
  return next;
}

export function validateModalValue(kind, value, modal = {}) {
  if (!/^[A-Za-z0-9._-]+$/.test(value.id || '')) throw new Error('Id can use letters, numbers, dot, dash, and underscore.');
  if (kind === 'project' && !value.root) throw new Error('Project root is required.');
  if (kind === 'remote') {
    const remoteKind = getRemoteKind(value);
    if (!['ssh', 'share', 'local'].includes(remoteKind)) throw new Error('Connection must be SSH, network share, or local folder.');
    if (remoteKind !== 'ssh' && !value.root) throw new Error('Remote root path is required.');
  }
  if (kind === 'projectStream') {
    if (!value.remoteId) throw new Error('Remote is required.');
    if (modal.globalRemoteIds && !modal.globalRemoteIds.includes(value.remoteId)) throw new Error('Remote does not exist.');
  }
  if (kind === 'mapping') {
    if (value.type !== 'file' && value.type !== 'dir') throw new Error('Mapping type must be file or folder.');
    if (!value.local) throw new Error('Local path is required.');
    if (!value.remote) throw new Error('Remote path is required.');
    if ((modal.remoteKind || 'ssh') === 'ssh' && !value.remote.startsWith('/')) throw new Error('Remote path must start with /.');
  }
}
