import { NextResponse } from 'next/server';
import { readConfig } from '../../../lib/config';
import { getPostCommitHook, setPostCommitHook } from '../../../lib/git-hooks';

function findItem(config, itemId) {
  const item = config.items.find(candidate => candidate.id === itemId);
  if (!item) throw new Error(`Unknown sync item: ${itemId}`);
  return item;
}

export async function GET(request) {
  try {
    const config = await readConfig();
    const ids = new URL(request.url).searchParams.getAll('itemId');
    const hooks = await Promise.all(ids.map(async itemId => {
      try {
        return await getPostCommitHook(findItem(config, itemId));
      } catch (error) {
        return { itemId, installed: false, error: error.message };
      }
    }));
    return NextResponse.json({ hooks });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request) {
  try {
    const { itemId, action } = await request.json();
    const config = await readConfig();
    const hook = await setPostCommitHook(findItem(config, itemId), action);
    return NextResponse.json({ hook });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
