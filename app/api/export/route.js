import { NextResponse } from 'next/server';
import { readConfig } from '../../../lib/config';

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
