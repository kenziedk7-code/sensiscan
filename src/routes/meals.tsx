import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  generateMealPlanFn,
  getMealPlanFn,
  regenerateMealFn,
  type MealTemplate,
  type MealPlanEntry,
} from "~/lib/server-fns";
import AdBanner from "~/components/AdBanner";

export const Route = createFileRoute("/meals")({
  component: Meals,
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

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const todayStr = formatDate(today);
  if (dateStr === todayStr) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === formatDate(tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const MEAL_TYPE_META: Record<string, { emoji: string; badge: string; label: string }> = {
  breakfast: { emoji: "🌅", badge: "bg-yellow-100 text-yellow-700", label: "Breakfast" },
  lunch: { emoji: "☀️", badge: "bg-green-100 text-green-700", label: "Lunch" },
  dinner: { emoji: "🌙", badge: "bg-blue-100 text-blue-700", label: "Dinner" },
  snack: { emoji: "🍿", badge: "bg-purple-100 text-purple-700", label: "Snack" },
};

function getWeekDates(fromDate: string): string[] {
  const start = new Date(fromDate + "T00:00:00");
  const day = start.getDay();
  const diff = start.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(start.getFullYear(), start.getMonth(), diff);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

function Meals() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getStoredUser() : null;

  const [meals, setMeals] = useState<MealPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [hasGenerated, setHasGenerated] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);

  // Auth check
  useEffect(() => {
    if (typeof window !== "undefined" && !user) {
      navigate({ to: "/login" });
    }
  }, [user, navigate]);

  // Load meals for selected date
  const loadMeals = useCallback(async (date: string) => {
    if (!user) return;
    try {
      setLoading(true);
      setError("");
      const token = getToken();
      const result = await getMealPlanFn({ data: { token, date } });
      setMeals(result.meals);
      if (result.meals.length > 0) setHasGenerated(true);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Authentication required")) {
        clearAuth();
        navigate({ to: "/login" });
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load meals");
    } finally {
      setLoading(false);
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user) loadMeals(selectedDate);
  }, [user, selectedDate, loadMeals]);

  const handleGenerate = async () => {
    if (!user) return;
    try {
      setGenerating(true);
      setError("");
      const token = getToken();
      await generateMealPlanFn({ data: { token } });
      setHasGenerated(true);
      await loadMeals(selectedDate);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Authentication required")) {
        clearAuth();
        navigate({ to: "/login" });
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to generate meal plan");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async (planId: number) => {
    try {
      setRegeneratingId(planId);
      setError("");
      const token = getToken();
      await regenerateMealFn({ data: { token, planId } });
      await loadMeals(selectedDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate meal");
    } finally {
      setRegeneratingId(null);
    }
  };

  const weekDates = getWeekDates(selectedDate);

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
              to="/scan"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              📱 Scan
            </Link>
            <Link
              to="/dashboard"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Dashboard
            </Link>
            <span className="text-sm text-gray-400">{user.name}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🍽️ Meal Plan</h1>
            <p className="mt-1 text-sm text-gray-500">
              Personalized meals that exclude your sensitivities.
            </p>
          </div>
          {!hasGenerated && !loading && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              {generating ? "Generating..." : "Generate My Meal Plan"}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Week Day Picker */}
        {hasGenerated && (
          <div className="mt-6 -mx-4 px-4">
            <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
              {weekDates.map((date) => {
                const isSelected = date === selectedDate;
                const d = new Date(date + "T00:00:00");
                return (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`flex-shrink-0 rounded-xl px-4 py-2.5 text-center min-w-[72px] transition-colors ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                    }`}
                  >
                    <div className="text-xs font-medium">
                      {d.toLocaleDateString("en-US", { weekday: "short" })}
                    </div>
                    <div className="text-lg font-bold leading-tight">
                      {d.getDate()}
                    </div>
                    <div className="text-xs">
                      {d.toLocaleDateString("en-US", { month: "short" })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Day View */}
        {!hasGenerated && !loading ? (
          /* Empty state */
          <div className="mt-16 rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
            <div className="text-5xl">🍽️</div>
            <h2 className="mt-4 text-xl font-semibold text-gray-800">
              No meal plan yet
            </h2>
            <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
              Generate a personalized weekly meal plan that automatically excludes
              every ingredient on your sensitivity list.
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate My Meal Plan"}
            </button>
          </div>
        ) : loading ? (
          <div className="mt-16 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="mt-3 text-sm text-gray-500">Loading meals...</p>
          </div>
        ) : (
          /* Day meals */
          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">
              {formatDateLabel(selectedDate)}
            </h2>

            {meals.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
                <p className="text-gray-400">No meals planned for this day.</p>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium underline"
                >
                  Regenerate full week
                </button>
              </div>
            ) : (
              meals.map((meal) => {
                const meta = MEAL_TYPE_META[meal.meal_type] || {
                  emoji: "🍴",
                  badge: "bg-gray-100 text-gray-600",
                  label: meal.meal_type,
                };
                return (
                  <div
                    key={meal.id}
                    className="rounded-xl bg-white p-4 shadow-sm border border-gray-100"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
                          >
                            {meta.emoji} {meta.label}
                          </span>
                          {meal.template.calories && (
                            <span className="text-xs text-gray-400">
                              {meal.template.calories} cal
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-gray-900">
                          {meal.template.name}
                        </h3>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {meal.template.ingredients.map((ing) => (
                            <span
                              key={ing}
                              className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                            >
                              {ing}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRegenerate(meal.id)}
                        disabled={regeneratingId === meal.id}
                        className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 transition-colors"
                        title="Swap this meal"
                      >
                        {regeneratingId === meal.id ? "..." : "🔄 Regenerate"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Ad placement: bottom of meals page */}
        {hasGenerated && (
          <div className="mt-8">
            <AdBanner placement="meals" />
          </div>
        )}
      </div>
    </main>
  );
}
