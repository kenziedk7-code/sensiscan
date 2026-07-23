import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createCheckoutSessionFn, getSubscriptionStatusFn } from "~/lib/server-fns";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
});

function getToken(): string {
  return localStorage.getItem("sensiskan_token") || "";
}

function getStoredUser(): { id: number; email: string; name: string } | null {
  const raw = localStorage.getItem("sensiskan_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function Pricing() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getStoredUser() : null;
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const u = getStoredUser();
    setIsLoggedIn(!!u);

    if (u) {
      checkSubscription();
    }
  }, []);

  async function checkSubscription() {
    try {
      const token = getToken();
      const result = await getSubscriptionStatusFn({ data: { token } });
      setIsPro(result.isPro);
    } catch {
      // Silently fail
    }
  }

  async function handleSubscribe() {
    if (!isLoggedIn) {
      navigate({ to: "/signup" });
      return;
    }

    setLoading(true);
    setError("");
    try {
      const token = getToken();
      const result = await createCheckoutSessionFn({ data: { token } });
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-xl font-bold text-indigo-600">
            SensiScan
          </Link>
          <nav className="flex gap-3 text-sm">
            {isLoggedIn ? (
              <>
                <Link
                  to="/dashboard"
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
                >
                  Dashboard
                </Link>
                <Link
                  to="/account"
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
                >
                  Account
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
                >
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Unlock SensiScan Pro
          </h1>
          <p className="mt-3 text-lg text-gray-600">
            Get unlimited scans, meal plans, and sensitivity tracking.
          </p>
        </div>

        {error && (
          <div className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        {/* Pricing Card */}
        <div className="mt-12 rounded-2xl bg-white p-8 shadow-lg border-2 border-indigo-500">
          <div className="text-center">
            <span className="inline-block rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">
              Monthly Plan
            </span>
            <div className="mt-4">
              <span className="text-5xl font-bold text-gray-900">$9.99</span>
              <span className="text-gray-500">/month</span>
            </div>
            <p className="mt-2 text-sm text-gray-500">Cancel anytime</p>
          </div>

          <ul className="mt-8 space-y-3">
            <li className="flex items-center gap-3 text-sm text-gray-700">
              <span className="text-green-500 text-lg">✓</span>
              Unlimited barcode scans
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-700">
              <span className="text-green-500 text-lg">✓</span>
              Personalized weekly meal plans
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-700">
              <span className="text-green-500 text-lg">✓</span>
              Food & skincare reaction tracking
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-700">
              <span className="text-green-500 text-lg">✓</span>
              AI-powered sensitivity discovery
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-700">
              <span className="text-green-500 text-lg">✓</span>
              Priority support
            </li>
          </ul>

          <div className="mt-8">
            {isPro ? (
              <div className="rounded-lg bg-green-50 p-4 text-center">
                <p className="font-medium text-green-700">
                  ✅ You're already a Pro member!
                </p>
                <Link
                  to="/account"
                  className="mt-2 inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Manage your subscription →
                </Link>
              </div>
            ) : (
              <button
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full rounded-xl bg-indigo-600 px-6 py-3.5 text-lg font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? "Redirecting to Stripe..." : "Subscribe Now"}
              </button>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-gray-400">
            Secure payment powered by Stripe. Cancel anytime from your account.
          </p>
        </div>

        {/* Free vs Pro comparison */}
        <div className="mt-12 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-center">Free vs Pro</h2>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg bg-gray-50 p-4">
              <h3 className="font-semibold text-gray-700">Free</h3>
              <ul className="mt-3 space-y-2 text-gray-500">
                <li>• 10 barcode scans total</li>
                <li>• Basic sensitivity profile</li>
                <li>• Manual scan entry</li>
              </ul>
            </div>
            <div className="rounded-lg bg-indigo-50 p-4">
              <h3 className="font-semibold text-indigo-700">Pro — $9.99/mo</h3>
              <ul className="mt-3 space-y-2 text-indigo-600">
                <li>• Unlimited barcode scans</li>
                <li>• Weekly meal plans</li>
                <li>• Reaction tracking</li>
                <li>• Sensitivity discovery</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
        &copy; {new Date().getFullYear()} SensiScan. All rights reserved.
        <span className="mx-2">·</span>
        <span>Powered by Stripe</span>
      </footer>
    </main>
  );
}
