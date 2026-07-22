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
