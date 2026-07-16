import { NextResponse } from 'next/server';
import { configPath, envPath, flattenMappings, readConfig, writeConfig } from '../../../lib/config';
import { checkConfig } from '../../../lib/sync';

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({ config, rows: flattenMappings(config), paths: { configPath, envPath } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const config = await request.json();
    await writeConfig(config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await checkConfig(body.targetIds || body.mappingKeys || []);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message, exitCode: 1, output: error.message }, { status: 400 });
  }
}
