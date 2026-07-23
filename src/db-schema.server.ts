import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Resolve DB path relative to the project root (site directory).
// In both dev (Vite SSR) and production (Bun serve), process.cwd() is the site root.
const DB_DIR = join(process.cwd(), "db");
const DB_PATH = join(DB_DIR, "sensiskan.json");

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
}

interface SessionRow {
  id: number;
  user_id: number;
  token: string;
  created_at: string;
}

interface SensitivityRow {
  id: number;
  user_id: number;
  ingredient_name: string;
  category: "food" | "skincare" | "both";
  severity: "mild" | "moderate" | "severe";
  created_at: string;
}

interface ScanHistoryRow {
  id: number;
  user_id: number;
  product_barcode: string;
  product_name: string | null;
  product_image: string | null;
  match_found: number;
  matched_ingredients: string;
  scanned_at: string;
}

interface MealTemplateRow {
  id: number;
  name: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  ingredients: string; // JSON array of ingredient names
  recipe_url: string | null;
  calories: number | null;
  image_url: string | null;
}

interface MealPlanRow {
  id: number;
  user_id: number;
  date: string; // YYYY-MM-DD
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  meal_template_id: number;
  notes: string | null;
  created_at: string;
}

interface ReactionRow {
  id: number;
  user_id: number;
  date: string; // YYYY-MM-DD
  category: "food" | "skincare";
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | null;
  description: string;
  severity: "mild" | "moderate" | "severe";
  ingredients_raw: string; // JSON array of ingredient names
  created_at: string;
}

interface DiscoveredSensitivityRow {
  id: number;
  user_id: number;
  ingredient_name: string;
  category: "food" | "skincare" | "both";
  confidence_score: number;
  occurrence_count: number;
  status: "suggested" | "confirmed" | "dismissed";
  created_at: string;
}

interface AdRow {
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

interface AdEventRow {
  id: number;
  ad_id: number;
  event_type: "impression" | "click";
  created_at: string;
}

interface Database {
  _meta: {
    nextUserId: number;
    nextSessionId: number;
    nextSensitivityId: number;
    nextScanId: number;
    nextMealTemplateId: number;
    nextMealPlanId: number;
    nextReactionId: number;
    nextDiscoveredSensitivityId: number;
    nextAdId: number;
    nextAdEventId: number;
  };
  users: UserRow[];
  sessions: SessionRow[];
  sensitivities: SensitivityRow[];
  scan_history: ScanHistoryRow[];
  meal_templates: MealTemplateRow[];
  meal_plans: MealPlanRow[];
  reactions: ReactionRow[];
  discovered_sensitivities: DiscoveredSensitivityRow[];
  ads: AdRow[];
  ad_events: AdEventRow[];
}

function loadDb(): Database {
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  if (!existsSync(DB_PATH)) {
    const initial: Database = {
      _meta: {
        nextUserId: 1,
        nextSessionId: 1,
        nextSensitivityId: 1,
        nextScanId: 1,
        nextMealTemplateId: 1,
        nextMealPlanId: 1,
        nextReactionId: 1,
        nextDiscoveredSensitivityId: 1,
        nextAdId: 1,
        nextAdEventId: 1,
      },
      users: [],
      sessions: [],
      sensitivities: [],
      scan_history: [],
      meal_templates: [],
      meal_plans: [],
      reactions: [],
      discovered_sensitivities: [],
      ads: [],
      ad_events: [],
    };
    writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }

  const raw = readFileSync(DB_PATH, "utf-8");
  const db = JSON.parse(raw) as Database;

  // Migrate: ensure all meta fields exist
  if (db._meta.nextMealTemplateId === undefined) db._meta.nextMealTemplateId = 1;
  if (db._meta.nextMealPlanId === undefined) db._meta.nextMealPlanId = 1;
  if (db._meta.nextReactionId === undefined) db._meta.nextReactionId = 1;
  if (db._meta.nextDiscoveredSensitivityId === undefined) db._meta.nextDiscoveredSensitivityId = 1;
  if (db._meta.nextAdId === undefined) db._meta.nextAdId = 1;
  if (db._meta.nextAdEventId === undefined) db._meta.nextAdEventId = 1;
  if (!db.meal_templates) db.meal_templates = [];
  if (!db.meal_plans) db.meal_plans = [];
  if (!db.reactions) db.reactions = [];
  if (!db.discovered_sensitivities) db.discovered_sensitivities = [];
  if (!db.ads) db.ads = [];
  if (!db.ad_events) db.ad_events = [];

  return db;
}

function saveDb(db: Database): void {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── Public API ──────────────────────────────────────────────

const store = {
  _db: undefined as Database | undefined,

  get db(): Database {
    if (!this._db) {
      this._db = loadDb();
    }
    return this._db;
  },

  save(): void {
    if (this._db) {
      saveDb(this._db);
    }
  },

  // Users
  insertUser(
    email: string,
    passwordHash: string,
    name: string,
  ): UserRow {
    const db = this.db;
    const id = db._meta.nextUserId++;
    const user: UserRow = {
      id,
      email,
      password_hash: passwordHash,
      name,
      created_at: new Date().toISOString(),
    };
    db.users.push(user);
    this.save();
    return user;
  },

  findUserByEmail(email: string): UserRow | undefined {
    return this.db.users.find((u) => u.email === email);
  },

  findUserById(id: number): UserRow | undefined {
    return this.db.users.find((u) => u.id === id);
  },

  // Sessions
  insertSession(userId: number, token: string): SessionRow {
    const db = this.db;
    const id = db._meta.nextSessionId++;
    const session: SessionRow = {
      id,
      user_id: userId,
      token,
      created_at: new Date().toISOString(),
    };
    db.sessions.push(session);
    this.save();
    return session;
  },

  findSessionByToken(token: string): SessionRow | undefined {
    return this.db.sessions.find((s) => s.token === token);
  },

  deleteSessionByToken(token: string): void {
    const db = this.db;
    db.sessions = db.sessions.filter((s) => s.token !== token);
    this.save();
  },

  // Sensitivities
  insertSensitivity(
    userId: number,
    ingredientName: string,
    category: "food" | "skincare" | "both",
    severity: "mild" | "moderate" | "severe",
  ): SensitivityRow {
    const db = this.db;
    const id = db._meta.nextSensitivityId++;
    const sensitivity: SensitivityRow = {
      id,
      user_id: userId,
      ingredient_name: ingredientName,
      category,
      severity,
      created_at: new Date().toISOString(),
    };
    db.sensitivities.push(sensitivity);
    this.save();
    return sensitivity;
  },

  findSensitivitiesByUserId(userId: number): SensitivityRow[] {
    return this.db.sensitivities.filter((s) => s.user_id === userId);
  },

  findSensitivityById(id: number): SensitivityRow | undefined {
    return this.db.sensitivities.find((s) => s.id === id);
  },

  deleteSensitivityById(id: number): boolean {
    const db = this.db;
    const idx = db.sensitivities.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    db.sensitivities.splice(idx, 1);
    this.save();
    return true;
  },

  // Scan History
  insertScanHistory(
    userId: number,
    barcode: string,
    productName: string | null,
    productImage: string | null,
    matchFound: boolean,
    matchedIngredients: string[],
  ): ScanHistoryRow {
    const db = this.db;
    const id = db._meta.nextScanId++;
    const scan: ScanHistoryRow = {
      id,
      user_id: userId,
      product_barcode: barcode,
      product_name: productName,
      product_image: productImage,
      match_found: matchFound ? 1 : 0,
      matched_ingredients: JSON.stringify(matchedIngredients),
      scanned_at: new Date().toISOString(),
    };
    db.scan_history.push(scan);
    this.save();
    return scan;
    },

    // Meal Templates
    insertMealTemplate(
    name: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
    ingredients: string[],
    recipeUrl: string | null,
    calories: number | null,
    imageUrl: string | null,
  ): MealTemplateRow {
    const db = this.db;
    const id = db._meta.nextMealTemplateId++;
    const template: MealTemplateRow = {
      id,
      name,
      meal_type: mealType,
      ingredients: JSON.stringify(ingredients),
      recipe_url: recipeUrl,
      calories,
      image_url: imageUrl,
    };
    db.meal_templates.push(template);
    this.save();
    return template;
  },

  getAllMealTemplates(): MealTemplateRow[] {
    return this.db.meal_templates;
  },

  getMealTemplatesByType(mealType: string): MealTemplateRow[] {
    return this.db.meal_templates.filter((t) => t.meal_type === mealType);
  },

  findMealTemplateById(id: number): MealTemplateRow | undefined {
    return this.db.meal_templates.find((t) => t.id === id);
  },

  seedMealTemplatesIfEmpty(): void {
    if (this.db.meal_templates.length > 0) return;

    const templates: Array<{
      name: string;
      meal_type: "breakfast" | "lunch" | "dinner" | "snack";
      ingredients: string[];
      calories: number;
    }> = [
      // Breakfasts
      { name: "Oatmeal with Berries", meal_type: "breakfast", ingredients: ["oats", "mixed berries", "honey", "milk", "cinnamon"], calories: 350 },
      { name: "Avocado Toast", meal_type: "breakfast", ingredients: ["whole grain bread", "avocado", "lemon juice", "red pepper flakes", "olive oil", "salt"], calories: 300 },
      { name: "Smoothie Bowl", meal_type: "breakfast", ingredients: ["banana", "frozen berries", "spinach", "almond milk", "granola", "chia seeds"], calories: 400 },
      { name: "Scrambled Eggs with Spinach", meal_type: "breakfast", ingredients: ["eggs", "spinach", "butter", "salt", "black pepper", "cheddar cheese"], calories: 320 },
      { name: "Greek Yogurt Parfait", meal_type: "breakfast", ingredients: ["greek yogurt", "honey", "granola", "fresh fruit", "walnuts"], calories: 280 },
      // Lunches
      { name: "Grilled Chicken Salad", meal_type: "lunch", ingredients: ["chicken breast", "mixed greens", "cherry tomatoes", "cucumber", "olive oil", "balsamic vinegar"], calories: 420 },
      { name: "Quinoa Buddha Bowl", meal_type: "lunch", ingredients: ["quinoa", "sweet potato", "chickpeas", "kale", "tahini", "lemon juice", "olive oil"], calories: 480 },
      { name: "Turkey Wrap", meal_type: "lunch", ingredients: ["turkey breast", "whole wheat tortilla", "lettuce", "tomato", "mustard", "avocado"], calories: 390 },
      { name: "Lentil Soup", meal_type: "lunch", ingredients: ["red lentils", "carrots", "celery", "onion", "garlic", "vegetable broth", "cumin", "olive oil"], calories: 350 },
      { name: "Tuna Salad Sandwich", meal_type: "lunch", ingredients: ["canned tuna", "mayonnaise", "celery", "whole grain bread", "lettuce", "lemon juice"], calories: 380 },
      // Dinners
      { name: "Baked Salmon with Vegetables", meal_type: "dinner", ingredients: ["salmon fillet", "asparagus", "lemon", "olive oil", "garlic", "dill", "salt"], calories: 450 },
      { name: "Stir-Fried Tofu and Rice", meal_type: "dinner", ingredients: ["firm tofu", "brown rice", "broccoli", "bell peppers", "soy sauce", "sesame oil", "ginger"], calories: 430 },
      { name: "Herb-Roasted Chicken", meal_type: "dinner", ingredients: ["chicken thighs", "rosemary", "thyme", "garlic", "olive oil", "potatoes", "carrots"], calories: 520 },
      { name: "Pasta Primavera", meal_type: "dinner", ingredients: ["pasta", "zucchini", "bell peppers", "cherry tomatoes", "olive oil", "parmesan", "basil", "garlic"], calories: 460 },
      { name: "Beef and Vegetable Stir-Fry", meal_type: "dinner", ingredients: ["beef strips", "broccoli", "snap peas", "soy sauce", "garlic", "ginger", "brown rice", "sesame oil"], calories: 510 },
      // Snacks
      { name: "Apple with Almond Butter", meal_type: "snack", ingredients: ["apple", "almond butter"], calories: 200 },
      { name: "Greek Yogurt with Honey", meal_type: "snack", ingredients: ["greek yogurt", "honey"], calories: 150 },
      { name: "Veggie Sticks with Hummus", meal_type: "snack", ingredients: ["carrots", "celery", "cucumber", "hummus"], calories: 180 },
      { name: "Rice Cakes with Avocado", meal_type: "snack", ingredients: ["rice cakes", "avocado", "salt", "lime juice"], calories: 170 },
      { name: "Trail Mix", meal_type: "snack", ingredients: ["almonds", "walnuts", "dried cranberries", "dark chocolate chips", "pumpkin seeds"], calories: 250 },
    ];

    for (const t of templates) {
      this.insertMealTemplate(t.name, t.meal_type, t.ingredients, null, t.calories, null);
    }
  },

  // Meal Plans
  insertMealPlan(
    userId: number,
    date: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
    templateId: number,
    notes: string | null,
  ): MealPlanRow {
    const db = this.db;
    const id = db._meta.nextMealPlanId++;
    const plan: MealPlanRow = {
      id,
      user_id: userId,
      date,
      meal_type: mealType,
      meal_template_id: templateId,
      notes,
      created_at: new Date().toISOString(),
    };
    db.meal_plans.push(plan);
    this.save();
    return plan;
  },

  findMealPlansByUserAndDateRange(userId: number, startDate: string, endDate: string): MealPlanRow[] {
    return this.db.meal_plans.filter(
      (p) => p.user_id === userId && p.date >= startDate && p.date <= endDate,
    );
  },

  findMealPlansByUserAndDate(userId: number, date: string): MealPlanRow[] {
    return this.db.meal_plans.filter(
      (p) => p.user_id === userId && p.date === date,
    );
  },

  findMealPlanById(id: number): MealPlanRow | undefined {
    return this.db.meal_plans.find((p) => p.id === id);
  },

  deleteMealPlanById(id: number): boolean {
    const db = this.db;
    const idx = db.meal_plans.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    db.meal_plans.splice(idx, 1);
    this.save();
    return true;
  },

  deleteMealPlansForUserAndDate(userId: number, date: string): void {
    const db = this.db;
    db.meal_plans = db.meal_plans.filter(
      (p) => !(p.user_id === userId && p.date === date),
    );
    this.save();
  },

  // Reactions
  insertReaction(
    userId: number,
    date: string,
    category: "food" | "skincare",
    mealType: "breakfast" | "lunch" | "dinner" | "snack" | null,
    description: string,
    severity: "mild" | "moderate" | "severe",
    ingredients: string[],
  ): ReactionRow {
    const db = this.db;
    const id = db._meta.nextReactionId++;
    const reaction: ReactionRow = {
      id,
      user_id: userId,
      date,
      category,
      meal_type: mealType,
      description,
      severity,
      ingredients_raw: JSON.stringify(ingredients),
      created_at: new Date().toISOString(),
    };
    db.reactions.push(reaction);
    this.save();
    return reaction;
  },

  findReactionsByUserAndDate(userId: number, date: string): ReactionRow[] {
    return this.db.reactions.filter(
      (r) => r.user_id === userId && r.date === date,
    );
  },

  findReactionsByUserId(userId: number): ReactionRow[] {
    return this.db.reactions.filter((r) => r.user_id === userId);
  },

  findReactionById(id: number): ReactionRow | undefined {
    return this.db.reactions.find((r) => r.id === id);
  },

  deleteReactionById(id: number): boolean {
    const db = this.db;
    const idx = db.reactions.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    db.reactions.splice(idx, 1);
    this.save();
    return true;
  },

  getDistinctReactionDates(userId: number): string[] {
    const dates = new Set<string>();
    for (const r of this.db.reactions) {
      if (r.user_id === userId) dates.add(r.date);
    }
    return Array.from(dates).sort().reverse();
  },

  // Discovered Sensitivities
  insertDiscoveredSensitivity(
    userId: number,
    ingredientName: string,
    category: "food" | "skincare" | "both",
    confidenceScore: number,
    occurrenceCount: number,
    status: "suggested" | "confirmed" | "dismissed",
  ): DiscoveredSensitivityRow {
    const db = this.db;
    const id = db._meta.nextDiscoveredSensitivityId++;
    const ds: DiscoveredSensitivityRow = {
      id,
      user_id: userId,
      ingredient_name: ingredientName,
      category,
      confidence_score: confidenceScore,
      occurrence_count: occurrenceCount,
      status,
      created_at: new Date().toISOString(),
    };
    db.discovered_sensitivities.push(ds);
    this.save();
    return ds;
  },

  findDiscoveredSensitivitiesByUserId(userId: number): DiscoveredSensitivityRow[] {
    return this.db.discovered_sensitivities.filter((ds) => ds.user_id === userId);
  },

  findDiscoveredSensitivityById(id: number): DiscoveredSensitivityRow | undefined {
    return this.db.discovered_sensitivities.find((ds) => ds.id === id);
  },

  updateDiscoveredSensitivityStatus(
    id: number,
    status: "suggested" | "confirmed" | "dismissed",
  ): boolean {
    const ds = this.db.discovered_sensitivities.find((d) => d.id === id);
    if (!ds) return false;
    ds.status = status;
    this.save();
    return true;
  },

  deleteDiscoveredSensitivityById(id: number): boolean {
    const db = this.db;
    const idx = db.discovered_sensitivities.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    db.discovered_sensitivities.splice(idx, 1);
    this.save();
    return true;
  },

  deleteAllDiscoveredSensitivitiesForUser(userId: number): void {
    const db = this.db;
    db.discovered_sensitivities = db.discovered_sensitivities.filter(
      (d) => d.user_id !== userId,
    );
    this.save();
  },

  // ── Ads ────────────────────────────────────────────

  insertAd(
    companyName: string,
    headline: string,
    bodyText: string,
    imageUrl: string | null,
    linkUrl: string,
    placement: "dashboard" | "scan" | "meals",
    active: boolean,
  ): AdRow {
    const db = this.db;
    const id = db._meta.nextAdId++;
    const ad: AdRow = {
      id,
      company_name: companyName,
      headline,
      body_text: bodyText,
      image_url: imageUrl,
      link_url: linkUrl,
      placement,
      active,
      created_at: new Date().toISOString(),
    };
    db.ads.push(ad);
    this.save();
    return ad;
  },

  getActiveAdsByPlacement(placement: "dashboard" | "scan" | "meals"): AdRow[] {
    return this.db.ads.filter(
      (a) => a.placement === placement && a.active,
    );
  },

  getAllAds(): AdRow[] {
    return this.db.ads;
  },

  findAdById(id: number): AdRow | undefined {
    return this.db.ads.find((a) => a.id === id);
  },

  insertAdEvent(adId: number, eventType: "impression" | "click"): AdEventRow {
    const db = this.db;
    const id = db._meta.nextAdEventId++;
    const event: AdEventRow = {
      id,
      ad_id: adId,
      event_type: eventType,
      created_at: new Date().toISOString(),
    };
    db.ad_events.push(event);
    this.save();
    return event;
  },

  seedAdsIfEmpty(): void {
    if (this.db.ads.length > 0) return;

    const demoAds: Array<{
      company_name: string;
      headline: string;
      body_text: string;
      link_url: string;
      placement: "dashboard" | "scan" | "meals";
    }> = [
      {
        company_name: "Everlywell",
        headline: "Discover Your Food Sensitivities at Home",
        body_text:
          "Everlywell's at-home test kit helps you identify food sensitivities. Get 15% off with code SENSISCAN15. No needles, lab-certified results.",
        link_url: "https://www.everlywell.com/products/food-sensitivity/",
        placement: "dashboard",
      },
      {
        company_name: "Check My Body Health",
        headline: "Pinpoint Your Trigger Foods",
        body_text:
          "A simple hair test can reveal your body's unique food sensitivities. No blood draw — just mail in a hair sample. Results in 5 days.",
        link_url: "https://checkmybodyhealth.com/",
        placement: "scan",
      },
      {
        company_name: "YorkTest",
        headline: "Understand Your Body's Food Sensitivities",
        body_text:
          "YorkTest's premium food sensitivity testing analyzes IgG reactions to 200+ ingredients. Take control of your diet.",
        link_url: "https://www.yorktest.com/",
        placement: "meals",
      },
      // Extra ads to provide variety
      {
        company_name: "Everlywell",
        headline: "Find Your Food Triggers — Everlywell",
        body_text:
          "Comprehensive food sensitivity testing from the comfort of home. Free shipping, CLIA-certified labs.",
        link_url: "https://www.everlywell.com/products/food-sensitivity/",
        placement: "scan",
      },
      {
        company_name: "Check My Body Health",
        headline: "Hair-Based Sensitivity Testing",
        body_text:
          "Check My Body Health tests for 900+ sensitivities using just a hair sample. Quick, painless, and shipped to your door.",
        link_url: "https://checkmybodyhealth.com/",
        placement: "dashboard",
      },
      {
        company_name: "YorkTest",
        headline: "Premium Food Sensitivity Testing",
        body_text:
          "Get a detailed report on your body's reaction to over 200 foods. YorkTest — trusted for 40+ years.",
        link_url: "https://www.yorktest.com/",
        placement: "meals",
      },
    ];

    for (const ad of demoAds) {
      this.insertAd(
        ad.company_name,
        ad.headline,
        ad.body_text,
        null,
        ad.link_url,
        ad.placement,
        true,
      );
    }
  },
};

export default store;
