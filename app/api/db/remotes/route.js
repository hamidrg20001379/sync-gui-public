import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db.js';
import { asRemote, jsonText } from '../../../../lib/db-api.js';

export async function GET() {
  try {
    const db = await getDb();
    const remotes = (await db.remote.findMany()).map(asRemote);
    return NextResponse.json({ remotes });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();
    const { id, name, kind, root_path, config_json } = body;

    if (!id || !name || !kind) {
      return NextResponse.json({ error: 'id, name, and kind are required' }, { status: 400 });
    }

    if (!['ssh', 'local', 'share'].includes(kind)) {
      return NextResponse.json({ error: 'kind must be ssh, local, or share' }, { status: 400 });
    }

    const remote = await db.remote.create({
      data: {
        id,
        name,
        kind,
        rootPath: root_path || null,
        configJson: jsonText(config_json, '{}')
      }
    });
    return NextResponse.json({ remote: asRemote(remote) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
