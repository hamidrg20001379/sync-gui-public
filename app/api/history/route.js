import { NextResponse } from 'next/server';
import { listHistory } from '../../../lib/history';

export async function GET() {
  return NextResponse.json({ history: listHistory() });
}
