import Table from '@/components/Table';
import { TRIPS } from '@/lib/mock';
import Link from 'next/link';

export default function Dashboard() {
    const rows = TRIPS.map(t => [
        t.id,
        `${t.origin} → ${t.destination}`,
        new Date(t.dep_time).toLocaleString(),
        t.company,
        `${t.seats_left}`,
        <Link key={t.id} className="btn-ghost" href={`/company/trips/${t.id}`}>Edit</Link>
    ]);
    return (
        <div className="grid gap-4">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">Your Trips</h1>
                <Link className="btn-primary" href="/company/trips/new">Create Trip</Link>
            </div>
            <Table headers={["ID","Route","Departure","Company","Seats Left","Actions"]} rows={rows} />
        </div>
    );
}