export default function NewTrip() {
    return (
        <div className="max-w-2xl card p-6">
            <h1 className="text-xl font-semibold mb-4">Create Trip</h1>
            <form className="grid gap-3">
                <div>
                    <label className="label">Route</label>
                    <input className="input" placeholder="Tartous → Damascus" />
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                    <div>
                        <label className="label">Departure</label>
                        <input className="input" type="datetime-local" />
                    </div>
                    <div>
                        <label className="label">Arrival</label>
                        <input className="input" type="datetime-local" />
                    </div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                    <div>
                        <label className="label">Price (EUR)</label>
                        <input className="input" type="number" placeholder="35.00" />
                    </div>
                    <div>
                        <label className="label">Seats</label>
                        <input className="input" type="number" placeholder="45" />
                    </div>
                    <div>
                        <label className="label">Bus Name</label>
                        <input className="input" placeholder="Masar-01" />
                    </div>
                </div>
                <button className="btn-primary">Save (mock)</button>
            </form>
        </div>
    );
}