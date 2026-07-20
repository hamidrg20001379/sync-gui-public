import { runSync } from './sync';

const maxHistory = 100;
const store = globalThis.__syncGuiHistory || {
  nextId: 1,
  jobs: []
};
globalThis.__syncGuiHistory = store;

export function listHistory() {
  return [...store.jobs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export function getJob(id) {
  return store.jobs.find((job) => job.id === id) || null;
}

export function startSyncJob(request) {
  if (!request.targetIds?.length) throw new Error('Select at least one target.');

  const job = {
    id: String(store.nextId++),
    source: request.source || 'api',
    direction: request.direction || 'down',
    dryRun: Boolean(request.dryRun),
    noDelete: Boolean(request.noDelete),
    targetIds: request.targetIds,
    status: 'running',
    exitCode: null,
    output: '',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null
  };

  store.jobs.unshift(job);
  store.jobs = store.jobs.slice(0, maxHistory);

  runSync(job)
    .then((result) => {
      job.exitCode = result.exitCode;
      job.output = result.output || '';
      job.status = result.exitCode === 0 ? 'succeeded' : 'failed';
    })
    .catch((error) => {
      job.exitCode = 1;
      job.error = error.message;
      job.output = error.message;
      job.status = 'failed';
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });

  return job;
}
