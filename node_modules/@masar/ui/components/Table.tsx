export default function Table({ headers, rows }: { headers: string[]; rows: (string | number | React.ReactNode)[][]; }) {
    return (
        <div className="overflow-x-auto card">
            <table className="w-full text-sm">
                <thead className="text-left text-slate-300">
                <tr>{headers.map(h => <th key={h} className="px-4 py-3 border-b border-white/10">{h}</th>)}</tr>
                </thead>
                <tbody>
                {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-white/5">
                        {r.map((c, j) => <td key={j} className="px-4 py-3 border-b border-white/5">{c}</td>)}
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}