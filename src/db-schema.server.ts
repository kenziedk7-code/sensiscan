import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Resolve DB path relative to the project root (site directory).
const DB_DIR = join(process.cwd(), "db");
const JSON_PATH = join(DB_DIR, "sensiskan.json");
const SQLITE_PATH = join(DB_DIR, "sensiskan.db");

// ── Type Definitions ──────────────────────────────────────

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  stripe_customer_id: string | null;
  subscription_status: "active" | "canceled" | "past_due" | "none";
  subscription_end_date: string | null;
  scans_remaining: number;
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
  ingredients: string;
  recipe_url: string | null;
  calories: number | null;
  image_url: string | null;
}

interface MealPlanRow {
  id: number;
  user_id: number;
  date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  meal_template_id: number;
  notes: string | null;
  created_at: string;
}

interface ReactionRow {
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

interface PasswordResetTokenRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

interface EmailLogRow {
  id: number;
  user_id: number;
  email_type: "welcome" | "reset" | "subscription";
  to_address: string;
  subject: string;
  sent_at: string;
}

interface Database {
  _meta: Record<string, unknown>;
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
  password_reset_tokens: PasswordResetTokenRow[];
  email_logs: EmailLogRow[];
}

// ── SQLite loader (opaque to Vite) ────────────────────────

let _sqliteModule: any = null;
let _sqliteDb: any = null;
let _sqliteChecked = false;

function getSqliteModule(): any | null {
  if (_sqliteChecked) return _sqliteModule;
  _sqliteChecked = true;
  try {
    // Use new Function so Vite/Rollup doesn't statically analyze "bun:sqlite"
    const loader = new Function("return require('bun:sqlite')");
    _sqliteModule = loader();
    return _sqliteModule;
  } catch {
    return null;
  }
}

function openSqlite(): any | null {
  if (_sqliteDb) return _sqliteDb;
  const mod = getSqliteModule();
  if (!mod) return null;
  try {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    _sqliteDb = new mod.Database(SQLITE_PATH);
    // Enable WAL mode for better concurrent access
    _sqliteDb.run("PRAGMA journal_mode=WAL");
    _sqliteDb.run("PRAGMA foreign_keys=ON");
    ensureSqliteSchema(_sqliteDb);
    maybeMigrateFromJson(_sqliteDb);
    return _sqliteDb;
  } catch (err) {
    console.error("[sqlite] Failed to open SQLite database:", err);
    _sqliteDb = null;
    return null;
  }
}

function ensureSqliteSchema(db: any): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      stripe_customer_id TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'none',
      subscription_end_date TEXT,
      scans_remaining INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sensitivities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ingredient_name TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_barcode TEXT NOT NULL,
      product_name TEXT,
      product_image TEXT,
      match_found INTEGER NOT NULL DEFAULT 0,
      matched_ingredients TEXT NOT NULL DEFAULT '[]',
      scanned_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS meal_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      ingredients TEXT NOT NULL DEFAULT '[]',
      recipe_url TEXT,
      calories INTEGER,
      image_url TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS meal_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      meal_template_id INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (meal_template_id) REFERENCES meal_templates(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      meal_type TEXT,
      description TEXT NOT NULL,
      severity TEXT NOT NULL,
      ingredients_raw TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS discovered_sensitivities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ingredient_name TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence_score REAL NOT NULL DEFAULT 0,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      headline TEXT NOT NULL,
      body_text TEXT NOT NULL,
      image_url TEXT,
      link_url TEXT NOT NULL,
      placement TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ad_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ad_id) REFERENCES ads(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email_type TEXT NOT NULL,
      to_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function maybeMigrateFromJson(db: any): void {
  if (!existsSync(JSON_PATH)) return;
  try {
    const count = db.query("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
    if (count.cnt > 0) return; // Already has data
  } catch {
    return;
  }

  try {
    const raw = readFileSync(JSON_PATH, "utf-8");
    const jsonDb = JSON.parse(raw) as Database;
    console.log("[sqlite] Migrating data from JSON to SQLite...");

    const now = new Date().toISOString();

    // Insert users
    const insertUser = db.prepare(
      "INSERT INTO users (email, password_hash, name, stripe_customer_id, subscription_status, subscription_end_date, scans_remaining, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const u of jsonDb.users || []) {
      insertUser.run(
        u.email,
        u.password_hash,
        u.name,
        u.stripe_customer_id || null,
        u.subscription_status || "none",
        u.subscription_end_date || null,
        u.scans_remaining ?? 10,
        u.created_at || now
      );
    }

    // Insert sessions
    const insertSession = db.prepare(
      "INSERT INTO sessions (user_id, token, created_at) VALUES (?, ?, ?)"
    );
    for (const s of jsonDb.sessions || []) {
      insertSession.run(s.user_id, s.token, s.created_at || now);
    }

    // Insert sensitivities
    const insertSens = db.prepare(
      "INSERT INTO sensitivities (user_id, ingredient_name, category, severity, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const s of jsonDb.sensitivities || []) {
      insertSens.run(s.user_id, s.ingredient_name, s.category, s.severity, s.created_at || now);
    }

    // Insert scan_history
    const insertScan = db.prepare(
      "INSERT INTO scan_history (user_id, product_barcode, product_name, product_image, match_found, matched_ingredients, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const s of jsonDb.scan_history || []) {
      insertScan.run(
        s.user_id,
        s.product_barcode,
        s.product_name || null,
        s.product_image || null,
        s.match_found,
        s.matched_ingredients || "[]",
        s.scanned_at || now
      );
    }

    // Insert meal_templates
    const insertTemplate = db.prepare(
      "INSERT INTO meal_templates (name, meal_type, ingredients, recipe_url, calories, image_url) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const t of jsonDb.meal_templates || []) {
      insertTemplate.run(
        t.name,
        t.meal_type,
        t.ingredients || "[]",
        t.recipe_url || null,
        t.calories || null,
        t.image_url || null
      );
    }

    // Insert meal_plans
    const insertPlan = db.prepare(
      "INSERT INTO meal_plans (user_id, date, meal_type, meal_template_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const p of jsonDb.meal_plans || []) {
      insertPlan.run(p.user_id, p.date, p.meal_type, p.meal_template_id, p.notes || null, p.created_at || now);
    }

    // Insert reactions
    const insertReaction = db.prepare(
      "INSERT INTO reactions (user_id, date, category, meal_type, description, severity, ingredients_raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const r of jsonDb.reactions || []) {
      insertReaction.run(
        r.user_id,
        r.date,
        r.category,
        r.meal_type || null,
        r.description,
        r.severity,
        r.ingredients_raw || "[]",
        r.created_at || now
      );
    }

    // Insert discovered_sensitivities
    const insertDisc = db.prepare(
      "INSERT INTO discovered_sensitivities (user_id, ingredient_name, category, confidence_score, occurrence_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const d of jsonDb.discovered_sensitivities || []) {
      insertDisc.run(
        d.user_id,
        d.ingredient_name,
        d.category,
        d.confidence_score,
        d.occurrence_count,
        d.status,
        d.created_at || now
      );
    }

    // Insert ads
    const insertAd = db.prepare(
      "INSERT INTO ads (company_name, headline, body_text, image_url, link_url, placement, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const a of jsonDb.ads || []) {
      insertAd.run(
        a.company_name,
        a.headline,
        a.body_text,
        a.image_url || null,
        a.link_url,
        a.placement,
        a.active ? 1 : 0,
        a.created_at || now
      );
    }

    // Insert ad_events
    const insertAdEvent = db.prepare(
      "INSERT INTO ad_events (ad_id, event_type, created_at) VALUES (?, ?, ?)"
    );
    for (const e of jsonDb.ad_events || []) {
      insertAdEvent.run(e.ad_id, e.event_type, e.created_at || now);
    }

    // Insert password_reset_tokens
    const insertToken = db.prepare(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const t of jsonDb.password_reset_tokens || []) {
      insertToken.run(t.user_id, t.token, t.expires_at, t.used ? 1 : 0, t.created_at || now);
    }

    // Insert email_logs
    const insertEmail = db.prepare(
      "INSERT INTO email_logs (user_id, email_type, to_address, subject, sent_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const e of jsonDb.email_logs || []) {
      insertEmail.run(e.user_id, e.email_type, e.to_address, e.subject, e.sent_at || now);
    }

    console.log("[sqlite] Migration complete.");
  } catch (err) {
    console.error("[sqlite] Migration failed:", err);
  }
}

// ── SQLite-backed store ──────────────────────────────────

function sqliteStore(db: any) {
  function rowToUser(r: any): UserRow {
    return { ...r, scans_remaining: r.scans_remaining ?? 10 };
  }

  function boolToInt(b: boolean): number {
    return b ? 1 : 0;
  }

  return {
    // No-op save for API compatibility (SQLite writes immediately)
    save(): void {},

    // Users
    insertUser(email: string, passwordHash: string, name: string): UserRow {
      const now = new Date().toISOString();
      const stmt = db.prepare(
        "INSERT INTO users (email, password_hash, name, stripe_customer_id, subscription_status, subscription_end_date, scans_remaining, created_at) VALUES (?, ?, ?, NULL, 'none', NULL, 10, ?)"
      );
      const result = stmt.run(email, passwordHash, name, now);
      return {
        id: Number(result.lastInsertRowid),
        email,
        password_hash: passwordHash,
        name,
        stripe_customer_id: null,
        subscription_status: "none",
        subscription_end_date: null,
        scans_remaining: 10,
        created_at: now,
      };
    },

    findUserByEmail(email: string): UserRow | undefined {
      const row = db.query("SELECT * FROM users WHERE email = ?").get(email) as any;
      return row ? rowToUser(row) : undefined;
    },

    findUserById(id: number): UserRow | undefined {
      const row = db.query("SELECT * FROM users WHERE id = ?").get(id) as any;
      return row ? rowToUser(row) : undefined;
    },

    updateUserSubscription(
      userId: number,
      data: {
        stripe_customer_id?: string;
        subscription_status?: "active" | "canceled" | "past_due" | "none";
        subscription_end_date?: string | null;
        scans_remaining?: number;
      },
    ): UserRow | undefined {
      const existing = this.findUserById(userId);
      if (!existing) return undefined;

      const fields: string[] = [];
      const values: any[] = [];

      if (data.stripe_customer_id !== undefined) {
        fields.push("stripe_customer_id = ?");
        values.push(data.stripe_customer_id);
      }
      if (data.subscription_status !== undefined) {
        fields.push("subscription_status = ?");
        values.push(data.subscription_status);
      }
      if (data.subscription_end_date !== undefined) {
        fields.push("subscription_end_date = ?");
        values.push(data.subscription_end_date);
      }
      if (data.scans_remaining !== undefined) {
        fields.push("scans_remaining = ?");
        values.push(data.scans_remaining);
      }

      if (fields.length > 0) {
        values.push(userId);
        db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, ...values);
      }

      return this.findUserById(userId);
    },

    decrementScans(userId: number): { scans_remaining: number } {
      const user = this.findUserById(userId);
      if (!user) throw new Error("User not found");
      if (user.scans_remaining > 0) {
        db.run("UPDATE users SET scans_remaining = scans_remaining - 1 WHERE id = ?", userId);
      }
      const updated = db.query("SELECT scans_remaining FROM users WHERE id = ?").get(userId) as any;
      return { scans_remaining: updated.scans_remaining };
    },

    resetScans(userId: number): void {
      const user = this.findUserById(userId);
      if (!user) throw new Error("User not found");
      db.run("UPDATE users SET scans_remaining = 999999 WHERE id = ?", userId);
    },

    findUserByStripeCustomerId(customerId: string): UserRow | undefined {
      const row = db.query("SELECT * FROM users WHERE stripe_customer_id = ?").get(customerId) as any;
      return row ? rowToUser(row) : undefined;
    },

    // Sessions
    insertSession(userId: number, token: string): SessionRow {
      const now = new Date().toISOString();
      const result = db.run("INSERT INTO sessions (user_id, token, created_at) VALUES (?, ?, ?)", userId, token, now);
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        token,
        created_at: now,
      };
    },

    findSessionByToken(token: string): SessionRow | undefined {
      return db.query("SELECT * FROM sessions WHERE token = ?").get(token) as SessionRow | undefined;
    },

    deleteSessionByToken(token: string): void {
      db.run("DELETE FROM sessions WHERE token = ?", token);
    },

    // Sensitivities
    insertSensitivity(
      userId: number,
      ingredientName: string,
      category: "food" | "skincare" | "both",
      severity: "mild" | "moderate" | "severe",
    ): SensitivityRow {
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO sensitivities (user_id, ingredient_name, category, severity, created_at) VALUES (?, ?, ?, ?, ?)",
        userId, ingredientName, category, severity, now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        ingredient_name: ingredientName,
        category,
        severity,
        created_at: now,
      };
    },

    findSensitivitiesByUserId(userId: number): SensitivityRow[] {
      return db.query("SELECT * FROM sensitivities WHERE user_id = ?").all(userId) as SensitivityRow[];
    },

    findSensitivityById(id: number): SensitivityRow | undefined {
      return db.query("SELECT * FROM sensitivities WHERE id = ?").get(id) as SensitivityRow | undefined;
    },

    deleteSensitivityById(id: number): boolean {
      const result = db.run("DELETE FROM sensitivities WHERE id = ?", id);
      return result.changes > 0;
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
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO scan_history (user_id, product_barcode, product_name, product_image, match_found, matched_ingredients, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        userId, barcode, productName, productImage, boolToInt(matchFound), JSON.stringify(matchedIngredients), now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        product_barcode: barcode,
        product_name: productName,
        product_image: productImage,
        match_found: boolToInt(matchFound),
        matched_ingredients: JSON.stringify(matchedIngredients),
        scanned_at: now,
      };
    },

    // Access scan_history for getScanHistoryFn (direct query)
    get scan_history_raw(): ScanHistoryRow[] {
      return db.query("SELECT * FROM scan_history").all() as ScanHistoryRow[];
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
      const result = db.run(
        "INSERT INTO meal_templates (name, meal_type, ingredients, recipe_url, calories, image_url) VALUES (?, ?, ?, ?, ?, ?)",
        name, mealType, JSON.stringify(ingredients), recipeUrl, calories, imageUrl
      );
      return {
        id: Number(result.lastInsertRowid),
        name,
        meal_type: mealType,
        ingredients: JSON.stringify(ingredients),
        recipe_url: recipeUrl,
        calories,
        image_url: imageUrl,
      };
    },

    getAllMealTemplates(): MealTemplateRow[] {
      return db.query("SELECT * FROM meal_templates").all() as MealTemplateRow[];
    },

    getMealTemplatesByType(mealType: string): MealTemplateRow[] {
      return db.query("SELECT * FROM meal_templates WHERE meal_type = ?").all(mealType) as MealTemplateRow[];
    },

    findMealTemplateById(id: number): MealTemplateRow | undefined {
      return db.query("SELECT * FROM meal_templates WHERE id = ?").get(id) as MealTemplateRow | undefined;
    },

    seedMealTemplatesIfEmpty(): void {
      const count = (db.query("SELECT COUNT(*) as cnt FROM meal_templates").get() as { cnt: number }).cnt;
      if (count > 0) return;

      const templates: Array<{
        name: string;
        meal_type: "breakfast" | "lunch" | "dinner" | "snack";
        ingredients: string[];
        calories: number;
      }> = [
        { name: "Oatmeal with Berries", meal_type: "breakfast", ingredients: ["oats", "mixed berries", "honey", "milk", "cinnamon"], calories: 350 },
        { name: "Avocado Toast", meal_type: "breakfast", ingredients: ["whole grain bread", "avocado", "lemon juice", "red pepper flakes", "olive oil", "salt"], calories: 300 },
        { name: "Smoothie Bowl", meal_type: "breakfast", ingredients: ["banana", "frozen berries", "spinach", "almond milk", "granola", "chia seeds"], calories: 400 },
        { name: "Scrambled Eggs with Spinach", meal_type: "breakfast", ingredients: ["eggs", "spinach", "butter", "salt", "black pepper", "cheddar cheese"], calories: 320 },
        { name: "Greek Yogurt Parfait", meal_type: "breakfast", ingredients: ["greek yogurt", "honey", "granola", "fresh fruit", "walnuts"], calories: 280 },
        { name: "Grilled Chicken Salad", meal_type: "lunch", ingredients: ["chicken breast", "mixed greens", "cherry tomatoes", "cucumber", "olive oil", "balsamic vinegar"], calories: 420 },
        { name: "Quinoa Buddha Bowl", meal_type: "lunch", ingredients: ["quinoa", "sweet potato", "chickpeas", "kale", "tahini", "lemon juice", "olive oil"], calories: 480 },
        { name: "Turkey Wrap", meal_type: "lunch", ingredients: ["turkey breast", "whole wheat tortilla", "lettuce", "tomato", "mustard", "avocado"], calories: 390 },
        { name: "Lentil Soup", meal_type: "lunch", ingredients: ["red lentils", "carrots", "celery", "onion", "garlic", "vegetable broth", "cumin", "olive oil"], calories: 350 },
        { name: "Tuna Salad Sandwich", meal_type: "lunch", ingredients: ["canned tuna", "mayonnaise", "celery", "whole grain bread", "lettuce", "lemon juice"], calories: 380 },
        { name: "Baked Salmon with Vegetables", meal_type: "dinner", ingredients: ["salmon fillet", "asparagus", "lemon", "olive oil", "garlic", "dill", "salt"], calories: 450 },
        { name: "Stir-Fried Tofu and Rice", meal_type: "dinner", ingredients: ["firm tofu", "brown rice", "broccoli", "bell peppers", "soy sauce", "sesame oil", "ginger"], calories: 430 },
        { name: "Herb-Roasted Chicken", meal_type: "dinner", ingredients: ["chicken thighs", "rosemary", "thyme", "garlic", "olive oil", "potatoes", "carrots"], calories: 520 },
        { name: "Pasta Primavera", meal_type: "dinner", ingredients: ["pasta", "zucchini", "bell peppers", "cherry tomatoes", "olive oil", "parmesan", "basil", "garlic"], calories: 460 },
        { name: "Beef and Vegetable Stir-Fry", meal_type: "dinner", ingredients: ["beef strips", "broccoli", "snap peas", "soy sauce", "garlic", "ginger", "brown rice", "sesame oil"], calories: 510 },
        { name: "Apple with Almond Butter", meal_type: "snack", ingredients: ["apple", "almond butter"], calories: 200 },
        { name: "Greek Yogurt with Honey", meal_type: "snack", ingredients: ["greek yogurt", "honey"], calories: 150 },
        { name: "Veggie Sticks with Hummus", meal_type: "snack", ingredients: ["carrots", "celery", "cucumber", "hummus"], calories: 180 },
        { name: "Rice Cakes with Avocado", meal_type: "snack", ingredients: ["rice cakes", "avocado", "salt", "lime juice"], calories: 170 },
        { name: "Trail Mix", meal_type: "snack", ingredients: ["almonds", "walnuts", "dried cranberries", "dark chocolate chips", "pumpkin seeds"], calories: 250 },
      ];

      const stmt = db.prepare(
        "INSERT INTO meal_templates (name, meal_type, ingredients, recipe_url, calories, image_url) VALUES (?, ?, ?, NULL, ?, NULL)"
      );
      for (const t of templates) {
        stmt.run(t.name, t.meal_type, JSON.stringify(t.ingredients), t.calories);
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
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO meal_plans (user_id, date, meal_type, meal_template_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        userId, date, mealType, templateId, notes, now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        date,
        meal_type: mealType,
        meal_template_id: templateId,
        notes,
        created_at: now,
      };
    },

    findMealPlansByUserAndDateRange(userId: number, startDate: string, endDate: string): MealPlanRow[] {
      return db.query(
        "SELECT * FROM meal_plans WHERE user_id = ? AND date >= ? AND date <= ?"
      ).all(userId, startDate, endDate) as MealPlanRow[];
    },

    findMealPlansByUserAndDate(userId: number, date: string): MealPlanRow[] {
      return db.query(
        "SELECT * FROM meal_plans WHERE user_id = ? AND date = ?"
      ).all(userId, date) as MealPlanRow[];
    },

    findMealPlanById(id: number): MealPlanRow | undefined {
      return db.query("SELECT * FROM meal_plans WHERE id = ?").get(id) as MealPlanRow | undefined;
    },

    deleteMealPlanById(id: number): boolean {
      const result = db.run("DELETE FROM meal_plans WHERE id = ?", id);
      return result.changes > 0;
    },

    deleteMealPlansForUserAndDate(userId: number, date: string): void {
      db.run("DELETE FROM meal_plans WHERE user_id = ? AND date = ?", userId, date);
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
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO reactions (user_id, date, category, meal_type, description, severity, ingredients_raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        userId, date, category, mealType, description, severity, JSON.stringify(ingredients), now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        date,
        category,
        meal_type: mealType,
        description,
        severity,
        ingredients_raw: JSON.stringify(ingredients),
        created_at: now,
      };
    },

    findReactionsByUserAndDate(userId: number, date: string): ReactionRow[] {
      return db.query(
        "SELECT * FROM reactions WHERE user_id = ? AND date = ?"
      ).all(userId, date) as ReactionRow[];
    },

    findReactionsByUserId(userId: number): ReactionRow[] {
      return db.query("SELECT * FROM reactions WHERE user_id = ?").all(userId) as ReactionRow[];
    },

    findReactionById(id: number): ReactionRow | undefined {
      return db.query("SELECT * FROM reactions WHERE id = ?").get(id) as ReactionRow | undefined;
    },

    deleteReactionById(id: number): boolean {
      const result = db.run("DELETE FROM reactions WHERE id = ?", id);
      return result.changes > 0;
    },

    getDistinctReactionDates(userId: number): string[] {
      const rows = db.query(
        "SELECT DISTINCT date FROM reactions WHERE user_id = ? ORDER BY date DESC"
      ).all(userId) as { date: string }[];
      return rows.map((r) => r.date);
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
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO discovered_sensitivities (user_id, ingredient_name, category, confidence_score, occurrence_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        userId, ingredientName, category, confidenceScore, occurrenceCount, status, now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        ingredient_name: ingredientName,
        category,
        confidence_score: confidenceScore,
        occurrence_count: occurrenceCount,
        status,
        created_at: now,
      };
    },

    findDiscoveredSensitivitiesByUserId(userId: number): DiscoveredSensitivityRow[] {
      return db.query(
        "SELECT * FROM discovered_sensitivities WHERE user_id = ?"
      ).all(userId) as DiscoveredSensitivityRow[];
    },

    findDiscoveredSensitivityById(id: number): DiscoveredSensitivityRow | undefined {
      return db.query(
        "SELECT * FROM discovered_sensitivities WHERE id = ?"
      ).get(id) as DiscoveredSensitivityRow | undefined;
    },

    updateDiscoveredSensitivityStatus(
      id: number,
      status: "suggested" | "confirmed" | "dismissed",
    ): boolean {
      const result = db.run(
        "UPDATE discovered_sensitivities SET status = ? WHERE id = ?",
        status, id
      );
      return result.changes > 0;
    },

    deleteDiscoveredSensitivityById(id: number): boolean {
      const result = db.run("DELETE FROM discovered_sensitivities WHERE id = ?", id);
      return result.changes > 0;
    },

    deleteAllDiscoveredSensitivitiesForUser(userId: number): void {
      db.run("DELETE FROM discovered_sensitivities WHERE user_id = ?", userId);
    },

    // Password Reset Tokens
    insertPasswordResetToken(userId: number, token: string, expiresAt: string): PasswordResetTokenRow {
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO password_reset_tokens (user_id, token, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)",
        userId, token, expiresAt, now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        token,
        expires_at: expiresAt,
        used: false,
        created_at: now,
      };
    },

    findPasswordResetToken(token: string): PasswordResetTokenRow | undefined {
      const row = db.query(
        "SELECT * FROM password_reset_tokens WHERE token = ?"
      ).get(token) as any;
      if (!row) return undefined;
      return { ...row, used: !!row.used };
    },

    markResetTokenUsed(id: number): boolean {
      const result = db.run(
        "UPDATE password_reset_tokens SET used = 1 WHERE id = ?", id
      );
      return result.changes > 0;
    },

    updateUserPassword(userId: number, passwordHash: string): boolean {
      const result = db.run(
        "UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, userId
      );
      return result.changes > 0;
    },

    // Email Logs
    insertEmailLog(
      userId: number,
      emailType: "welcome" | "reset" | "subscription",
      toAddress: string,
      subject: string,
    ): EmailLogRow {
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO email_logs (user_id, email_type, to_address, subject, sent_at) VALUES (?, ?, ?, ?, ?)",
        userId, emailType, toAddress, subject, now
      );
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        email_type: emailType,
        to_address: toAddress,
        subject,
        sent_at: now,
      };
    },

    // Ads
    insertAd(
      companyName: string,
      headline: string,
      bodyText: string,
      imageUrl: string | null,
      linkUrl: string,
      placement: "dashboard" | "scan" | "meals",
      active: boolean,
    ): AdRow {
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO ads (company_name, headline, body_text, image_url, link_url, placement, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        companyName, headline, bodyText, imageUrl, linkUrl, placement, boolToInt(active), now
      );
      return {
        id: Number(result.lastInsertRowid),
        company_name: companyName,
        headline,
        body_text: bodyText,
        image_url: imageUrl,
        link_url: linkUrl,
        placement,
        active,
        created_at: now,
      };
    },

    getActiveAdsByPlacement(placement: "dashboard" | "scan" | "meals"): AdRow[] {
      const rows = db.query(
        "SELECT * FROM ads WHERE placement = ? AND active = 1"
      ).all(placement) as any[];
      return rows.map((r: any) => ({ ...r, active: !!r.active }));
    },

    getAllAds(): AdRow[] {
      const rows = db.query("SELECT * FROM ads").all() as any[];
      return rows.map((r: any) => ({ ...r, active: !!r.active }));
    },

    findAdById(id: number): AdRow | undefined {
      const row = db.query("SELECT * FROM ads WHERE id = ?").get(id) as any;
      if (!row) return undefined;
      return { ...row, active: !!row.active };
    },

    insertAdEvent(adId: number, eventType: "impression" | "click"): AdEventRow {
      const now = new Date().toISOString();
      const result = db.run(
        "INSERT INTO ad_events (ad_id, event_type, created_at) VALUES (?, ?, ?)",
        adId, eventType, now
      );
      return {
        id: Number(result.lastInsertRowid),
        ad_id: adId,
        event_type: eventType,
        created_at: now,
      };
    },

    seedAdsIfEmpty(): void {
      const count = (db.query("SELECT COUNT(*) as cnt FROM ads").get() as { cnt: number }).cnt;
      if (count > 0) return;

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
          body_text: "Everlywell's at-home test kit helps you identify food sensitivities. Get 15% off with code SENSISCAN15. No needles, lab-certified results.",
          link_url: "https://www.everlywell.com/products/food-sensitivity/",
          placement: "dashboard",
        },
        {
          company_name: "Check My Body Health",
          headline: "Pinpoint Your Trigger Foods",
          body_text: "A simple hair test can reveal your body's unique food sensitivities. No blood draw — just mail in a hair sample. Results in 5 days.",
          link_url: "https://checkmybodyhealth.com/",
          placement: "scan",
        },
        {
          company_name: "YorkTest",
          headline: "Understand Your Body's Food Sensitivities",
          body_text: "YorkTest's premium food sensitivity testing analyzes IgG reactions to 200+ ingredients. Take control of your diet.",
          link_url: "https://www.yorktest.com/",
          placement: "meals",
        },
        {
          company_name: "Everlywell",
          headline: "Find Your Food Triggers — Everlywell",
          body_text: "Comprehensive food sensitivity testing from the comfort of home. Free shipping, CLIA-certified labs.",
          link_url: "https://www.everlywell.com/products/food-sensitivity/",
          placement: "scan",
        },
        {
          company_name: "Check My Body Health",
          headline: "Hair-Based Sensitivity Testing",
          body_text: "Check My Body Health tests for 900+ sensitivities using just a hair sample. Quick, painless, and shipped to your door.",
          link_url: "https://checkmybodyhealth.com/",
          placement: "dashboard",
        },
        {
          company_name: "YorkTest",
          headline: "Premium Food Sensitivity Testing",
          body_text: "Get a detailed report on your body's reaction to over 200 foods. YorkTest — trusted for 40+ years.",
          link_url: "https://www.yorktest.com/",
          placement: "meals",
        },
      ];

      const stmt = db.prepare(
        "INSERT INTO ads (company_name, headline, body_text, image_url, link_url, placement, active, created_at) VALUES (?, ?, ?, NULL, ?, ?, 1, ?)"
      );
      const now = new Date().toISOString();
      for (const ad of demoAds) {
        stmt.run(ad.company_name, ad.headline, ad.body_text, ad.link_url, ad.placement, now);
      }
    },

    // KV store access (for Stripe price ID cache)
    getKv(key: string): string | null {
      const row = db.query("SELECT value FROM kv_store WHERE key = ?").get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },

    setKv(key: string, value: string): void {
      db.run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", key, value);
    },

    // Access meta (for stripe.server.ts compatibility)
    get _meta(): Record<string, unknown> {
      return {
        get: (key: string) => this.getKv(key),
        set: (key: string, value: string) => this.setKv(key, value),
      };
    },
  };
}

// ── JSON fallback store (same as before, for resilience) ─

function jsonStore() {
  function loadDb(): Database {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }

    if (!existsSync(JSON_PATH)) {
      const initial: Database = {
        _meta: {},
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
        password_reset_tokens: [],
        email_logs: [],
      };
      writeFileSync(JSON_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }

    const raw = readFileSync(JSON_PATH, "utf-8");
    const db = JSON.parse(raw) as Database;

    // Migrate: ensure all arrays exist
    if (!db.meal_templates) db.meal_templates = [];
    if (!db.meal_plans) db.meal_plans = [];
    if (!db.reactions) db.reactions = [];
    if (!db.discovered_sensitivities) db.discovered_sensitivities = [];
    if (!db.ads) db.ads = [];
    if (!db.ad_events) db.ad_events = [];
    if (!db.password_reset_tokens) db.password_reset_tokens = [];
    if (!db.email_logs) db.email_logs = [];

    // Migrate: add subscription fields
    for (const user of db.users) {
      if (user.stripe_customer_id === undefined) user.stripe_customer_id = null;
      if (user.subscription_status === undefined) user.subscription_status = "none";
      if (user.subscription_end_date === undefined) user.subscription_end_date = null;
      if (user.scans_remaining === undefined) user.scans_remaining = 10;
    }

    return db;
  }

  function saveDb(db: Database): void {
    writeFileSync(JSON_PATH, JSON.stringify(db, null, 2));
  }

  let _db: Database | undefined;

  function loadJsonDb(): Database {
    if (!_db) _db = loadDb();
    return _db;
  }

  function save(): void {
    if (_db) saveDb(_db);
  }

  const kvCache: Record<string, string> = {};

  return {
    get _meta() {
      return {
        set: (k: string, v: string) => { kvCache[k] = v; },
        get: (k: string) => kvCache[k] || null,
      };
    },
    save,

    insertUser(email: string, passwordHash: string, name: string): UserRow {
      const d = loadJsonDb();
      const user: UserRow = {
        id: d.users.length + 1,
        email,
        password_hash: passwordHash,
        name,
        stripe_customer_id: null,
        subscription_status: "none",
        subscription_end_date: null,
        scans_remaining: 10,
        created_at: new Date().toISOString(),
      };
      d.users.push(user);
      save();
      return user;
    },
    findUserByEmail(email: string): UserRow | undefined { return db.users.find((u) => u.email === email); },
    findUserById(id: number): UserRow | undefined { return db.users.find((u) => u.id === id); },
    updateUserSubscription(userId: number, data: any): UserRow | undefined {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return undefined;
      if (data.stripe_customer_id !== undefined) user.stripe_customer_id = data.stripe_customer_id;
      if (data.subscription_status !== undefined) user.subscription_status = data.subscription_status;
      if (data.subscription_end_date !== undefined) user.subscription_end_date = data.subscription_end_date;
      if (data.scans_remaining !== undefined) user.scans_remaining = data.scans_remaining;
      save();
      return user;
    },
    decrementScans(userId: number): { scans_remaining: number } {
      const user = db.users.find((u) => u.id === userId);
      if (!user) throw new Error("User not found");
      if (user.scans_remaining > 0) user.scans_remaining--;
      save();
      return { scans_remaining: user.scans_remaining };
    },
    resetScans(userId: number): void {
      const user = db.users.find((u) => u.id === userId);
      if (!user) throw new Error("User not found");
      user.scans_remaining = 999999;
      save();
    },
    findUserByStripeCustomerId(customerId: string): UserRow | undefined {
      return db.users.find((u) => u.stripe_customer_id === customerId);
    },

    insertSession(userId: number, token: string): SessionRow {
      const d = loadJsonDb();
      const s: SessionRow = { id: d.sessions.length + 1, user_id: userId, token, created_at: new Date().toISOString() };
      d.sessions.push(s);
      save();
      return s;
    },
    findSessionByToken(token: string): SessionRow | undefined { return db.sessions.find((s) => s.token === token); },
    deleteSessionByToken(token: string): void {
      const d = loadJsonDb();
      d.sessions = d.sessions.filter((s) => s.token !== token);
      save();
    },

    insertSensitivity(userId: number, ingredientName: string, category: "food" | "skincare" | "both", severity: "mild" | "moderate" | "severe"): SensitivityRow {
      const d = loadJsonDb();
      const s: SensitivityRow = { id: d.sensitivities.length + 1, user_id: userId, ingredient_name: ingredientName, category, severity, created_at: new Date().toISOString() };
      d.sensitivities.push(s);
      save();
      return s;
    },
    findSensitivitiesByUserId(userId: number): SensitivityRow[] { return db.sensitivities.filter((s) => s.user_id === userId); },
    findSensitivityById(id: number): SensitivityRow | undefined { return db.sensitivities.find((s) => s.id === id); },
    deleteSensitivityById(id: number): boolean {
      const d = loadJsonDb();
      const idx = d.sensitivities.findIndex((s) => s.id === id);
      if (idx === -1) return false;
      d.sensitivities.splice(idx, 1);
      save();
      return true;
    },

    insertScanHistory(userId: number, barcode: string, productName: string | null, productImage: string | null, matchFound: boolean, matchedIngredients: string[]): ScanHistoryRow {
      const d = loadJsonDb();
      const s: ScanHistoryRow = { id: d.scan_history.length + 1, user_id: userId, product_barcode: barcode, product_name: productName, product_image: productImage, match_found: matchFound ? 1 : 0, matched_ingredients: JSON.stringify(matchedIngredients), scanned_at: new Date().toISOString() };
      d.scan_history.push(s);
      save();
      return s;
    },
    get scan_history_raw(): ScanHistoryRow[] { return db.scan_history; },

    insertMealTemplate(name: string, mealType: "breakfast" | "lunch" | "dinner" | "snack", ingredients: string[], recipeUrl: string | null, calories: number | null, imageUrl: string | null): MealTemplateRow {
      const d = loadJsonDb();
      const t: MealTemplateRow = { id: d.meal_templates.length + 1, name, meal_type: mealType, ingredients: JSON.stringify(ingredients), recipe_url: recipeUrl, calories, image_url: imageUrl };
      d.meal_templates.push(t);
      save();
      return t;
    },
    getAllMealTemplates(): MealTemplateRow[] { return db.meal_templates; },
    getMealTemplatesByType(mealType: string): MealTemplateRow[] { return db.meal_templates.filter((t) => t.meal_type === mealType); },
    findMealTemplateById(id: number): MealTemplateRow | undefined { return db.meal_templates.find((t) => t.id === id); },
    seedMealTemplatesIfEmpty(): void {
      if (db.meal_templates.length > 0) return;
      const templates = [
        { name: "Oatmeal with Berries", meal_type: "breakfast" as const, ingredients: ["oats", "mixed berries", "honey", "milk", "cinnamon"], calories: 350 },
        { name: "Avocado Toast", meal_type: "breakfast" as const, ingredients: ["whole grain bread", "avocado", "lemon juice", "red pepper flakes", "olive oil", "salt"], calories: 300 },
        { name: "Smoothie Bowl", meal_type: "breakfast" as const, ingredients: ["banana", "frozen berries", "spinach", "almond milk", "granola", "chia seeds"], calories: 400 },
        { name: "Scrambled Eggs with Spinach", meal_type: "breakfast" as const, ingredients: ["eggs", "spinach", "butter", "salt", "black pepper", "cheddar cheese"], calories: 320 },
        { name: "Greek Yogurt Parfait", meal_type: "breakfast" as const, ingredients: ["greek yogurt", "honey", "granola", "fresh fruit", "walnuts"], calories: 280 },
        { name: "Grilled Chicken Salad", meal_type: "lunch" as const, ingredients: ["chicken breast", "mixed greens", "cherry tomatoes", "cucumber", "olive oil", "balsamic vinegar"], calories: 420 },
        { name: "Quinoa Buddha Bowl", meal_type: "lunch" as const, ingredients: ["quinoa", "sweet potato", "chickpeas", "kale", "tahini", "lemon juice", "olive oil"], calories: 480 },
        { name: "Turkey Wrap", meal_type: "lunch" as const, ingredients: ["turkey breast", "whole wheat tortilla", "lettuce", "tomato", "mustard", "avocado"], calories: 390 },
        { name: "Lentil Soup", meal_type: "lunch" as const, ingredients: ["red lentils", "carrots", "celery", "onion", "garlic", "vegetable broth", "cumin", "olive oil"], calories: 350 },
        { name: "Tuna Salad Sandwich", meal_type: "lunch" as const, ingredients: ["canned tuna", "mayonnaise", "celery", "whole grain bread", "lettuce", "lemon juice"], calories: 380 },
        { name: "Baked Salmon with Vegetables", meal_type: "dinner" as const, ingredients: ["salmon fillet", "asparagus", "lemon", "olive oil", "garlic", "dill", "salt"], calories: 450 },
        { name: "Stir-Fried Tofu and Rice", meal_type: "dinner" as const, ingredients: ["firm tofu", "brown rice", "broccoli", "bell peppers", "soy sauce", "sesame oil", "ginger"], calories: 430 },
        { name: "Herb-Roasted Chicken", meal_type: "dinner" as const, ingredients: ["chicken thighs", "rosemary", "thyme", "garlic", "olive oil", "potatoes", "carrots"], calories: 520 },
        { name: "Pasta Primavera", meal_type: "dinner" as const, ingredients: ["pasta", "zucchini", "bell peppers", "cherry tomatoes", "olive oil", "parmesan", "basil", "garlic"], calories: 460 },
        { name: "Beef and Vegetable Stir-Fry", meal_type: "dinner" as const, ingredients: ["beef strips", "broccoli", "snap peas", "soy sauce", "garlic", "ginger", "brown rice", "sesame oil"], calories: 510 },
        { name: "Apple with Almond Butter", meal_type: "snack" as const, ingredients: ["apple", "almond butter"], calories: 200 },
        { name: "Greek Yogurt with Honey", meal_type: "snack" as const, ingredients: ["greek yogurt", "honey"], calories: 150 },
        { name: "Veggie Sticks with Hummus", meal_type: "snack" as const, ingredients: ["carrots", "celery", "cucumber", "hummus"], calories: 180 },
        { name: "Rice Cakes with Avocado", meal_type: "snack" as const, ingredients: ["rice cakes", "avocado", "salt", "lime juice"], calories: 170 },
        { name: "Trail Mix", meal_type: "snack" as const, ingredients: ["almonds", "walnuts", "dried cranberries", "dark chocolate chips", "pumpkin seeds"], calories: 250 },
      ];
      for (const t of templates) {
        this.insertMealTemplate(t.name, t.meal_type, t.ingredients, null, t.calories, null);
      }
    },

    insertMealPlan(userId: number, date: string, mealType: "breakfast" | "lunch" | "dinner" | "snack", templateId: number, notes: string | null): MealPlanRow {
      const d = loadJsonDb();
      const p: MealPlanRow = { id: d.meal_plans.length + 1, user_id: userId, date, meal_type: mealType, meal_template_id: templateId, notes, created_at: new Date().toISOString() };
      d.meal_plans.push(p);
      save();
      return p;
    },
    findMealPlansByUserAndDateRange(userId: number, startDate: string, endDate: string): MealPlanRow[] {
      return db.meal_plans.filter((p) => p.user_id === userId && p.date >= startDate && p.date <= endDate);
    },
    findMealPlansByUserAndDate(userId: number, date: string): MealPlanRow[] {
      return db.meal_plans.filter((p) => p.user_id === userId && p.date === date);
    },
    findMealPlanById(id: number): MealPlanRow | undefined { return db.meal_plans.find((p) => p.id === id); },
    deleteMealPlanById(id: number): boolean {
      const d = loadJsonDb();
      const idx = d.meal_plans.findIndex((p) => p.id === id);
      if (idx === -1) return false;
      d.meal_plans.splice(idx, 1);
      save();
      return true;
    },
    deleteMealPlansForUserAndDate(userId: number, date: string): void {
      const d = loadJsonDb();
      d.meal_plans = d.meal_plans.filter((p) => !(p.user_id === userId && p.date === date));
      save();
    },

    insertReaction(userId: number, date: string, category: "food" | "skincare", mealType: "breakfast" | "lunch" | "dinner" | "snack" | null, description: string, severity: "mild" | "moderate" | "severe", ingredients: string[]): ReactionRow {
      const d = loadJsonDb();
      const r: ReactionRow = { id: d.reactions.length + 1, user_id: userId, date, category, meal_type: mealType, description, severity, ingredients_raw: JSON.stringify(ingredients), created_at: new Date().toISOString() };
      d.reactions.push(r);
      save();
      return r;
    },
    findReactionsByUserAndDate(userId: number, date: string): ReactionRow[] { return db.reactions.filter((r) => r.user_id === userId && r.date === date); },
    findReactionsByUserId(userId: number): ReactionRow[] { return db.reactions.filter((r) => r.user_id === userId); },
    findReactionById(id: number): ReactionRow | undefined { return db.reactions.find((r) => r.id === id); },
    deleteReactionById(id: number): boolean {
      const d = loadJsonDb();
      const idx = d.reactions.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      d.reactions.splice(idx, 1);
      save();
      return true;
    },
    getDistinctReactionDates(userId: number): string[] {
      const dates = new Set<string>();
      for (const r of db.reactions) {
        if (r.user_id === userId) dates.add(r.date);
      }
      return Array.from(dates).sort().reverse();
    },

    insertDiscoveredSensitivity(userId: number, ingredientName: string, category: "food" | "skincare" | "both", confidenceScore: number, occurrenceCount: number, status: "suggested" | "confirmed" | "dismissed"): DiscoveredSensitivityRow {
      const d = loadJsonDb();
      const ds: DiscoveredSensitivityRow = { id: d.discovered_sensitivities.length + 1, user_id: userId, ingredient_name: ingredientName, category, confidence_score: confidenceScore, occurrence_count: occurrenceCount, status, created_at: new Date().toISOString() };
      d.discovered_sensitivities.push(ds);
      save();
      return ds;
    },
    findDiscoveredSensitivitiesByUserId(userId: number): DiscoveredSensitivityRow[] { return db.discovered_sensitivities.filter((ds) => ds.user_id === userId); },
    findDiscoveredSensitivityById(id: number): DiscoveredSensitivityRow | undefined { return db.discovered_sensitivities.find((ds) => ds.id === id); },
    updateDiscoveredSensitivityStatus(id: number, status: "suggested" | "confirmed" | "dismissed"): boolean {
      const ds = db.discovered_sensitivities.find((d) => d.id === id);
      if (!ds) return false;
      ds.status = status;
      save();
      return true;
    },
    deleteDiscoveredSensitivityById(id: number): boolean {
      const d = loadJsonDb();
      const idx = d.discovered_sensitivities.findIndex((ds) => ds.id === id);
      if (idx === -1) return false;
      d.discovered_sensitivities.splice(idx, 1);
      save();
      return true;
    },
    deleteAllDiscoveredSensitivitiesForUser(userId: number): void {
      const d = loadJsonDb();
      d.discovered_sensitivities = d.discovered_sensitivities.filter((ds) => ds.user_id !== userId);
      save();
    },

    insertPasswordResetToken(userId: number, token: string, expiresAt: string): PasswordResetTokenRow {
      const d = loadJsonDb();
      const r: PasswordResetTokenRow = { id: d.password_reset_tokens.length + 1, user_id: userId, token, expires_at: expiresAt, used: false, created_at: new Date().toISOString() };
      d.password_reset_tokens.push(r);
      save();
      return r;
    },
    findPasswordResetToken(token: string): PasswordResetTokenRow | undefined {
      return db.password_reset_tokens.find((t) => t.token === token);
    },
    markResetTokenUsed(id: number): boolean {
      const row = db.password_reset_tokens.find((t) => t.id === id);
      if (!row) return false;
      row.used = true;
      save();
      return true;
    },
    updateUserPassword(userId: number, passwordHash: string): boolean {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return false;
      user.password_hash = passwordHash;
      save();
      return true;
    },

    insertEmailLog(userId: number, emailType: "welcome" | "reset" | "subscription", toAddress: string, subject: string): EmailLogRow {
      const d = loadJsonDb();
      const r: EmailLogRow = { id: d.email_logs.length + 1, user_id: userId, email_type: emailType, to_address: toAddress, subject, sent_at: new Date().toISOString() };
      d.email_logs.push(r);
      save();
      return r;
    },

    insertAd(companyName: string, headline: string, bodyText: string, imageUrl: string | null, linkUrl: string, placement: "dashboard" | "scan" | "meals", active: boolean): AdRow {
      const d = loadJsonDb();
      const a: AdRow = { id: d.ads.length + 1, company_name: companyName, headline, body_text: bodyText, image_url: imageUrl, link_url: linkUrl, placement, active, created_at: new Date().toISOString() };
      d.ads.push(a);
      save();
      return a;
    },
    getActiveAdsByPlacement(placement: "dashboard" | "scan" | "meals"): AdRow[] {
      return db.ads.filter((a) => a.placement === placement && a.active);
    },
    getAllAds(): AdRow[] { return db.ads; },
    findAdById(id: number): AdRow | undefined { return db.ads.find((a) => a.id === id); },
    insertAdEvent(adId: number, eventType: "impression" | "click"): AdEventRow {
      const d = loadJsonDb();
      const e: AdEventRow = { id: d.ad_events.length + 1, ad_id: adId, event_type: eventType, created_at: new Date().toISOString() };
      d.ad_events.push(e);
      save();
      return e;
    },
    seedAdsIfEmpty(): void {
      if (db.ads.length > 0) return;
      const demoAds = [
        { company_name: "Everlywell", headline: "Discover Your Food Sensitivities at Home", body_text: "Everlywell's at-home test kit helps you identify food sensitivities. Get 15% off with code SENSISCAN15. No needles, lab-certified results.", link_url: "https://www.everlywell.com/products/food-sensitivity/", placement: "dashboard" as const },
        { company_name: "Check My Body Health", headline: "Pinpoint Your Trigger Foods", body_text: "A simple hair test can reveal your body's unique food sensitivities. No blood draw — just mail in a hair sample. Results in 5 days.", link_url: "https://checkmybodyhealth.com/", placement: "scan" as const },
        { company_name: "YorkTest", headline: "Understand Your Body's Food Sensitivities", body_text: "YorkTest's premium food sensitivity testing analyzes IgG reactions to 200+ ingredients. Take control of your diet.", link_url: "https://www.yorktest.com/", placement: "meals" as const },
        { company_name: "Everlywell", headline: "Find Your Food Triggers — Everlywell", body_text: "Comprehensive food sensitivity testing from the comfort of home. Free shipping, CLIA-certified labs.", link_url: "https://www.everlywell.com/products/food-sensitivity/", placement: "scan" as const },
        { company_name: "Check My Body Health", headline: "Hair-Based Sensitivity Testing", body_text: "Check My Body Health tests for 900+ sensitivities using just a hair sample. Quick, painless, and shipped to your door.", link_url: "https://checkmybodyhealth.com/", placement: "dashboard" as const },
        { company_name: "YorkTest", headline: "Premium Food Sensitivity Testing", body_text: "Get a detailed report on your body's reaction to over 200 foods. YorkTest — trusted for 40+ years.", link_url: "https://www.yorktest.com/", placement: "meals" as const },
      ];
      for (const ad of demoAds) {
        this.insertAd(ad.company_name, ad.headline, ad.body_text, null, ad.link_url, ad.placement, true);
      }
    },

    getKv(key: string): string | null { return kvCache[key] || null; },
    setKv(key: string, value: string): void { kvCache[key] = value; },
  };
}

// ── Store selector: try SQLite, fall back to JSON ────────

function createStore(): any {
  const db = openSqlite();
  if (db) {
    console.log("[db] Using SQLite database.");
    return sqliteStore(db);
  }
  console.log("[db] SQLite not available, using JSON fallback.");
  return jsonStore();
}

const store = createStore();

// For backward compatibility: expose store._meta as the kv-like access
// The stripe server needs this. Also expose store.db for direct JSON access patterns.
// These only fall through when JSON fallback is used - SQLite uses its own meta accessor.

export default store;
