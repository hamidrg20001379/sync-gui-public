import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db.js';
import { asProject } from '../../../../lib/db-api.js';

export async function GET() {
  try {
    const db = await getDb();
    const projects = (await db.project.findMany()).map(asProject);
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();
    const { id, name, root_path } = body;

    if (!id || !name || !root_path) {
      return NextResponse.json({ error: 'id, name, and root_path are required' }, { status: 400 });
    }

    const project = await db.project.create({
      data: { id, name, rootPath: root_path }
    });
    return NextResponse.json({ project: asProject(project) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
