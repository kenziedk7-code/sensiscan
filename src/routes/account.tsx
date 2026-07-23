import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getSubscriptionStatusFn,
  cancelSubscriptionFn,
  getCustomerPortalUrlFn,
  createCheckoutSessionFn,
} from "~/lib/server-fns";

export const Route = createFileRoute("/account")({
  component: Account,
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

function clearAuth() {
  localStorage.removeItem("sensiskan_token");
  localStorage.removeItem("sensiskan_user");
}

function Account() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getStoredUser() : null;

  const [subStatus, setSubStatus] = useState<"active" | "canceled" | "past_due" | "none">("none");
  const [endDate, setEndDate] = useState<string | null>(null);
  const [scansRemaining, setScansRemaining] = useState(10);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Auth check
  useEffect(() => {
    if (typeof window !== "undefined" && !user) {
      navigate({ to: "/login" });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;
    loadSubscription();
  }, [user]);

  async function loadSubscription() {
    try {
      setLoading(true);
      const token = getToken();
      const result = await getSubscriptionStatusFn({ data: { token } });
      setSubStatus(result.status);
      setEndDate(result.endDate);
      setScansRemaining(result.scans_remaining);

      // Check for checkout success redirect
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.get("checkout") === "success") {
          setSuccess("Payment successful! Your Pro membership is now active.");
          // Clean URL
          window.history.replaceState({}, "", "/account");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Authentication required")) {
        clearAuth();
        navigate({ to: "/login" });
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm("Are you sure you want to cancel your subscription? You'll still have access until the end of the billing period.")) {
      return;
    }

    setActionLoading("cancel");
    setError("");
    try {
      const token = getToken();
      const result = await cancelSubscriptionFn({ data: { token } });
      setSubStatus("canceled");
      setEndDate(result.endDate);
      setSuccess("Subscription canceled. You'll have access until the end of the billing period.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setActionLoading("");
    }
  }

  async function handleResubscribe() {
    setActionLoading("resubscribe");
    setError("");
    try {
      const token = getToken();
      const result = await createCheckoutSessionFn({ data: { token } });
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to redirect to checkout");
      setActionLoading("");
    }
  }

  async function handleManageBilling() {
    setActionLoading("portal");
    setError("");
    try {
      const token = getToken();
      const result = await getCustomerPortalUrlFn({ data: { token } });
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open customer portal");
      setActionLoading("");
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const handleLogout = () => {
    clearAuth();
    navigate({ to: "/" });
  };

  if (!user) return null;

  return (
    <main className="min-h-dvh bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-bold text-indigo-600">
            SensiScan
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Dashboard
            </Link>
            <Link
              to="/pricing"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Pricing
            </Link>
            <span className="text-sm text-gray-400">{user.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="mt-1 text-gray-500">Manage your subscription and account settings.</p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            {success}
            <button onClick={() => setSuccess("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="mt-3 text-sm text-gray-500">Loading subscription...</p>
          </div>
        ) : (
          <>
            {/* Profile Card */}
            <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Profile</h2>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Name</span>
                  <span className="font-medium">{user.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Email</span>
                  <span className="font-medium">{user.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Member since</span>
                  <span className="font-medium">—</span>
                </div>
              </div>
            </div>

            {/* Subscription Card */}
            <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Subscription</h2>
                <span
                  className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                    subStatus === "active"
                      ? "bg-green-100 text-green-700"
                      : subStatus === "canceled"
                        ? "bg-yellow-100 text-yellow-700"
                        : subStatus === "past_due"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {subStatus === "active"
                    ? "🔒 Pro"
                    : subStatus === "canceled"
                      ? "Canceled"
                      : subStatus === "past_due"
                        ? "Past Due"
                        : "Free"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {subStatus === "active" && (
                  <>
                    <div className="rounded-lg bg-green-50 p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">✅</span>
                        <div>
                          <p className="font-medium text-green-800">Pro Membership Active</p>
                          <p className="text-sm text-green-600">
                            Your plan renews on {formatDate(endDate)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleManageBilling}
                        disabled={actionLoading === "portal"}
                        className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {actionLoading === "portal" ? "Loading..." : "Manage Billing"}
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={actionLoading === "cancel"}
                        className="flex-1 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {actionLoading === "cancel" ? "Canceling..." : "Cancel Plan"}
                      </button>
                    </div>
                  </>
                )}

                {subStatus === "canceled" && (
                  <>
                    <div className="rounded-lg bg-yellow-50 p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">⏳</span>
                        <div>
                          <p className="font-medium text-yellow-800">Subscription Canceled</p>
                          <p className="text-sm text-yellow-600">
                            Access ends on {formatDate(endDate)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleResubscribe}
                      disabled={actionLoading === "resubscribe"}
                      className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {actionLoading === "resubscribe" ? "Redirecting..." : "Resubscribe"}
                    </button>
                  </>
                )}

                {subStatus === "past_due" && (
                  <div className="rounded-lg bg-red-50 p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">⚠️</span>
                      <div>
                        <p className="font-medium text-red-800">Payment Past Due</p>
                        <p className="text-sm text-red-600">
                          Please update your payment method to keep your Pro access.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {subStatus === "none" && (
                  <>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="font-medium text-gray-700">Free Plan</p>
                      <p className="text-sm text-gray-500 mt-1">
                        You have <span className="font-semibold">{scansRemaining}</span> free scans remaining.
                      </p>
                    </div>
                    <Link
                      to="/pricing"
                      className="block w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 text-center"
                    >
                      Upgrade to Pro — $9.99/mo
                    </Link>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
