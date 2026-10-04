import { NextResponse } from 'next/server';
import { getProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  }

  const progress = await getProgress(id);
  if (!progress) {
    return NextResponse.json({ ok: false, error: 'Progress not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...progress });
}
