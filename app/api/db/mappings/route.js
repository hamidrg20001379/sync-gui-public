import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db.js';
import { asMapping, jsonText } from '../../../../lib/db-api.js';

export async function GET(request) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const category_id = url.searchParams.get('category_id');

    let mappings;
    if (category_id) {
      mappings = await db.mapping.findMany({ where: { categoryId: category_id } });
    } else {
      mappings = await db.mapping.findMany();
    }

    return NextResponse.json({ mappings: mappings.map(asMapping) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();
    const { id, category_id, template_id, type, variables, hidden, sort_order } = body;

    if (!id || !category_id || !template_id || !type) {
      return NextResponse.json({ error: 'id, category_id, template_id, and type are required' }, { status: 400 });
    }

    if (!['file', 'dir'].includes(type)) {
      return NextResponse.json({ error: 'type must be file or dir' }, { status: 400 });
    }

    const category = await db.category.findUnique({ where: { id: category_id } });
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const template = await db.template.findUnique({ where: { id: template_id } });
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const mapping = await db.mapping.create({
      data: {
        id,
        categoryId: category_id,
        templateId: template_id,
        type,
        variables: jsonText(variables, '{}'),
        hidden: hidden || 0,
        sortOrder: sort_order || 0
      }
    });
    return NextResponse.json({ mapping: asMapping(mapping) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
