export type Location = { id: string; name: string };
export type Trip = {
    id: string;
    origin: string; destination: string;
    dep_time: string; arr_time: string;
    price_cents: number; seats_left: number; company: string;
};

export const LOCATIONS: Location[] = [
    { id: 'tartous', name: 'Tartous' },
    { id: 'damascus', name: 'Damascus' },
    { id: 'aleppo', name: 'Aleppo' },
    { id: 'homs', name: 'Homs' }
];

export const TRIPS: Trip[] = [
    {
        id: 'T-101', origin: 'Tartous', destination: 'Damascus',
        dep_time: new Date(Date.now()+ 3*3600000).toISOString(),
        arr_time: new Date(Date.now()+ 6*3600000).toISOString(),
        price_cents: 3500, seats_left: 7, company: 'Masar Lines'
    },
    {
        id: 'T-102', origin: 'Tartous', destination: 'Damascus',
        dep_time: new Date(Date.now()+ 5*3600000).toISOString(),
        arr_time: new Date(Date.now()+ 8*3600000).toISOString(),
        price_cents: 4200, seats_left: 2, company: 'Levant Express'
    },
    {
        id: 'T-201', origin: 'Damascus', destination: 'Aleppo',
        dep_time: new Date(Date.now()+ 4*3600000).toISOString(),
        arr_time: new Date(Date.now()+ 10*3600000).toISOString(),
        price_cents: 6000, seats_left: 12, company: 'SyraBus'
    }
];

export const searchTrips = (from: string, to: string, date: string) => {
    const f = from?.toLowerCase?.();
    const t = to?.toLowerCase?.();
    return TRIPS.filter(x =>
        x.origin.toLowerCase() === f && x.destination.toLowerCase() === t
    );
};