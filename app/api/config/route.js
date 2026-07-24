import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '../../../lib/config';

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { config } = await request.json();
    await writeConfig(config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
