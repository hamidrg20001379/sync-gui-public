import { NextResponse } from 'next/server';
import { getJob, startSyncJob } from '../../../lib/history';
import { preflightSync } from '../../../lib/preflight';
import { readConfig } from '../../../lib/config';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: `Unknown job: ${id}` }, { status: 404 });
  return NextResponse.json(job);
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.preflight !== false && body.direction !== 'down' && !body.dryRun) {
      const config = await readConfig();
      const itemTargets = body.itemTargets || Object.fromEntries(
        (body.itemIds || []).map(itemId => [itemId, []]),
      );
      try {
        const preflight = await preflightSync({ config, direction: 'up', itemTargets });
        if (!preflight.safe) {
          return NextResponse.json({ error: 'Upload blocked by preflight.', preflight }, { status: 409 });
        }
      } catch (error) {
        if (body.preflight === true) throw error;
      }
    }
    const job = startSyncJob(body);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
