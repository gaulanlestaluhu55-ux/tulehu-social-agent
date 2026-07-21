import { NextResponse } from 'next/server';
import { getSession } from '../../lib/auth.js';
import { supabase } from '../../../../src/db/supabase.js';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from('publish_queue')
      .select('*')
      .order('scheduled_at', { ascending: true });

    if (error) throw new Error(error.message);
    return NextResponse.json({ queue: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('publish_queue')
      .delete()
      .eq('id', id)
      .eq('status', 'pending');

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
