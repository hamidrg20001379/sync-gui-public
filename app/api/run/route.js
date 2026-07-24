import { NextResponse } from 'next/server';
import { getJob, startSyncJob } from '../../../lib/history';

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
    const job = startSyncJob(body);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
