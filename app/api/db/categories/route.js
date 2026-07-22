import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db.js';
import { asCategory, jsonText } from '../../../../lib/db-api.js';

export async function GET(request) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const project_remote_id = url.searchParams.get('project_remote_id');

    let categories;
    if (project_remote_id) {
      categories = await db.category.findMany({ where: { projectRemoteId: project_remote_id } });
    } else {
      categories = await db.category.findMany();
    }

    return NextResponse.json({ categories: categories.map(asCategory) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();
    const { id, project_remote_id, template_id, parent_id, variables, hidden, sort_order } = body;

    if (!id || !project_remote_id || !template_id) {
      return NextResponse.json({ error: 'id, project_remote_id, and template_id are required' }, { status: 400 });
    }

    const projectRemote = await db.projectRemote.findUnique({ where: { id: project_remote_id } });
    if (!projectRemote) {
      return NextResponse.json({ error: 'Project remote not found' }, { status: 404 });
    }

    const template = await db.template.findUnique({ where: { id: template_id } });
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    if (parent_id) {
      const parent = await db.category.findUnique({ where: { id: parent_id } });
      if (!parent) {
        return NextResponse.json({ error: 'Parent category not found' }, { status: 404 });
      }
    }

    const category = await db.category.create({
      data: {
        id,
        projectRemoteId: project_remote_id,
        templateId: template_id,
        parentId: parent_id || null,
        variables: jsonText(variables, '{}'),
        hidden: hidden || 0,
        sortOrder: sort_order || 0
      }
    });
    return NextResponse.json({ category: asCategory(category) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
