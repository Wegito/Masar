export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const currency = (cents: number, currency = 'SYP') =>
    new Intl.NumberFormat('ar-SY', { style: 'currency', currency }).format(cents / 100);


export const fmtTime = (iso: string) => new Date(iso).toLocaleString('de-DE', {
    weekday: 'short', hour: '2-digit', minute: '2-digit'
});