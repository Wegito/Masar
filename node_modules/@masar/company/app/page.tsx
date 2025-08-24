import Link from 'next/link';

export default function CompanyIndex() {
    return (
        <div className="card p-6">
            <h1 className="text-xl font-semibold mb-2">Company Portal</h1>
            <p className="text-slate-300 mb-4">Upload routes, create trips, and view bookings.</p>
            <Link href="/company/login" className="btn-primary">Log in</Link>
        </div>
    );
}