import TripCard from '@/components/TripCard';
import { searchTrips } from '@/lib/mock';

export default function SearchPage({ searchParams }: { searchParams: { from?: string; to?: string; date?: string } }) {
    const { from = 'Tartous', to = 'Damascus', date = '' } = searchParams || {};
    const results = searchTrips(from, to, date);

    return (
        <div className="grid gap-4">
            <h2 className="text-xl">Results for <b>{from}</b> → <b>{to}</b>{date ? ` on ${date}` : ''}</h2>
            {results.length === 0 && (
                <div className="card p-6 text-slate-300">No trips found. Try another date or route.</div>
            )}
            <div className="grid gap-3">
                {results.map(t => <TripCard key={t.id} trip={t} />)}
            </div>
        </div>
    );
}