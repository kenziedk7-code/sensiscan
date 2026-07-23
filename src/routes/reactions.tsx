import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  logReactionFn,
  getReactionsFn,
  deleteReactionFn,
  getReactionDatesFn,
  analyzeReactionsFn,
  getDiscoveredSensitivitiesFn,
  confirmDiscoveredFn,
  dismissDiscoveredFn,
  getSubscriptionStatusFn,
  type DiscoveredSensitivity,
} from "~/lib/server-fns";

export const Route = createFileRoute("/reactions")({
  component: Reactions,
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

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const MEAL_TYPES = [
  { value: "breakfast", label: "🌅 Breakfast" },
  { value: "lunch", label: "☀️ Lunch" },
  { value: "dinner", label: "🌙 Dinner" },
  { value: "snack", label: "🍿 Snack" },
];

const SEVERITIES = [
  { value: "mild", label: "Mild", color: "bg-green-100 text-green-700" },
  {
    value: "moderate",
    label: "Moderate",
    color: "bg-yellow-100 text-yellow-700",
  },
  { value: "severe", label: "Severe", color: "bg-red-100 text-red-700" },
];

interface ReactionDisplay {
  id: number;
  user_id: number;
  date: string;
  category: "food" | "skincare";
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | null;
  description: string;
  severity: "mild" | "moderate" | "severe";
  ingredients_raw: string[];
  created_at: string;
}

type Tab = "log" | "history" | "discover";

function Reactions() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getStoredUser() : null;

  const [tab, setTab] = useState<Tab>("log");
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));

  // Food form
  const [foodMealType, setFoodMealType] = useState("lunch");
  const [foodDescription, setFoodDescription] = useState("");
  const [foodIngredients, setFoodIngredients] = useState("");
  const [foodSeverity, setFoodSeverity] = useState("mild");

  // Skincare form
  const [skincareProduct, setSkincareProduct] = useState("");
  const [skincareDescription, setSkincareDescription] = useState("");
  const [skincareIngredients, setSkincareIngredients] = useState("");
  const [skincareSeverity, setSkincareSeverity] = useState("mild");

  // State
  const [reactions, setReactions] = useState<ReactionDisplay[]>([]);
  const [reactionDates, setReactionDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Discovery
  const [discovered, setDiscovered] = useState<DiscoveredSensitivity[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMessage, setAnalyzeMessage] = useState("");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [dismissingId, setDismissingId] = useState<number | null>(null);

  // History
  const [historyReactions, setHistoryReactions] = useState<ReactionDisplay[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(false);

  // Week strip
  const [weekOffset, setWeekOffset] = useState(0);

  // Subscription state
  const [isPro, setIsPro] = useState(false);
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && !user) {
      navigate({ to: "/login" });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;
    loadReactions();
    loadReactionDates();
    loadDiscovered();
  }, [selectedDate]);

  // Load subscription
  useEffect(() => {
    if (!user) return;
    getSubscriptionStatusFn({ data: { token: getToken() } })
      .then((r) => { setIsPro(r.isPro); setSubLoading(false); })
      .catch(() => { setSubLoading(false); });
  }, [user]);

  async function loadReactions() {
    try {
      setLoading(true);
      const token = getToken();
      const result = await getReactionsFn({
        data: { token, date: selectedDate },
      });
      setReactions(result.reactions as ReactionDisplay[]);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("Authentication required")
      ) {
        clearAuth();
        navigate({ to: "/login" });
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function loadReactionDates() {
    try {
      const token = getToken();
      const result = await getReactionDatesFn({ data: { token } });
      setReactionDates(result.dates);
    } catch {
      // Silently fail
    }
  }

  async function loadDiscovered() {
    try {
      const token = getToken();
      const result = await getDiscoveredSensitivitiesFn({ data: { token } });
      setDiscovered(
        result.discovered.filter((d) => d.status === "suggested"),
      );
    } catch {
      // Silently fail
    }
  }

  async function loadHistory() {
    try {
      setHistoryLoading(true);
      const token = getToken();
      const result = await getReactionsFn({ data: { token } });
      setHistoryReactions(result.reactions as ReactionDisplay[]);
    } catch {
      // Silently fail
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleLogFood(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!foodDescription.trim()) {
      setError("Please describe what you ate and how you felt.");
      return;
    }

    try {
      setSubmitting(true);
      const token = getToken();
      const ingredients = foodIngredients
        .split(",")
        .map((i) => i.trim())
        .filter((i) => i.length > 0);

      await logReactionFn({
        data: {
          token,
          date: selectedDate,
          category: "food",
          meal_type: foodMealType,
          description: foodDescription.trim(),
          severity: foodSeverity,
          ingredients,
        },
      });

      setFoodDescription("");
      setFoodIngredients("");
      setFoodSeverity("mild");
      setFoodMealType("lunch");
      setSuccess("Food reaction logged!");
      await loadReactions();
      await loadReactionDates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log reaction");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogSkincare(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!skincareDescription.trim()) {
      setError("Please describe the reaction.");
      return;
    }

    try {
      setSubmitting(true);
      const token = getToken();
      const ingredients = skincareIngredients
        .split(",")
        .map((i) => i.trim())
        .filter((i) => i.length > 0);

      const description = skincareProduct.trim()
        ? `${skincareProduct.trim()}: ${skincareDescription.trim()}`
        : skincareDescription.trim();

      await logReactionFn({
        data: {
          token,
          date: selectedDate,
          category: "skincare",
          description,
          severity: skincareSeverity,
          ingredients,
        },
      });

      setSkincareProduct("");
      setSkincareDescription("");
      setSkincareIngredients("");
      setSkincareSeverity("mild");
      setSuccess("Skincare reaction logged!");
      await loadReactions();
      await loadReactionDates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log reaction");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const token = getToken();
      await deleteReactionFn({ data: { token, id } });
      await loadReactions();
      await loadReactionDates();
      setSuccess("Reaction deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleAnalyze() {
    setError("");
    setAnalyzeMessage("");
    try {
      setAnalyzing(true);
      const token = getToken();
      const result = await analyzeReactionsFn({ data: { token } });
      setAnalyzeMessage(result.message);
      if (result.suggestions.length > 0) {
        setDiscovered(result.suggestions);
        setTab("discover");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Analysis failed",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleConfirm(id: number) {
    try {
      setConfirmingId(id);
      const token = getToken();
      const ds = discovered.find((d) => d.id === id);
      await confirmDiscoveredFn({
        data: {
          token,
          id,
          category: ds?.category,
          severity: "moderate",
        },
      });
      setDiscovered((prev) => prev.filter((d) => d.id !== id));
      setSuccess("Added to your sensitivities!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleDismiss(id: number) {
    try {
      setDismissingId(id);
      const token = getToken();
      await dismissDiscoveredFn({ data: { token, id } });
      setDiscovered((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
    } finally {
      setDismissingId(null);
    }
  }

  const handleLogout = () => {
    clearAuth();
    navigate({ to: "/" });
  };

  if (!user) return null;

  // Build week strip
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    weekDays.push(formatDate(d));
  }

  const severityBadge = (sev: string) => {
    const found = SEVERITIES.find((s) => s.value === sev);
    return found ? found.color : "bg-gray-100 text-gray-600";
  };

  const categoryIcon = (cat: string) => (cat === "food" ? "🍽️" : "🧴");

  // Group history by date
  const historyByDate: Record<string, ReactionDisplay[]> = {};
  for (const r of historyReactions) {
    if (!historyByDate[r.date]) historyByDate[r.date] = [];
    historyByDate[r.date].push(r);
  }

  return (
    <main className="min-h-dvh bg-gray-50">
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
              to="/scan"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              📱 Scan
            </Link>
            <Link
              to="/account"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Account
            </Link>
            {!isPro && (
              <Link
                to="/pricing"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Upgrade 🔒
              </Link>
            )}
            <span className="text-sm text-gray-600">{user.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">📝 Reaction Log</h1>
          <p className="mt-1 text-gray-500">
            Track daily reactions to discover hidden sensitivities.
          </p>
        </div>

        {/* Upgrade prompt for free users */}
        {!subLoading && !isPro && (
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 p-8 text-white shadow-md text-center">
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-xl font-bold">Reaction Tracking is Pro-only</h2>
            <p className="mt-2 text-indigo-100 max-w-md mx-auto">
              Upgrade to SensiScan Pro to log food and skincare reactions and let our engine discover hidden sensitivity patterns.
            </p>
            <Link
              to="/pricing"
              className="mt-5 inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              Upgrade to Pro — $9.99/month
            </Link>
          </div>
        )}

        {/* Gated content for Pro users */}
        {(subLoading || isPro) && (<>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            {success}
            <button onClick={() => setSuccess("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1">
          {(
            [
              { key: "log", label: "📝 Log" },
              { key: "history", label: "📋 History" },
              { key: "discover", label: "🔍 Discover" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                if (t.key === "history") loadHistory();
                if (t.key === "discover") loadDiscovered();
              }}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Week Strip */}
        <div className="mb-6 rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ◀
            </button>
            <span className="text-xs font-medium text-gray-500">
              {formatDisplayDate(weekDays[0])} —{" "}
              {formatDisplayDate(weekDays[6])}
            </span>
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ▶
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekDays.map((day) => {
              const hasReaction = reactionDates.includes(day);
              const isToday = day === formatDate(new Date());
              const isSelected = day === selectedDate;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(day)}
                  className={`rounded-lg py-2 text-xs transition-colors ${
                    isSelected
                      ? "bg-indigo-600 text-white"
                      : isToday
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                        : "hover:bg-gray-100 text-gray-600"
                  }`}
                >
                  <div className="font-medium">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][
                      new Date(day + "T00:00:00").getDay()
                    ]}
                  </div>
                  <div className="mt-0.5">{day.slice(8)}</div>
                  {hasReaction && (
                    <div
                      className={`mx-auto mt-0.5 h-1 w-1 rounded-full ${
                        isSelected ? "bg-white" : "bg-red-400"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* LOG TAB */}
        {tab === "log" && (
          <div className="space-y-6">
            {/* Food Reaction Form */}
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-lg">🍽️ Log Food Reaction</h2>
              <p className="text-sm text-gray-500">
                For {formatDisplayDate(selectedDate)}
              </p>
              <form onSubmit={handleLogFood} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Meal Type
                  </label>
                  <select
                    value={foodMealType}
                    onChange={(e) => setFoodMealType(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {MEAL_TYPES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    What did you eat?
                  </label>
                  <textarea
                    required
                    value={foodDescription}
                    onChange={(e) => setFoodDescription(e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="Describe the meal and any symptoms you experienced..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Severity
                  </label>
                  <div className="mt-1 flex gap-2">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setFoodSeverity(s.value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          foodSeverity === s.value
                            ? s.color + " ring-2 ring-offset-1"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Ingredients (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={foodIngredients}
                    onChange={(e) => setFoodIngredients(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. milk, wheat, eggs, soy sauce"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? "Logging..." : "Log Food Reaction"}
                </button>
              </form>
            </div>

            {/* Skincare Reaction Form */}
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-lg">🧴 Log Skincare Reaction</h2>
              <p className="text-sm text-gray-500">
                For {formatDisplayDate(selectedDate)}
              </p>
              <form onSubmit={handleLogSkincare} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={skincareProduct}
                    onChange={(e) => setSkincareProduct(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. Daily Moisturizer SPF 30"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Reaction Description
                  </label>
                  <textarea
                    required
                    value={skincareDescription}
                    onChange={(e) => setSkincareDescription(e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="Describe what happened (redness, itching, breakouts...)"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Severity
                  </label>
                  <div className="mt-1 flex gap-2">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setSkincareSeverity(s.value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          skincareSeverity === s.value
                            ? s.color + " ring-2 ring-offset-1"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Ingredients (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={skincareIngredients}
                    onChange={(e) => setSkincareIngredients(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. fragrance, niacinamide, retinol"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-pink-600 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-700 disabled:opacity-50"
                >
                  {submitting ? "Logging..." : "Log Skincare Reaction"}
                </button>
              </form>
            </div>

            {/* Today's Log */}
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  Today's Reactions{" "}
                  <span className="text-sm font-normal text-gray-400">
                    ({reactions.length})
                  </span>
                </h2>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing || reactions.length < 2}
                  className="rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
                  title="You need multiple reactions across different dates for pattern discovery"
                >
                  {analyzing ? "Analyzing..." : "🔍 Analyze All"}
                </button>
              </div>

              {loading ? (
                <div className="mt-6 text-center text-sm text-gray-400">
                  Loading...
                </div>
              ) : reactions.length === 0 ? (
                <div className="mt-6 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
                  <p className="text-gray-400">
                    No reactions logged for this date.
                  </p>
                  <p className="mt-1 text-sm text-gray-400">
                    Use the forms above to log food or skincare reactions.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-gray-100">
                  {reactions.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 py-3">
                      <span className="mt-0.5 text-lg shrink-0">
                        {categoryIcon(r.category)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.meal_type && (
                            <span className="text-xs font-medium text-gray-500">
                              {r.meal_type}
                            </span>
                          )}
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(r.severity)}`}
                          >
                            {r.severity}
                          </span>
                          <span className="text-xs text-gray-400">
                            {r.category}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700 line-clamp-2">
                          {r.description}
                        </p>
                        {r.ingredients_raw.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.ingredients_raw.map((ing) => (
                              <span
                                key={ing}
                                className="inline-block rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500"
                              >
                                {ing}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === "history" && (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-lg mb-4">📋 Reaction History</h2>

            {historyLoading ? (
              <div className="text-center text-sm text-gray-400 py-8">
                Loading...
              </div>
            ) : historyReactions.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
                <p className="text-gray-400">No reactions logged yet.</p>
                <p className="mt-1 text-sm text-gray-400">
                  Start logging to build your history.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(historyByDate).map(([date, reactionsForDate]) => (
                  <div key={date}>
                    <h3 className="text-sm font-semibold text-gray-500 mb-3 sticky top-0 bg-white py-1">
                      {formatDisplayDate(date)}
                    </h3>
                    <div className="space-y-2">
                      {reactionsForDate.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-lg border border-gray-100 p-3"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{categoryIcon(r.category)}</span>
                            {r.meal_type && (
                              <span className="text-xs font-medium text-gray-500">
                                {r.meal_type}
                              </span>
                            )}
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(r.severity)}`}
                            >
                              {r.severity}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-gray-700">
                            {r.description}
                          </p>
                          {r.ingredients_raw.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {r.ingredients_raw.map((ing) => (
                                <span
                                  key={ing}
                                  className="inline-block rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500"
                                >
                                  {ing}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DISCOVER TAB */}
        {tab === "discover" && (
          <div className="space-y-6">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-lg">
                  🔍 Discovered Patterns
                </h2>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
                >
                  {analyzing ? "Analyzing..." : "Re-analyze"}
                </button>
              </div>

              {analyzeMessage && (
                <p className="mt-2 text-sm text-gray-500">{analyzeMessage}</p>
              )}

              {discovered.length === 0 ? (
                <div className="mt-6 rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
                  <p className="text-gray-400">No patterns discovered yet.</p>
                  <p className="mt-1 text-sm text-gray-400">
                    Log at least 2 moderate or severe reactions with ingredients
                    to find patterns.
                  </p>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {analyzing ? "Analyzing..." : "Run Analysis"}
                  </button>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-gray-100">
                  {discovered.map((d) => (
                    <li key={d.id} className="flex items-start gap-3 py-4">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-lg">
                        🔍
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900">
                            {d.ingredient_name}
                          </p>
                          <span className="text-xs text-gray-400">
                            {d.category}
                          </span>
                          <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            {d.confidence_score}% confidence
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          Appeared in {d.occurrence_count} of your moderate/severe
                          reactions.
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => handleConfirm(d.id)}
                            disabled={confirmingId === d.id}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {confirmingId === d.id
                              ? "Adding..."
                              : "✅ Add to My Sensitivities"}
                          </button>
                          <button
                            onClick={() => handleDismiss(d.id)}
                            disabled={dismissingId === d.id}
                            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                          >
                            {dismissingId === d.id ? "..." : "Dismiss"}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        </>)}
      </div>
    </main>
  );
}
