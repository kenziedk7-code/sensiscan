import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getSensitivitiesFn,
  addSensitivityFn,
  deleteSensitivityFn,
  getScanHistoryFn,
  getMealPlanFn,
  getReactionsFn,
  getDiscoveredSensitivitiesFn,
  getSubscriptionStatusFn,
  type SensitivityRow,
  type MealPlanEntry,
  type DiscoveredSensitivity,
} from "~/lib/server-fns";
import AdBanner from "~/components/AdBanner";
import { InstallPrompt } from "~/components/InstallPrompt";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

const CATEGORIES = [
  { value: "food", label: "🍽️ Food" },
  { value: "skincare", label: "🧴 Skincare" },
  { value: "both", label: "🔄 Both" },
] as const;

const SEVERITIES = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

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

function Dashboard() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getStoredUser() : null;

  const [sensitivities, setSensitivities] = useState<SensitivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [ingredientName, setIngredientName] = useState("");
  const [category, setCategory] = useState("food");
  const [severity, setSeverity] = useState("mild");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);

  // Scan history
  const [scanHistory, setScanHistory] = useState<
    Array<{
      id: number;
      product_barcode: string;
      product_name: string | null;
      product_image: string | null;
      match_found: number;
      matched_ingredients: string[];
      scanned_at: string;
    }>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Today's meal plan
  const [todayMeals, setTodayMeals] = useState<MealPlanEntry[]>([]);
  const [mealsLoading, setMealsLoading] = useState(true);

  // Today's reactions
  const [todayReactions, setTodayReactions] = useState<number>(0);

  // Discovered patterns
  const [discovered, setDiscovered] = useState<DiscoveredSensitivity[]>([]);
  const [discoveredLoading, setDiscoveredLoading] = useState(true);

  // Subscription state
  const [isPro, setIsPro] = useState(false);
  const [scansRemaining, setScansRemaining] = useState(10);
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && !user) {
      navigate({ to: "/login" });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;
    loadSensitivities();
    loadScanHistory();
    loadTodayMeals();
    loadTodayReactions();
    loadDiscovered();
    loadSubscription();
  }, [user]);

  async function loadSensitivities() {
    try {
      setLoading(true);
      const token = getToken();
      const result = await getSensitivitiesFn({ data: { token } });
      setSensitivities(result.sensitivities);
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

  async function loadScanHistory() {
    try {
      setHistoryLoading(true);
      const token = getToken();
      const result = await getScanHistoryFn({ data: { token } });
      setScanHistory(result.scans);
    } catch {
      // Silently fail — scan history is secondary
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadTodayMeals() {
    try {
      setMealsLoading(true);
      const token = getToken();
      const result = await getMealPlanFn({ data: { token } });
      setTodayMeals(result.meals);
    } catch {
      // Silently fail — meal plan is secondary on dashboard
    } finally {
      setMealsLoading(false);
    }
  }

  async function loadTodayReactions() {
    try {
      const token = getToken();
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const result = await getReactionsFn({ data: { token, date: dateStr } });
      setTodayReactions(result.reactions.length);
    } catch {
      // Silently fail
    }
  }

  async function loadDiscovered() {
    try {
      setDiscoveredLoading(true);
      const token = getToken();
      const result = await getDiscoveredSensitivitiesFn({ data: { token } });
      setDiscovered(result.discovered.filter((d) => d.status === "suggested"));
    } catch {
      // Silently fail
    } finally {
      setDiscoveredLoading(false);
    }
  }

  async function loadSubscription() {
    try {
      setSubLoading(true);
      const token = getToken();
      const result = await getSubscriptionStatusFn({ data: { token } });
      setIsPro(result.isPro);
      setScansRemaining(result.scans_remaining);
    } catch {
      // Silently fail
    } finally {
      setSubLoading(false);
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");

    if (!ingredientName.trim()) {
      setAddError("Ingredient name is required");
      return;
    }

    try {
      setAdding(true);
      const token = getToken();
      await addSensitivityFn({
        data: {
          token,
          ingredient_name: ingredientName.trim(),
          category,
          severity,
        },
      });
      setIngredientName("");
      setCategory("food");
      setSeverity("mild");
      await loadSensitivities();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setDeleting(id);
      const token = getToken();
      await deleteSensitivityFn({ data: { token, id } });
      await loadSensitivities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  const handleLogout = () => {
    clearAuth();
    navigate({ to: "/" });
  };

  if (!user) return null;

  const groupedByCategory = {
    food: sensitivities.filter(
      (s) => s.category === "food" || s.category === "both",
    ),
    skincare: sensitivities.filter(
      (s) => s.category === "skincare" || s.category === "both",
    ),
  };

  const severityColor = (sev: string) => {
    switch (sev) {
      case "severe":
        return "bg-red-100 text-red-700";
      case "moderate":
        return "bg-yellow-100 text-yellow-700";
      default:
        return "bg-green-100 text-green-700";
    }
  };

  const categoryIcon = (cat: string) => {
    switch (cat) {
      case "food":
        return "🍽️";
      case "skincare":
        return "🧴";
      case "both":
        return "🔄";
      default:
        return "";
    }
  };

  return (
    <main className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-bold text-indigo-600">
            SensiScan
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/scan"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              📱 Scan
            </Link>
            {!isPro && (
              <Link
                to="/pricing"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Upgrade 🔒
              </Link>
            )}
            <Link
              to="/meals"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              🍽️ Meals
            </Link>
            <Link
              to="/account"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Account
            </Link>
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
        <div className="mb-8">
          <h1 className="text-2xl font-bold">
            Welcome, {user.name.split(" ")[0]}!
          </h1>
          <p className="mt-1 text-gray-500">
            Manage your sensitivity profile and view your personalized meal plan.
          </p>
        </div>

        {/* Free Tier Banner */}
        {!subLoading && !isPro && (
          <div className="mb-6 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 p-5 text-white shadow-md">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-semibold text-lg">
                  {scansRemaining > 0
                    ? `You have ${scansRemaining} free scan${scansRemaining !== 1 ? "s" : ""} remaining`
                    : "You're out of free scans!"}
                </p>
                <p className="text-sm text-indigo-100 mt-0.5">
                  Upgrade to Pro for unlimited scans, meal plans, and reaction tracking.
                </p>
              </div>
              <Link
                to="/pricing"
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0"
              >
                Upgrade — $9.99/mo
              </Link>
            </div>
          </div>
        )}

        {/* Pro Badge */}
        {!subLoading && isPro && (
          <div className="mb-6 rounded-xl bg-green-50 border border-green-200 p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-xl">✅</span>
              <div>
                <p className="font-semibold text-green-800">Pro Member</p>
                <p className="text-sm text-green-600">Unlimited scans, meal plans, and reaction tracking.</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Add Sensitivity</h2>
              <form onSubmit={handleAdd} className="mt-4 space-y-3">
                {addError && (
                  <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
                    {addError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Ingredient Name
                  </label>
                  <input
                    type="text"
                    required
                    value={ingredientName}
                    onChange={(e) => setIngredientName(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. lactose, gluten, fragrance"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={adding}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {adding ? "Adding..." : "Add Ingredient"}
                </button>
              </form>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white p-4 shadow-sm text-center">
                <div className="text-2xl">🍽️</div>
                <div className="mt-1 text-2xl font-bold">
                  {groupedByCategory.food.length}
                </div>
                <div className="text-xs text-gray-500">Food triggers</div>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm text-center">
                <div className="text-2xl">🧴</div>
                <div className="mt-1 text-2xl font-bold">
                  {groupedByCategory.skincare.length}
                </div>
                <div className="text-xs text-gray-500">Skin-care triggers</div>
              </div>
            </div>

            {/* Ad placement: dashboard sidebar */}
            <div className="mt-4 hidden lg:block">
              <AdBanner placement="dashboard" />
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold">
                Your Sensitivities ({sensitivities.length})
              </h2>

              {loading ? (
                <div className="mt-6 text-center text-sm text-gray-400">
                  Loading...
                </div>
              ) : sensitivities.length === 0 ? (
                <div className="mt-6 rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
                  <p className="text-gray-400">
                    No sensitivities added yet.
                  </p>
                  <p className="mt-1 text-sm text-gray-400">
                    Add your first ingredient above to start building your
                    profile.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-gray-100">
                  {sensitivities.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between py-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg shrink-0">
                          {categoryIcon(s.category)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {s.ingredient_name}
                          </p>
                          <div className="mt-0.5 flex gap-1.5">
                            <span className="text-xs text-gray-400">
                              {s.category}
                            </span>
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${severityColor(s.severity)}`}
                            >
                              {s.severity}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deleting === s.id}
                        className="ml-3 shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                        title="Remove"
                      >
                        {deleting === s.id ? (
                          <span className="text-xs">...</span>
                        ) : (
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
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Ad placement: between cards on mobile */}
            <div className="mt-4 lg:hidden">
              <AdBanner placement="dashboard" />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Link
                to="/scan"
                className="rounded-xl bg-indigo-50 p-4 shadow-sm hover:bg-indigo-100 transition-colors block"
              >
                <div className="text-2xl">📱</div>
                <h3 className="mt-2 text-sm font-semibold text-indigo-700">
                  Barcode Scan
                </h3>
                <p className="mt-1 text-xs text-indigo-500">
                  Scan a product now
                </p>
              </Link>
              <Link
                to="/meals"
                className="rounded-xl bg-white p-4 shadow-sm hover:bg-gray-50 transition-colors block"
              >
                <div className="text-2xl">🍽️</div>
                <h3 className="mt-2 text-sm font-semibold">
                  Meal Plans
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {todayMeals.length > 0
                    ? `${todayMeals.length} meals today`
                    : "Generate your plan"}
                </p>
              </Link>
              <Link
                to="/reactions"
                className="rounded-xl bg-white p-4 shadow-sm hover:bg-gray-50 transition-colors block"
              >
                <div className="text-2xl">📝</div>
                <h3 className="mt-2 text-sm font-semibold">Reaction Log</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {todayReactions > 0
                    ? `${todayReactions} reaction${todayReactions !== 1 ? "s" : ""} today`
                    : "Log today's reactions"}
                </p>
              </Link>
            </div>

            {/* Today's Meals Summary */}
            <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Today's Meals</h2>
                <Link
                  to="/meals"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  View Full Plan
                </Link>
              </div>

              {mealsLoading ? (
                <div className="mt-4 text-center text-sm text-gray-400">
                  Loading...
                </div>
              ) : todayMeals.length === 0 ? (
                <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
                  <p className="text-gray-400">No meals planned for today.</p>
                  <Link
                    to="/meals"
                    className="mt-2 inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Generate today's plan →
                  </Link>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {todayMeals.map((meal) => {
                    const badgeColors: Record<string, string> = {
                      breakfast: "bg-yellow-100 text-yellow-700",
                      lunch: "bg-green-100 text-green-700",
                      dinner: "bg-blue-100 text-blue-700",
                      snack: "bg-purple-100 text-purple-700",
                    };
                    return (
                      <div
                        key={meal.id}
                        className="rounded-lg border border-gray-100 p-3"
                      >
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeColors[meal.meal_type] || "bg-gray-100 text-gray-600"}`}
                        >
                          {meal.meal_type}
                        </span>
                        <p className="mt-1.5 text-sm font-medium text-gray-900">
                          {meal.template.name}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {meal.template.ingredients.slice(0, 4).map((ing) => (
                            <span
                              key={ing}
                              className="inline-block rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500"
                            >
                              {ing}
                            </span>
                          ))}
                          {meal.template.ingredients.length > 4 && (
                            <span className="text-xs text-gray-400">
                              +{meal.template.ingredients.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Discovered Patterns */}
            <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">🔍 Discovered Patterns</h2>
                <Link
                  to="/reactions"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  View All
                </Link>
              </div>

              {discoveredLoading ? (
                <div className="mt-4 text-center text-sm text-gray-400">
                  Loading...
                </div>
              ) : discovered.length === 0 ? (
                <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-4 text-center">
                  <p className="text-sm text-gray-400">No patterns yet.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Log reactions with ingredients to discover hidden sensitivities.
                  </p>
                  <Link
                    to="/reactions"
                    className="mt-2 inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Log a reaction →
                  </Link>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-gray-100">
                  {discovered.slice(0, 3).map((d) => (
                    <li key={d.id} className="flex items-center gap-3 py-3">
                      <span className="text-lg shrink-0">🔍</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {d.ingredient_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          Appeared in {d.occurrence_count} reactions —{" "}
                          <span className="font-medium text-indigo-600">
                            {d.confidence_score}% confidence
                          </span>
                        </p>
                      </div>
                      <span className="inline-block rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 shrink-0">
                        {d.category}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent Scans */}
            <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  Recent Scans ({scanHistory.length})
                </h2>
                <Link
                  to="/scan"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  New Scan
                </Link>
              </div>

              {historyLoading ? (
                <div className="mt-6 text-center text-sm text-gray-400">
                  Loading...
                </div>
              ) : scanHistory.length === 0 ? (
                <div className="mt-6 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
                  <p className="text-gray-400">
                    No scans yet.
                  </p>
                  <p className="mt-1 text-sm text-gray-400">
                    Scan your first product to see results here.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-gray-100">
                  {scanHistory.slice(0, 5).map((scan) => (
                    <li
                      key={scan.id}
                      className="flex items-center gap-3 py-3"
                    >
                      <span className="text-lg shrink-0">
                        {scan.match_found ? "⚠️" : "✅"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {scan.product_name || "Unknown product"}
                        </p>
                        <p className="text-xs text-gray-400">
                          {scan.product_barcode}
                          {scan.match_found === 1 && scan.matched_ingredients.length > 0 && (
                            <span className="ml-2 text-red-500">
                              Flagged: {scan.matched_ingredients.join(", ")}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {new Date(scan.scanned_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      <InstallPrompt />
    </main>
  );
}
