export default function RoutesPage() {
    return (
        <div className="card p-6">
            <h1 className="text-xl font-semibold mb-2">Routes</h1>
            <p className="text-slate-300">Add origin/destination pairs (mock). Later we bind these to real DB routes.</p>
            <form className="mt-4 grid md:grid-cols-3 gap-3">
                <input className="input" placeholder="Origin (e.g., Tartous)" />
                <input className="input" placeholder="Destination (e.g., Damascus)" />
                <button className="btn-primary">Add (mock)</button>
            </form>
        </div>
    );
}