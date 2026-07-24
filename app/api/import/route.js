import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '../../../lib/config';
import { analyzeImport, applyImport } from '../../../lib/import';

export async function POST(request) {
  try {
    const { action, data, resolutions } = await request.json();
    if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });
    if (!data) return NextResponse.json({ error: 'data is required' }, { status: 400 });

    const existing = await readConfig();

    if (action === 'analyze') {
      const analysis = analyzeImport(existing, data);
      return NextResponse.json(analysis);
    }

    if (action === 'apply') {
      if (!resolutions) return NextResponse.json({ error: 'resolutions is required' }, { status: 400 });
      const merged = applyImport(existing, data, resolutions);
      await writeConfig(merged);
      return NextResponse.json({ ok: true, config: merged });
    }

    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
