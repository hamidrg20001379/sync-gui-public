import { NextResponse } from 'next/server';
import { readConfig } from '../../../lib/config';
import { preflightSync, trustCurrentState } from '../../../lib/preflight';

export async function POST(request) {
  try {
    const body = await request.json();
    const config = await readConfig();
    const itemTargets = body.itemTargets || Object.fromEntries(
      (body.itemIds || []).map(itemId => [itemId, []]),
    );
    const options = { config, direction: body.direction || 'up', itemTargets };
    if (body.action === 'trust') {
      return NextResponse.json(await trustCurrentState(options));
    }
    return NextResponse.json(await preflightSync(options));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
