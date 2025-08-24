import Link from 'next/link';
import Pill from './Pill';
import { currency, fmtTime } from '@/lib/utils';
import type { Trip } from '@/lib/mock';

export default function TripCard({ trip }: { trip: Trip }) {
    return (
        <div className="card p-4 flex items-center justify-between">
            <div>
                <div className="text-sm text-slate-300">{trip.company}</div>
                <div className="text-xl font-semibold">{trip.origin} → {trip.destination}</div>
                <div className="text-sm text-slate-400">{fmtTime(trip.dep_time)} • Arr {fmtTime(trip.arr_time)}</div>
                <div className="mt-2 flex gap-2">
                    <Pill>{trip.seats_left} seats left</Pill>
                </div>
            </div>
            <div className="text-right">
                <div className="text-2xl font-bold">{currency(trip.price_cents)}</div>
                <Link href={`/trip/${trip.id}`} className="btn-primary mt-2 inline-block">Details</Link>
            </div>
        </div>
    );
}