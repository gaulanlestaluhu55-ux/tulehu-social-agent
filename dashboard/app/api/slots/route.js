import { NextResponse } from 'next/server';
import { getSession } from '../../lib/auth.js';
import { createSlot, listSlots } from '../../../../src/engine/pipeline.js';

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to params required' }, { status: 400 });
    }

    const slots = await listSlots(from, to);
    return NextResponse.json({ slots });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { slots } = await request.json();

    if (!Array.isArray(slots) || slots.length === 0) {
      return NextResponse.json({ error: 'slots array required' }, { status: 400 });
    }

    const created = [];
    for (const slot of slots) {
      const result = await createSlot(slot.date, slot.time, slot.pillar);
      created.push(result);
    }

    return NextResponse.json({ slots: created });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
