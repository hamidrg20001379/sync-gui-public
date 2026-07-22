import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db.js';
import { asRemote, jsonText } from '../../../../../lib/db-api.js';

export async function GET(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const remote = await db.remote.findUnique({ where: { id } });

    if (!remote) {
      return NextResponse.json({ error: 'Remote not found' }, { status: 404 });
    }

    return NextResponse.json({ remote: asRemote(remote) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const body = await request.json();
    const { name, kind, root_path, config_json } = body;

    const existing = await db.remote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Remote not found' }, { status: 404 });
    }

    if (kind && !['ssh', 'local', 'share'].includes(kind)) {
      return NextResponse.json({ error: 'kind must be ssh, local, or share' }, { status: 400 });
    }

    const remote = await db.remote.update({
      where: { id },
      data: {
        name: name || existing.name,
        kind: kind || existing.kind,
        rootPath: root_path !== undefined ? root_path : existing.rootPath,
        configJson: jsonText(config_json, existing.configJson)
      }
    });
    return NextResponse.json({ remote: asRemote(remote) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;

    const existing = await db.remote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Remote not found' }, { status: 404 });
    }

    await db.remote.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
