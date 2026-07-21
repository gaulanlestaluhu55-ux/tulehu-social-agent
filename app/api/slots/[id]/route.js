import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { getSlotDetail } from '@/src/engine/pipeline.js';

export async function GET(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const slot = await getSlotDetail(id);
    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }
    return NextResponse.json({ slot });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
