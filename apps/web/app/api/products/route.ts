import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || 'http://api:4000';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get('limit') || '50';
  const active = searchParams.get('active');
  const q = searchParams.get('q');
  
  let url = `${API_BASE}/v1/products?limit=${limit}`;
  if (active) url += `&active=${active}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.API_BEARER_TOKEN || 'aldegol'}`,
      },
    });
    
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch products' }, { status: res.status });
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Products API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
