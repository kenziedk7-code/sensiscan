import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { resetPasswordFn } from "~/lib/server-fns";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  validateSearch: (search: Record<string, string>) => ({
    token: search.token || "",
  }),
});

function ResetPassword() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // If no token in URL, show error immediately
  const noToken = !token;

  useEffect(() => {
    if (noToken) {
      setError("Missing reset token. Please use the link from your email.");
    }
  }, [noToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      await resetPasswordFn({ data: { token, newPassword } });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <Link to="/" className="text-2xl font-bold text-indigo-600">
            SensiScan
          </Link>
          <div className="mt-8 rounded-xl bg-green-50 p-6">
            <span className="text-3xl">✅</span>
            <h1 className="mt-3 text-xl font-bold text-green-800">
              Password reset!
            </h1>
            <p className="mt-2 text-sm text-green-700">
              Your password has been updated. You can now log in with your new
              password.
            </p>
          </div>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Log in
          </Link>
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
          <h1 className="mt-4 text-2xl font-bold">Set a new password</h1>
          <p className="mt-1 text-sm text-gray-500">
            Choose a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {noToken && (
            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-700">
              No reset token found.{" "}
              <Link
                to="/forgot-password"
                className="font-medium underline hover:text-yellow-800"
              >
                Request a new reset link
              </Link>
              .
            </div>
          )}

          <div>
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium text-gray-700"
            >
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="At least 6 characters"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-gray-700"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Re-enter your new password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || noToken}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Resetting..." : "Reset password"}
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
