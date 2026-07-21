import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { generateIdeaForSlot, selectIdea } from '@/src/engine/pipeline.js';

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const ideas = await generateIdeaForSlot(id);
    return NextResponse.json({ ideas });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const { selectedIndex } = await request.json();
    await selectIdea(id, selectedIndex);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
