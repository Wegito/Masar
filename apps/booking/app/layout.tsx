import React from 'react';
import './globals.css';
import BookingNav from '@masar/ui/components/BookingNav';

export default function BookingLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ar" dir="rtl">
        <body>
        <BookingNav />
        <main className="container py-8">{children}</main>
        </body>
        </html>
    );
}
