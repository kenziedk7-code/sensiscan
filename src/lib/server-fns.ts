import { createServerFn } from "@tanstack/react-start";
import { randomBytes } from "node:crypto";
import {
  createUser,
  loginUser,
  getUserFromToken,
  hashPassword,
  type User,
} from "../db-auth.server";
import store from "../db-schema.server";

// ── Auth Server Functions ──────────────────────────────

export const signupFn = createServerFn({ method: "POST" })
  .validator(
    (data: { email: string; password: string; name: string }) => data,
  )
  .handler(async ({ data }) => {
    const { email, password, name } = data;

    if (!email || !password || !name) {
      throw new Error("Email, password, and name are required");
    }

    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error("Invalid email address");
    }

    try {
      const result = createUser(email, password, name);

      // Trigger welcome email (non-blocking, don't fail signup on email error)
      try {
        const { sendWelcomeEmail } = await import("./email.server");
        sendWelcomeEmail({
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
        });
      } catch (emailErr) {
        console.error("Failed to generate welcome email:", emailErr);
      }

      return { user: result.user, token: result.token };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signup failed";
      if (message.includes("UNIQUE constraint")) {
        throw new Error("An account with this email already exists");
      }
      throw new Error(message);
    }
  });

export const loginFn = createServerFn({ method: "POST" })
  .validator(
    (data: { email: string; password: string }) => data,
  )
  .handler(async ({ data }) => {
    const { email, password } = data;

    if (!email || !password) {
      throw new Error("Email and password are required");
    }

    const result = loginUser(email, password);

    if (!result) {
      throw new Error("Invalid email or password");
    }

    return { user: result.user, token: result.token };
  });

export const getMeFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) {
      throw new Error("Invalid or expired session");
    }
    return { user };
  });

// ── Sensitivity Server Functions ──────────────────────

export interface SensitivityRow {
  id: number;
  user_id: number;
  ingredient_name: string;
  category: "food" | "skincare" | "both";
  severity: "mild" | "moderate" | "severe";
  created_at: string;
}

export const getSensitivitiesFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const rows = store.findSensitivitiesByUserId(user.id);
    rows.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return { sensitivities: rows };
  });

export const addSensitivityFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      ingredient_name: string;
      category: string;
      severity: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const { ingredient_name, category, severity } = data;

    if (!ingredient_name || !category || !severity) {
      throw new Error("ingredient_name, category, and severity are required");
    }

    const validCategories = ["food", "skincare", "both"];
    const validSeverities = ["mild", "moderate", "severe"];

    if (!validCategories.includes(category)) {
      throw new Error(`Category must be one of: ${validCategories.join(", ")}`);
    }
    if (!validSeverities.includes(severity)) {
      throw new Error(
        `Severity must be one of: ${validSeverities.join(", ")}`,
      );
    }

    const row = store.insertSensitivity(
      user.id,
      ingredient_name.trim(),
      category as "food" | "skincare" | "both",
      severity as "mild" | "moderate" | "severe",
    );

    return { sensitivity: row };
  });

export const deleteSensitivityFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: number }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const existing = store.findSensitivityById(data.id);
    if (!existing || existing.user_id !== user.id) {
      throw new Error("Sensitivity not found");
    }

    store.deleteSensitivityById(data.id);
    return { success: true };
  });

// ── Scan / Product Lookup Server Functions ──────────────

interface MatchedIngredient {
  name: string;
  category: string;
  severity: string;
}

interface ScanResult {
  found: boolean;
  productName: string | null;
  productImage: string | null;
  ingredientsText: string | null;
  safe: boolean;
  matchedIngredients: MatchedIngredient[];
  source: string | null;
}

// Simple in-memory cache for product lookups (barcode → product data)
const productCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function lookupProduct(
  barcode: string,
): Promise<{ found: boolean; product: unknown; source: string }> {
  // Check cache first
  const cached = productCache.get(barcode);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { found: true, product: cached.data, source: "cache" };
  }

  // Try Open Food Facts first
  try {
    const foodRes = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      { signal: AbortSignal.timeout(8000) },
    );
    const foodJson = await foodRes.json();
    if (foodJson.status === 1 && foodJson.product) {
      productCache.set(barcode, { data: foodJson.product, ts: Date.now() });
      return { found: true, product: foodJson.product, source: "food" };
    }
  } catch {
    // Fall through to beauty
  }

  // Try Open Beauty Facts as fallback
  try {
    const beautyRes = await fetch(
      `https://world.openbeautyfacts.org/api/v2/product/${barcode}.json`,
      { signal: AbortSignal.timeout(8000) },
    );
    const beautyJson = await beautyRes.json();
    if (beautyJson.status === 1 && beautyJson.product) {
      productCache.set(barcode, { data: beautyJson.product, ts: Date.now() });
      return { found: true, product: beautyJson.product, source: "beauty" };
    }
  } catch {
    // Not found
  }

  return { found: false, product: null, source: "" };
}

export const scanProductFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; barcode: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const barcode = data.barcode.trim();
    if (!barcode || !/^\d+$/.test(barcode)) {
      throw new Error("Valid barcode number is required");
    }

    // Feature gate: check subscription or scans remaining
    const userRow = store.findUserById(user.id);
    if (!userRow) throw new Error("User not found");
    if (userRow.subscription_status !== "active" && userRow.scans_remaining <= 0) {
      throw new Error("UPGRADE_REQUIRED: You've used all 10 free scans. Upgrade to Pro for unlimited scans.");
    }

    // Decrement scan count for free users
    if (userRow.subscription_status !== "active") {
      store.decrementScans(user.id);
    }

    // Look up product
    const lookup = await lookupProduct(barcode);

    if (!lookup.found || !lookup.product) {
      // Still save the scan even if product not found
      store.insertScanHistory(user.id, barcode, null, null, false, []);
      return {
        found: false,
        productName: null,
        productImage: null,
        ingredientsText: null,
        safe: true,
        matchedIngredients: [],
        source: null,
      } satisfies ScanResult;
    }

    const product = lookup.product as Record<string, unknown>;
    const productName =
      (product.product_name as string) || "Unknown product";
    const productImage =
      (product.image_url as string) ||
      (product.image_front_url as string) ||
      (product.image_thumb_url as string) ||
      null;
    const ingredientsText =
      (product.ingredients_text as string) || "";

    // Cross-reference with user's sensitivities
    const sensitivities = store.findSensitivitiesByUserId(user.id);
    const matchedIngredients: MatchedIngredient[] = [];
    const lowerIngredients = ingredientsText.toLowerCase();

    for (const sens of sensitivities) {
      if (lowerIngredients.includes(sens.ingredient_name.toLowerCase())) {
        matchedIngredients.push({
          name: sens.ingredient_name,
          category: sens.category,
          severity: sens.severity,
        });
      }
    }

    const safe = matchedIngredients.length === 0;

    // Save scan history
    store.insertScanHistory(
      user.id,
      barcode,
      productName,
      productImage,
      !safe,
      matchedIngredients.map((m) => m.name),
    );

    return {
      found: true,
      productName,
      productImage,
      ingredientsText,
      safe,
      matchedIngredients,
      source: lookup.source,
    } satisfies ScanResult;
  });

export const getScanHistoryFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const db = store.db;
    const scans = db.scan_history
      .filter((s) => s.user_id === user.id)
      .sort(
        (a, b) =>
          new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
      )
      .slice(0, 20);

    return {
      scans: scans.map((s) => ({
        ...s,
        matched_ingredients: JSON.parse(s.matched_ingredients) as string[],
      })),
    };
  });

// ── Meal Planning Server Functions ───────────────────

export interface MealTemplate {
  id: number;
  name: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  ingredients: string[];
  recipe_url: string | null;
  calories: number | null;
  image_url: string | null;
}

export interface MealPlanEntry {
  id: number;
  user_id: number;
  date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  meal_template_id: number;
  template: MealTemplate;
  notes: string | null;
  created_at: string;
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getWeekDates(fromDate: string): string[] {
  const start = new Date(fromDate + "T00:00:00");
  // Adjust to Monday
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

function isMealSafeForUser(
  templateIngredients: string[],
  userSensitivities: Array<{ ingredient_name: string; category: string }>,
): boolean {
  const lowerSensitivities = userSensitivities.map((s) =>
    s.ingredient_name.toLowerCase(),
  );
  for (const ingredient of templateIngredients) {
    if (lowerSensitivities.includes(ingredient.toLowerCase())) {
      return false;
    }
  }
  return true;
}

export const generateMealPlanFn = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; startDate?: string }) => data,
  )
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    // Seed templates if needed
    store.seedMealTemplatesIfEmpty();

    // Get user sensitivities (food-related)
    const sensitivities = store.findSensitivitiesByUserId(user.id);
    const foodSensitivities = sensitivities.filter(
      (s) => s.category === "food" || s.category === "both",
    );

    // Determine date range (default: current week, Mon-Sun)
    const today = new Date();
    const startDate = data.startDate || formatDate(today);
    const weekDates = getWeekDates(startDate);

    // Get all templates
    const allTemplates = store.getAllMealTemplates();

    // Filter templates: keep those safe for the user
    const safeTemplates = allTemplates.filter((t) =>
      isMealSafeForUser(
        JSON.parse(t.ingredients) as string[],
        foodSensitivities,
      ),
    );

    // Group safe templates by meal type
    const byType: Record<string, typeof safeTemplates> = {
      breakfast: safeTemplates.filter((t) => t.meal_type === "breakfast"),
      lunch: safeTemplates.filter((t) => t.meal_type === "lunch"),
      dinner: safeTemplates.filter((t) => t.meal_type === "dinner"),
      snack: safeTemplates.filter((t) => t.meal_type === "snack"),
    };

    // Shuffle helper
    function shuffle<T>(arr: T[]): T[] {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    // Generate plan for each day
    const plans: Array<{
      date: string;
      meals: Array<{ type: string; template: (typeof safeTemplates)[0] }>;
    }> = [];

    for (const date of weekDates) {
      // Delete existing plans for this user+date (replace)
      store.deleteMealPlansForUserAndDate(user.id, date);

      const dayMeals: Array<{
        type: string;
        template: (typeof safeTemplates)[0];
      }> = [];

      for (const mealType of ["breakfast", "lunch", "dinner", "snack"] as const) {
        const pool = byType[mealType];
        if (pool.length === 0) continue;
        const shuffled = shuffle(pool);
        // Use deterministic but varied picks based on date+mealType
        const idx =
          (date.charCodeAt(date.length - 1) + mealType.length) % shuffled.length;
        const picked = shuffled[idx];
        dayMeals.push({ type: mealType, template: picked });

        store.insertMealPlan(user.id, date, mealType, picked.id, null);
      }

      plans.push({ date, meals: dayMeals });
    }

    // Return full plan with template data
    const result = plans.map((p) => ({
      date: p.date,
      meals: p.meals.map((m) => ({
        type: m.type,
        template: {
          ...m.template,
          ingredients: JSON.parse(m.template.ingredients) as string[],
        } as MealTemplate,
      })),
    }));

    return { week: result };
  });

export const getMealPlanFn = createServerFn({ method: "GET" })
  .validator((data: { token: string; date?: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    store.seedMealTemplatesIfEmpty();

    const today = new Date();
    const targetDate = data.date || formatDate(today);

    const plans = store.findMealPlansByUserAndDate(user.id, targetDate);

    const meals: MealPlanEntry[] = plans.map((p) => {
      const template = store.findMealTemplateById(p.meal_template_id);
      return {
        id: p.id,
        user_id: p.user_id,
        date: p.date,
        meal_type: p.meal_type,
        meal_template_id: p.meal_template_id,
        template: template
          ? {
              ...template,
              ingredients: JSON.parse(template.ingredients) as string[],
            }
          : {
              id: 0,
              name: "Unknown",
              meal_type: p.meal_type,
              ingredients: [] as string[],
              recipe_url: null,
              calories: null,
              image_url: null,
            },
        notes: p.notes,
        created_at: p.created_at,
      };
    });

    // Sort by meal type order
    const typeOrder: Record<string, number> = {
      breakfast: 0,
      lunch: 1,
      dinner: 2,
      snack: 3,
    };
    meals.sort((a, b) => typeOrder[a.meal_type] - typeOrder[b.meal_type]);

    return { date: targetDate, meals };
  });

export const regenerateMealFn = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; planId: number }) => data,
  )
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const existing = store.findMealPlanById(data.planId);
    if (!existing || existing.user_id !== user.id) {
      throw new Error("Meal plan entry not found");
    }

    // Get user sensitivities
    const sensitivities = store.findSensitivitiesByUserId(user.id);
    const foodSensitivities = sensitivities.filter(
      (s) => s.category === "food" || s.category === "both",
    );

    // Get templates of same meal type
    const templates = store.getMealTemplatesByType(existing.meal_type);

    // Filter safe ones, excluding the current template
    const safeTemplates = templates.filter((t) => {
      if (t.id === existing.meal_template_id) return false;
      return isMealSafeForUser(
        JSON.parse(t.ingredients) as string[],
        foodSensitivities,
      );
    });

    if (safeTemplates.length === 0) {
      throw new Error("No alternative meals available for this type.");
    }

    // Pick a random alternative
    const picked = safeTemplates[Math.floor(Math.random() * safeTemplates.length)];

    // Delete old and insert new
    store.deleteMealPlanById(existing.id);
    const newPlan = store.insertMealPlan(
      user.id,
      existing.date,
      existing.meal_type,
      picked.id,
      null,
    );

    return {
      plan: {
        id: newPlan.id,
        user_id: newPlan.user_id,
        date: newPlan.date,
        meal_type: newPlan.meal_type,
        meal_template_id: newPlan.meal_template_id,
        template: {
          ...picked,
          ingredients: JSON.parse(picked.ingredients) as string[],
        } as MealTemplate,
        notes: newPlan.notes,
        created_at: newPlan.created_at,
      },
    };
  });

// ── Reaction Server Functions ─────────────────────────

export interface ReactionRow {
  id: number;
  user_id: number;
  date: string;
  category: "food" | "skincare";
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | null;
  description: string;
  severity: "mild" | "moderate" | "severe";
  ingredients_raw: string;
  created_at: string;
}

export interface DiscoveredSensitivity {
  id: number;
  user_id: number;
  ingredient_name: string;
  category: "food" | "skincare" | "both";
  confidence_score: number;
  occurrence_count: number;
  status: "suggested" | "confirmed" | "dismissed";
  created_at: string;
}

export const logReactionFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      date: string;
      category: string;
      meal_type?: string | null;
      description: string;
      severity: string;
      ingredients: string[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const { date, category, description, severity, ingredients } = data;

    if (!date || !category || !description || !severity) {
      throw new Error("date, category, description, and severity are required");
    }

    const validCategories = ["food", "skincare"];
    const validSeverities = ["mild", "moderate", "severe"];
    const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];

    if (!validCategories.includes(category)) {
      throw new Error(`Category must be one of: ${validCategories.join(", ")}`);
    }
    if (!validSeverities.includes(severity)) {
      throw new Error(`Severity must be one of: ${validSeverities.join(", ")}`);
    }

    let mealType: "breakfast" | "lunch" | "dinner" | "snack" | null = null;
    if (category === "food" && data.meal_type) {
      if (!validMealTypes.includes(data.meal_type)) {
        throw new Error(`Meal type must be one of: ${validMealTypes.join(", ")}`);
      }
      mealType = data.meal_type as "breakfast" | "lunch" | "dinner" | "snack";
    }

    const cleanIngredients = ingredients
      .map((i) => i.trim().toLowerCase())
      .filter((i) => i.length > 0);

    const reaction = store.insertReaction(
      user.id,
      date,
      category as "food" | "skincare",
      mealType,
      description.trim(),
      severity as "mild" | "moderate" | "severe",
      cleanIngredients,
    );

    return {
      reaction: {
        ...reaction,
        ingredients_raw: cleanIngredients,
      },
    };
  });

export const getReactionsFn = createServerFn({ method: "GET" })
  .validator((data: { token: string; date?: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    let reactions: ReactionRow[];
    if (data.date) {
      reactions = store.findReactionsByUserAndDate(user.id, data.date);
    } else {
      reactions = store.findReactionsByUserId(user.id);
    }

    // Parse ingredients_raw for each reaction
    const parsed = reactions.map((r) => ({
      ...r,
      ingredients_raw: JSON.parse(r.ingredients_raw) as string[],
    }));

    // Sort by created_at descending
    parsed.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return { reactions: parsed };
  });

export const deleteReactionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: number }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const existing = store.findReactionById(data.id);
    if (!existing || existing.user_id !== user.id) {
      throw new Error("Reaction not found");
    }

    store.deleteReactionById(data.id);
    return { success: true };
  });

export const getReactionDatesFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const dates = store.getDistinctReactionDates(user.id);
    return { dates };
  });

// ── Sensitivity Discovery Engine ──────────────────────

export const analyzeReactionsFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    // Get all reactions for this user
    const allReactions = store.findReactionsByUserId(user.id);

    // Filter to moderate/severe reactions only
    const significantReactions = allReactions.filter(
      (r) => r.severity === "moderate" || r.severity === "severe",
    );

    if (significantReactions.length < 2) {
      return {
        suggestions: [] as DiscoveredSensitivity[],
        totalReactions: allReactions.length,
        significantReactions: significantReactions.length,
        message:
          significantReactions.length === 0
            ? "Log at least 2 moderate or severe reactions for pattern discovery."
            : "Log at least 2 moderate or severe reactions to discover patterns.",
      };
    }

    // Count ingredient occurrences across moderate/severe reactions
    const ingredientCounts: Record<
      string,
      {
        count: number;
        severitySum: number;
        categories: Set<string>;
        reactionIds: Set<number>;
      }
    > = {};

    for (const reaction of significantReactions) {
      const ingredients = JSON.parse(reaction.ingredients_raw) as string[];
      const severityWeight =
        reaction.severity === "severe" ? 3 : reaction.severity === "moderate" ? 2 : 1;

      for (const ing of ingredients) {
        const key = ing.toLowerCase().trim();
        if (!key) continue;

        if (!ingredientCounts[key]) {
          ingredientCounts[key] = {
            count: 0,
            severitySum: 0,
            categories: new Set(),
            reactionIds: new Set(),
          };
        }

        ingredientCounts[key].count++;
        ingredientCounts[key].severitySum += severityWeight;
        ingredientCounts[key].categories.add(reaction.category);
        ingredientCounts[key].reactionIds.add(reaction.id);
      }
    }

    // Build suggestions: ingredient must appear in ≥2 moderate/severe reactions
    const suggestions: Array<{
      ingredient_name: string;
      category: "food" | "skincare" | "both";
      confidence_score: number;
      occurrence_count: number;
    }> = [];

    for (const [ingredient, data] of Object.entries(ingredientCounts)) {
      if (data.count < 2) continue;

      // Confidence: based on occurrence frequency and average severity
      const frequencyRatio = data.count / significantReactions.length;
      const avgSeverity = data.severitySum / data.count;
      // Scale confidence: frequency (0-50) + severity (0-50) = 0-100
      const confidenceScore = Math.min(
        100,
        Math.round(frequencyRatio * 50 + (avgSeverity / 3) * 50),
      );

      // Determine category
      let category: "food" | "skincare" | "both";
      if (data.categories.has("food") && data.categories.has("skincare")) {
        category = "both";
      } else if (data.categories.has("skincare")) {
        category = "skincare";
      } else {
        category = "food";
      }

      suggestions.push({
        ingredient_name: ingredient,
        category,
        confidence_score: confidenceScore,
        occurrence_count: data.count,
      });
    }

    // Sort by confidence score descending
    suggestions.sort((a, b) => b.confidence_score - a.confidence_score);

    // Delete old discovered sensitivities for this user
    store.deleteAllDiscoveredSensitivitiesForUser(user.id);

    // Save new suggestions to DB
    const saved: DiscoveredSensitivity[] = [];
    for (const s of suggestions) {
      const ds = store.insertDiscoveredSensitivity(
        user.id,
        s.ingredient_name,
        s.category,
        s.confidence_score,
        s.occurrence_count,
        "suggested",
      );
      saved.push(ds);
    }

    // Also check if any existing user sensitivities overlap with discoveries
    const existingSensitivities = store.findSensitivitiesByUserId(user.id);
    const existingNames = new Set(
      existingSensitivities.map((s) => s.ingredient_name.toLowerCase()),
    );

    const newSuggestions = saved.filter(
      (s) => !existingNames.has(s.ingredient_name),
    );

    return {
      suggestions: newSuggestions,
      totalReactions: allReactions.length,
      significantReactions: significantReactions.length,
      message:
        newSuggestions.length > 0
          ? `Found ${newSuggestions.length} potential sensitivity patterns.`
          : "No new patterns found. Keep logging reactions!",
    };
  });

export const getDiscoveredSensitivitiesFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const discovered = store.findDiscoveredSensitivitiesByUserId(user.id);
    discovered.sort((a, b) => b.confidence_score - a.confidence_score);

    return { discovered };
  });

export const confirmDiscoveredFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      id: number;
      category?: string;
      severity?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const ds = store.findDiscoveredSensitivityById(data.id);
    if (!ds || ds.user_id !== user.id) {
      throw new Error("Discovered sensitivity not found");
    }

    // Update status to confirmed
    store.updateDiscoveredSensitivityStatus(data.id, "confirmed");

    // Also add as a user sensitivity
    const category = (data.category || ds.category) as
      | "food"
      | "skincare"
      | "both";
    const severity = (data.severity || "moderate") as
      | "mild"
      | "moderate"
      | "severe";

    const sensitivity = store.insertSensitivity(
      user.id,
      ds.ingredient_name,
      category,
      severity,
    );

    return {
      success: true,
      sensitivity,
      discovered: { ...ds, status: "confirmed" as const },
    };
  });

export const dismissDiscoveredFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: number }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const ds = store.findDiscoveredSensitivityById(data.id);
    if (!ds || ds.user_id !== user.id) {
      throw new Error("Discovered sensitivity not found");
    }

    store.updateDiscoveredSensitivityStatus(data.id, "dismissed");

    return { success: true };
  });

// ── Ad Server Functions ──────────────────────────────

export interface AdRow {
  id: number;
  company_name: string;
  headline: string;
  body_text: string;
  image_url: string | null;
  link_url: string;
  placement: "dashboard" | "scan" | "meals";
  active: boolean;
  created_at: string;
}

export const getAdsFn = createServerFn({ method: "GET" })
  .validator((data: { token: string; placement: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const validPlacements = ["dashboard", "scan", "meals"];
    if (!validPlacements.includes(data.placement)) {
      throw new Error(`Placement must be one of: ${validPlacements.join(", ")}`);
    }

    store.seedAdsIfEmpty();

    const ads = store.getActiveAdsByPlacement(
      data.placement as "dashboard" | "scan" | "meals",
    );

    // Pick a random ad from the active ones
    if (ads.length === 0) return { ad: null };

    const picked = ads[Math.floor(Math.random() * ads.length)];
    return { ad: picked as AdRow };
  });

export const trackAdEventFn = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; adId: number; eventType: string }) => data,
  )
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const validTypes = ["impression", "click"];
    if (!validTypes.includes(data.eventType)) {
      throw new Error(`Event type must be one of: ${validTypes.join(", ")}`);
    }

    const ad = store.findAdById(data.adId);
    if (!ad) throw new Error("Ad not found");

    store.insertAdEvent(data.adId, data.eventType as "impression" | "click");
    return { success: true };
  });

// ── Password Reset Server Functions ───────────────────

export const requestPasswordResetFn = createServerFn({ method: "POST" })
  .validator((data: { email: string }) => data)
  .handler(async ({ data }) => {
    const { email } = data;

    if (!email) {
      throw new Error("Email is required");
    }

    // Find user by email
    const user = store.findUserByEmail(email);

    // Always return success to prevent email enumeration
    if (!user) {
      return { success: true };
    }

    try {
      // Generate token: 32 random bytes as hex, expires in 1 hour
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      store.insertPasswordResetToken(user.id, token, expiresAt);

      // Generate reset email
      const { sendPasswordResetEmail } = await import("./email.server");
      sendPasswordResetEmail(
        { id: user.id, email: user.email, name: user.name },
        token,
      );
    } catch (err) {
      console.error("Failed to generate password reset email:", err);
      // Still return success to prevent enumeration
    }

    return { success: true };
  });

export const resetPasswordFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; newPassword: string }) => data)
  .handler(async ({ data }) => {
    const { token, newPassword } = data;

    if (!token || !newPassword) {
      throw new Error("Token and new password are required");
    }

    if (newPassword.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    // Look up token
    const resetRow = store.findPasswordResetToken(token);
    if (!resetRow) {
      throw new Error("Invalid or expired reset link. Please request a new one.");
    }

    // Check if already used
    if (resetRow.used) {
      throw new Error("This reset link has already been used. Please request a new one.");
    }

    // Check if expired
    if (new Date(resetRow.expires_at) < new Date()) {
      throw new Error("This reset link has expired. Please request a new one.");
    }

    // Mark as used
    store.markResetTokenUsed(resetRow.id);

    // Hash new password and update
    const newHash = hashPassword(newPassword);
    store.updateUserPassword(resetRow.user_id, newHash);

    return { success: true };
  });

// ── Subscription Email Confirmation ───────────────────

export const sendSubscriptionConfirmationFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const userRow = store.findUserById(user.id);
    if (!userRow || userRow.subscription_status !== "active") {
      return { sent: false, reason: "Subscription not active" };
    }

    try {
      const { sendSubscriptionConfirmation } = await import("./email.server");
      sendSubscriptionConfirmation({
        id: user.id,
        email: user.email,
        name: user.name,
      });
      return { sent: true };
    } catch (err) {
      console.error("Failed to generate subscription confirmation email:", err);
      return { sent: false, reason: "Email generation failed" };
    }
  });

// ── Stripe Subscription Server Functions ──────────────

export const getSubscriptionStatusFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const { getSubscription } = await import("./stripe.server");
    const sub = await getSubscription(user.id);

    const userRow = store.findUserById(user.id);
    const scansRemaining = userRow?.scans_remaining ?? 0;

    return {
      ...sub,
      scans_remaining: scansRemaining,
      isPro: sub.status === "active",
    };
  });

export const createCheckoutSessionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const { createCheckoutSession } = await import("./stripe.server");

    // Use the request origin for success/cancel URLs
    const origin = "https://1556684c19626204e0fe9ccd77d278af.ctonew.app";

    const url = await createCheckoutSession(
      user.id,
      user.email,
      `${origin}/account?checkout=success`,
      `${origin}/pricing?checkout=canceled`,
    );

    return { url };
  });

export const cancelSubscriptionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const { cancelSubscription } = await import("./stripe.server");
    const result = await cancelSubscription(user.id);

    return result;
  });

export const getCustomerPortalUrlFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const user = getUserFromToken(data.token);
    if (!user) throw new Error("Authentication required");

    const { createCustomerPortalSession } = await import("./stripe.server");
    const origin = "https://1556684c19626204e0fe9ccd77d278af.ctonew.app";
    const url = await createCustomerPortalSession(
      user.id,
      `${origin}/account`,
    );

    return { url };
  });
