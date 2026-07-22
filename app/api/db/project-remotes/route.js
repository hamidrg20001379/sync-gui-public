import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db.js';
import { asProjectRemote } from '../../../../lib/db-api.js';

export async function GET(request) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const project_id = url.searchParams.get('project_id');

    let projectRemotes;
    if (project_id) {
      projectRemotes = await db.projectRemote.findMany({ where: { projectId: project_id } });
    } else {
      projectRemotes = await db.projectRemote.findMany();
    }

    return NextResponse.json({ projectRemotes: projectRemotes.map(asProjectRemote) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();
    const { id, project_id, remote_id, name } = body;

    if (!id || !project_id || !remote_id || !name) {
      return NextResponse.json({ error: 'id, project_id, remote_id, and name are required' }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id: project_id } });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const remote = await db.remote.findUnique({ where: { id: remote_id } });
    if (!remote) {
      return NextResponse.json({ error: 'Remote not found' }, { status: 404 });
    }

    const projectRemote = await db.projectRemote.create({
      data: { id, projectId: project_id, remoteId: remote_id, name }
    });
    return NextResponse.json({ projectRemote: asProjectRemote(projectRemote) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
