import { NextResponse } from 'next/server';
import { createToken } from '@/lib/auth.js';

export async function POST(request) {
  try {
    const { password } = await request.json();
    const token = await createToken(password);

    if (!token) {
      return NextResponse.json({ error: 'Password salah' }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('tulehu_dashboard_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
