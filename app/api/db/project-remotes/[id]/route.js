import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db.js';
import { asProjectRemote } from '../../../../../lib/db-api.js';

export async function GET(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const projectRemote = await db.projectRemote.findUnique({ where: { id } });

    if (!projectRemote) {
      return NextResponse.json({ error: 'Project remote not found' }, { status: 404 });
    }

    return NextResponse.json({ projectRemote: asProjectRemote(projectRemote) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const body = await request.json();
    const { name } = body;

    const existing = await db.projectRemote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Project remote not found' }, { status: 404 });
    }

    const projectRemote = await db.projectRemote.update({
      where: { id },
      data: { name: name || existing.name }
    });
    return NextResponse.json({ projectRemote: asProjectRemote(projectRemote) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;

    const existing = await db.projectRemote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Project remote not found' }, { status: 404 });
    }

    await db.projectRemote.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
