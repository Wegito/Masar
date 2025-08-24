'use client';
import Link from 'next/link';

export default function CompanyNav() {
    return (
        <div className="container py-4 flex items-center gap-2 text-sm">
            <Link className="btn-ghost" href="/company/dashboard">Dashboard</Link>
            <Link className="btn-ghost" href="/company/routes">Routes</Link>
            <Link className="btn-ghost" href="/company/trips/new">New Trip</Link>
        </div>
    );
}