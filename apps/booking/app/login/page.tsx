export default function Login() {
    return (
        <div className="max-w-md mx-auto card p-6">
            <h1 className="text-xl font-semibold mb-4">Log in</h1>
            <form className="grid gap-3">
                <div>
                    <label className="label">Email</label>
                    <input className="input" type="email" placeholder="you@company.com" />
                </div>
                <div>
                    <label className="label">Password</label>
                    <input className="input" type="password" />
                </div>
                <button className="btn-primary">Continue</button>
            </form>
        </div>
    );
}