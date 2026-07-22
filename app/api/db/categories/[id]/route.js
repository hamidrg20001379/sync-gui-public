import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db.js';
import { asCategory, jsonText } from '../../../../../lib/db-api.js';

export async function GET(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const category = await db.category.findUnique({ where: { id } });

    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    return NextResponse.json({ category: asCategory(category) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;
    const body = await request.json();
    const { template_id, parent_id, variables, hidden, sort_order } = body;

    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const category = await db.category.update({
      where: { id },
      data: {
        templateId: template_id || existing.templateId,
        parentId: parent_id !== undefined ? parent_id : existing.parentId,
        variables: jsonText(variables, existing.variables),
        hidden: hidden !== undefined ? hidden : existing.hidden,
        sortOrder: sort_order !== undefined ? sort_order : existing.sortOrder
      }
    });
    return NextResponse.json({ category: asCategory(category) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const db = await getDb();
    const { id } = await params;

    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    await db.category.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
