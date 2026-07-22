import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db.js';
import { asTemplate } from '../../../../lib/db-api.js';

export async function GET() {
  try {
    const db = await getDb();
    const templates = (await db.template.findMany()).map(asTemplate);
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();
    const { id, name, relative_path, relative_remote_path, variable_keys, hidden } = body;
    if (!id || !name) return NextResponse.json({ error: 'id and name are required' }, { status: 400 });
    const template = await db.template.create({
      data: {
        id,
        name,
        relativePath: relative_path || '',
        relativeRemotePath: relative_remote_path || '',
        variableKeys: typeof variable_keys === 'string' ? variable_keys : JSON.stringify(variable_keys || []),
        hidden: Number(hidden || 0)
      }
    });
    return NextResponse.json({ template: asTemplate(template) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
