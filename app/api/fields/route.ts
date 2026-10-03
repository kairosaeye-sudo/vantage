import { NextResponse } from 'next/server';
import { listFields } from '@/lib/field-from-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const fields = await listFields();
    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to list fields' },
      { status: 500 }
    );
  }
}
