import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db.js';
import { asProject, asRemote, asTemplate } from '../../../lib/db-api.js';

export async function GET() {
  try {
    const db = await getDb();
    const templates = await db.template.findMany();
    const projects = await db.project.findMany();
    const remotes = await db.remote.findMany();

    return NextResponse.json({
      ok: true,
      counts: {
        templates: templates.length,
        projects: projects.length,
        remotes: remotes.length
      },
      templates: templates.map(asTemplate),
      projects: projects.map(asProject),
      remotes: remotes.map(asRemote)
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
