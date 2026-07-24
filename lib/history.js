import { runSync } from './sync';

const maxHistory = 100;
const store = globalThis.__syncGuiHistory ??= { nextId: 1, jobs: [] };

export function listHistory() {
  return [...store.jobs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export function getJob(id) {
  return store.jobs.find(j => j.id === id) || null;
}

export function startSyncJob(request) {
  const job = {
    id: String(store.nextId++),
    direction: request.direction || 'up',
    dryRun: Boolean(request.dryRun),
    noDelete: Boolean(request.noDelete),
    itemIds: request.itemIds || [],
    status: 'running',
    exitCode: null,
    output: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  store.jobs.unshift(job);
  store.jobs = store.jobs.slice(0, maxHistory);

  runSync({ direction: job.direction, dryRun: job.dryRun, noDelete: job.noDelete, itemIds: job.itemIds })
    .then(r => { job.exitCode = r.exitCode; job.output = r.output; job.status = r.exitCode === 0 ? 'succeeded' : 'failed'; })
    .catch(e => { job.exitCode = 1; job.output = e.message; job.status = 'failed'; })
    .finally(() => { job.finishedAt = new Date().toISOString(); });

  return job;
}
