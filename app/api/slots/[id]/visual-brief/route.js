import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { generateVisualBrief } from '@/src/engine/pipeline.js';

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const result = await generateVisualBrief(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
