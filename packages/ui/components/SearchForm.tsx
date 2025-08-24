'use client';
import { useRouter } from 'next/navigation';
import { LOCATIONS } from '@/lib/mock';

export default function SearchForm() {
    const router = useRouter();

    function onSubmit(form: FormData) {
        const from = String(form.get('from') || '');
        const to = String(form.get('to') || '');
        const date = String(form.get('date') || '');
        router.push(`/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${encodeURIComponent(date)}`);
    }

    return (
        <form action={onSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
                <label className="label">From</label>
                <select name="from" className="input">
                    {LOCATIONS.map(l => <option key={l.id}>{l.name}</option>)}
                </select>
            </div>
            <div>
                <label className="label">To</label>
                <select name="to" className="input">
                    {LOCATIONS.map(l => <option key={l.id}>{l.name}</option>)}
                </select>
            </div>
            <div>
                <label className="label">Date</label>
                <input className="input" type="date" name="date" />
            </div>
            <div className="flex items-end">
                <button className="btn-primary w-full" type="submit">Search</button>
            </div>
        </form>
    );
}