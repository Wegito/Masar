'use client';
import Link from 'next/link';
import Image from 'next/image';

export default function Navbar() {
    return (
        <header className="border-b border-white/5">
            <div className="container flex h-16 items-center justify-between">
                <Link href="/" className="flex items-center gap-2">
                    <Image src="/logo.svg" alt="Masar" width={28} height={28} />
                    <span className="text-lg font-semibold">Masar</span>
                </Link>
                <nav className="flex items-center gap-4">
                    <Link href="/" className="btn-ghost">Book</Link>
                    <Link href="/company" className="btn-primary">Company Portal</Link>
                </nav>
            </div>
        </header>
    );
}