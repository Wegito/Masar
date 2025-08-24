'use client';
import Link from 'next/link';
import Image from 'next/image';

export default function BookingNav() {
    return (
        <header className="border-b border-white/5">
            <div className="container flex h-16 items-center justify-between">
                <Link href="/" className="flex items-center gap-2">
                    <Image src="/logo.svg" alt="مسار" width={28} height={28} />
                    <span className="text-lg font-semibold">مسار</span>
                </Link>
                <nav className="flex items-center gap-2">
                    <Link href="/" className="btn-ghost">احجز</Link>
                    <Link href="/search" className="btn-ghost">بحث</Link>
                </nav>
            </div>
        </header>
    );
}
