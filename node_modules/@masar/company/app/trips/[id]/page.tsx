import { TRIPS } from '@/lib/mock';

export default function EditTrip({ params }: { params: { id: string } }) {
    const trip = TRIPS.find(t => t.id === params.id);
    if (!trip) return <div className="card p-6">Trip not found.</div>;
    return (
        <div className="max-w-2xl card p-6">
            <h1 className="text-xl font-semibold mb-4">Edit Trip {trip.id}</h1>
            <form className="grid gap-3">
                <input className="input" defaultValue={`${trip.origin} → ${trip.destination}`} />
                <input className="input" type="datetime-local" />
                <input className="input" type="datetime-local" />
                <input className="input" type="number" defaultValue={trip.price_cents/100} />
                <input className="input" type="number" defaultValue={trip.seats_left} />
                <button className="btn-primary">Update (mock)</button>
            </form>
        </div>
    );
}