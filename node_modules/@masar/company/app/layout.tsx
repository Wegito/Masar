import React from 'react';
import CompanyNav from '@masar/ui/components/CompanyNav';

export default function CompanyLayout({
                                          children,
                                      }: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ar">
        <body>
        <CompanyNav />
        <main>{children}</main>
        </body>
        </html>
    );
}
