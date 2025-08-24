import { TRIPS } from '@/lib/mock';
import { currency, fmtTime } from '@/lib/utils';

export default function TripDetail({ params }: { params: { id: string } }) {
    const trip = TRIPS.find(t => t.id === params.id);
    if (!trip) return <div className="card p-6">Trip not found.</div>;
    return (
        <div className="grid gap-4">
            <div className="card p-6">
                <h1 className="text-2xl font-semibold">{trip.origin} → {trip.destination}</h1>
                <div className="text-slate-300">Dep {fmtTime(trip.dep_time)} • Arr {fmtTime(trip.arr_time)}</div>
                <div className="mt-4 text-3xl font-bold">{currency(trip.price_cents)}</div>
                <div className="mt-6"><button className="btn-primary">Reserve Seat (mock)</button></div>
            </div>
        </div>
    );
}