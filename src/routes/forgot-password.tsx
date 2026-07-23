import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { requestPasswordResetFn } from "~/lib/server-fns";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await requestPasswordResetFn({ data: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <Link to="/" className="text-2xl font-bold text-indigo-600">
            SensiScan
          </Link>
          <div className="mt-8 rounded-xl bg-green-50 p-6">
            <span className="text-3xl">📧</span>
            <h1 className="mt-3 text-xl font-bold text-green-800">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-green-700">
              If an account exists for <strong>{email}</strong>, we've sent a
              password reset link. It expires in 1 hour.
            </p>
          </div>
          <div className="mt-6 space-y-3">
            <button
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Try a different email
            </button>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
              Back to log in
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Link to="/" className="text-2xl font-bold text-indigo-600">
            SensiScan
          </Link>
          <h1 className="mt-4 text-2xl font-bold">Forgot your password?</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          <Link
            to="/login"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Back to log in
          </Link>
        </p>
      </div>
    </main>
  );
}
