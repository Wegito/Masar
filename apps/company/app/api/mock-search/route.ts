import { NextResponse } from 'next/server';
import { searchTrips } from '@/lib/mock';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const date = searchParams.get('date') || '';
    const data = searchTrips(from, to, date);
    return NextResponse.json({ data });
}