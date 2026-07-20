import { NextResponse } from 'next/server';
import { readConfig } from '../../../../../lib/config';
import { startSyncJob } from '../../../../../lib/history';

async function syncProject(paramsPromise, body = {}) {
  const { projectId } = await paramsPromise;
  const config = await readConfig();
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  if (!project.syncTargets.length) throw new Error(`Project ${projectId} has no sync targets selected.`);

  return startSyncJob({
    source: 'api',
    direction: 'up',
    dryRun: Boolean(body.dryRun),
    noDelete: Boolean(body.noDelete),
    targetIds: project.syncTargets
  });
}

export async function GET(_request, { params }) {
  try {
    const result = await syncProject(params);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message, exitCode: 1, output: error.message }, { status: 400 });
  }
}

export async function POST(request, { params }) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await syncProject(params, body);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message, exitCode: 1, output: error.message }, { status: 400 });
  }
}
