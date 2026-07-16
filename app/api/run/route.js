import { NextResponse } from 'next/server';
import { runSync } from '../../../lib/sync';

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await runSync(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message, exitCode: 1, output: error.message }, { status: 400 });
  }
}
