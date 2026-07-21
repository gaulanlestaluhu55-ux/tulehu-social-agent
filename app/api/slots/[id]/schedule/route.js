import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { scheduleSlot } from '@/src/engine/pipeline.js';

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const { scheduledAt } = await request.json();

    if (!scheduledAt) {
      return NextResponse.json({ error: 'scheduledAt required' }, { status: 400 });
    }

    await scheduleSlot(id, scheduledAt);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
