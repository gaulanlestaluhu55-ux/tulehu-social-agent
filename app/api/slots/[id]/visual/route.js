import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { uploadVisual, removeVisual } from '@/src/engine/pipeline.js';

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'File required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || 'upload.jpg';
    const slideIndex = formData.get('slideIndex');
    const slideIdx = slideIndex !== null && slideIndex !== undefined ? parseInt(slideIndex, 10) : null;

    const url = await uploadVisual(id, buffer, filename, isNaN(slideIdx) ? null : slideIdx);
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const slideIndex = searchParams.get('slideIndex');
    const slideIdx = slideIndex !== null && slideIndex !== undefined ? parseInt(slideIndex, 10) : null;

    await removeVisual(id, isNaN(slideIdx) ? null : slideIdx);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
