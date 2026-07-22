import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db.js';
import { asMapping, jsonText } from '../../../../../lib/db-api.js';

export async function GET(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const mapping = await db.mapping.findUnique({ where: { id } });

    if (!mapping) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    return NextResponse.json({ mapping: asMapping(mapping) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const body = await request.json();
    const { template_id, type, variables, hidden, sort_order } = body;

    const existing = await db.mapping.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    if (type && !['file', 'dir'].includes(type)) {
      return NextResponse.json({ error: 'type must be file or dir' }, { status: 400 });
    }

    const mapping = await db.mapping.update({
      where: { id },
      data: {
        templateId: template_id || existing.templateId,
        type: type || existing.type,
        variables: jsonText(variables, existing.variables),
        hidden: hidden !== undefined ? hidden : existing.hidden,
        sortOrder: sort_order !== undefined ? sort_order : existing.sortOrder
      }
    });
    return NextResponse.json({ mapping: asMapping(mapping) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;

    const existing = await db.mapping.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    await db.mapping.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
