import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const user = localStorage.getItem("sensiskan_user");
    setIsLoggedIn(!!user);
  }, []);

  return (
    <main className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-bold text-indigo-600">SensiScan</h1>
          <nav className="flex gap-3 text-sm">
            {isLoggedIn ? (
              <>
                <Link
                  to="/scan"
                  className="rounded-lg bg-indigo-100 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-200"
                >
                  📱 Scan
                </Link>
                <Link
                  to="/meals"
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
                >
                  🍽️ Meals
                </Link>
                <Link
                  to="/dashboard"
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
                >
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/pricing"
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
                >
                  Pricing
                </Link>
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
                  Start Free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">
          Your personal sensitivity scanner
        </span>
        <h2 className="mt-6 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Shop, eat, and apply with{" "}
          <span className="text-indigo-600">confidence</span>
        </h2>
        <p className="mt-4 max-w-md text-lg text-gray-600">
          Scan any product barcode and instantly see if its ingredients conflict
          with your sensitivities. Food or skincare — SensiScan has you
          covered.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {isLoggedIn ? (
            <Link
              to="/dashboard"
              className="rounded-xl bg-indigo-600 px-8 py-3 text-lg font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/signup"
                className="rounded-xl bg-indigo-600 px-8 py-3 text-lg font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Start Free — 10 Scans Included
              </Link>
              <Link
                to="/pricing"
                className="rounded-xl border border-indigo-300 px-8 py-3 text-lg font-semibold text-indigo-600 hover:bg-indigo-50"
              >
                View Plans
              </Link>
            </>
          )}
        </div>

        {/* Feature highlights */}
        <div className="mt-20 grid gap-8 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="text-3xl">📱</div>
            <h3 className="mt-3 font-semibold">Barcode Scanning</h3>
            <p className="mt-1 text-sm text-gray-500">
              Scan products in-store and get instant safe/flagged results based
              on your profile.
            </p>
          </div>
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="text-3xl">🍽️</div>
            <h3 className="mt-3 font-semibold">Meal Planning</h3>
            <p className="mt-1 text-sm text-gray-500">
              Personalized meal plans that exclude every ingredient on your
              sensitivity list.
            </p>
          </div>
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="text-3xl">📊</div>
            <h3 className="mt-3 font-semibold">Reaction Tracking</h3>
            <p className="mt-1 text-sm text-gray-500">
              Log reactions and discover hidden sensitivities over time with
              smart correlation.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
        &copy; {new Date().getFullYear()} SensiScan. All rights reserved.
        <span className="mx-2">·</span>
        <span>Powered by Stripe</span>
      </footer>
    </main>
  );
}
