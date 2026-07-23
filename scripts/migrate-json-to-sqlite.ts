/**
 * Standalone migration script: JSON → SQLite
 * Run with: bun run scripts/migrate-json-to-sqlite.ts
 *
 * Reads db/sensiskan.json and writes all data into db/sensiskan.db.
 * Safe to re-run — won't duplicate data if already migrated.
 */

import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(process.cwd(), "db");
const JSON_PATH = join(DB_DIR, "sensiskan.json");
const SQLITE_PATH = join(DB_DIR, "sensiskan.db");

if (!existsSync(JSON_PATH)) {
  console.log("No JSON database found at", JSON_PATH);
  process.exit(0);
}

const raw = readFileSync(JSON_PATH, "utf-8");
const jsonDb = JSON.parse(raw);

const db = new Database(SQLITE_PATH);
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA foreign_keys=ON");

// Create tables (same as ensureSqliteSchema in db-schema.server.ts)
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
    created_at TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS sensitivities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ingredient_name TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    created_at TEXT NOT NULL
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
    scanned_at TEXT NOT NULL
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
    created_at TEXT NOT NULL
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
    created_at TEXT NOT NULL
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
    created_at TEXT NOT NULL
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
    created_at TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    email_type TEXT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_at TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Check if already migrated
const count = db.query("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
if (count.cnt > 0) {
  console.log("SQLite database already has data. Skipping migration.");
  db.close();
  process.exit(0);
}

console.log("Migrating data from JSON to SQLite...");

const now = new Date().toISOString();
let migrated = 0;

// Users
const insertUser = db.prepare(
  "INSERT INTO users (email, password_hash, name, stripe_customer_id, subscription_status, subscription_end_date, scans_remaining, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);
for (const u of jsonDb.users || []) {
  insertUser.run(
    u.email, u.password_hash, u.name,
    u.stripe_customer_id || null,
    u.subscription_status || "none",
    u.subscription_end_date || null,
    u.scans_remaining ?? 10,
    u.created_at || now
  );
  migrated++;
}
console.log(`  Users: ${jsonDb.users?.length || 0}`);

// Sessions
const insertSession = db.prepare("INSERT INTO sessions (user_id, token, created_at) VALUES (?, ?, ?)");
for (const s of jsonDb.sessions || []) {
  insertSession.run(s.user_id, s.token, s.created_at || now);
}
console.log(`  Sessions: ${jsonDb.sessions?.length || 0}`);

// Sensitivities
const insertSens = db.prepare("INSERT INTO sensitivities (user_id, ingredient_name, category, severity, created_at) VALUES (?, ?, ?, ?, ?)");
for (const s of jsonDb.sensitivities || []) {
  insertSens.run(s.user_id, s.ingredient_name, s.category, s.severity, s.created_at || now);
}
console.log(`  Sensitivities: ${jsonDb.sensitivities?.length || 0}`);

// Scan History
const insertScan = db.prepare("INSERT INTO scan_history (user_id, product_barcode, product_name, product_image, match_found, matched_ingredients, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
for (const s of jsonDb.scan_history || []) {
  insertScan.run(s.user_id, s.product_barcode, s.product_name || null, s.product_image || null, s.match_found, s.matched_ingredients || "[]", s.scanned_at || now);
}
console.log(`  Scan history: ${jsonDb.scan_history?.length || 0}`);

// Meal Templates
const insertTemplate = db.prepare("INSERT INTO meal_templates (name, meal_type, ingredients, recipe_url, calories, image_url) VALUES (?, ?, ?, ?, ?, ?)");
for (const t of jsonDb.meal_templates || []) {
  insertTemplate.run(t.name, t.meal_type, t.ingredients || "[]", t.recipe_url || null, t.calories || null, t.image_url || null);
}
console.log(`  Meal templates: ${jsonDb.meal_templates?.length || 0}`);

// Meal Plans
const insertPlan = db.prepare("INSERT INTO meal_plans (user_id, date, meal_type, meal_template_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)");
for (const p of jsonDb.meal_plans || []) {
  insertPlan.run(p.user_id, p.date, p.meal_type, p.meal_template_id, p.notes || null, p.created_at || now);
}
console.log(`  Meal plans: ${jsonDb.meal_plans?.length || 0}`);

// Reactions
const insertReaction = db.prepare("INSERT INTO reactions (user_id, date, category, meal_type, description, severity, ingredients_raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
for (const r of jsonDb.reactions || []) {
  insertReaction.run(r.user_id, r.date, r.category, r.meal_type || null, r.description, r.severity, r.ingredients_raw || "[]", r.created_at || now);
}
console.log(`  Reactions: ${jsonDb.reactions?.length || 0}`);

// Discovered Sensitivities
const insertDisc = db.prepare("INSERT INTO discovered_sensitivities (user_id, ingredient_name, category, confidence_score, occurrence_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
for (const d of jsonDb.discovered_sensitivities || []) {
  insertDisc.run(d.user_id, d.ingredient_name, d.category, d.confidence_score, d.occurrence_count, d.status, d.created_at || now);
}
console.log(`  Discovered sensitivities: ${jsonDb.discovered_sensitivities?.length || 0}`);

// Ads
const insertAd = db.prepare("INSERT INTO ads (company_name, headline, body_text, image_url, link_url, placement, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
for (const a of jsonDb.ads || []) {
  insertAd.run(a.company_name, a.headline, a.body_text, a.image_url || null, a.link_url, a.placement, a.active ? 1 : 0, a.created_at || now);
}
console.log(`  Ads: ${jsonDb.ads?.length || 0}`);

// Ad Events
const insertAdEvent = db.prepare("INSERT INTO ad_events (ad_id, event_type, created_at) VALUES (?, ?, ?)");
for (const e of jsonDb.ad_events || []) {
  insertAdEvent.run(e.ad_id, e.event_type, e.created_at || now);
}
console.log(`  Ad events: ${jsonDb.ad_events?.length || 0}`);

// Password Reset Tokens
const insertToken = db.prepare("INSERT INTO password_reset_tokens (user_id, token, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?)");
for (const t of jsonDb.password_reset_tokens || []) {
  insertToken.run(t.user_id, t.token, t.expires_at, t.used ? 1 : 0, t.created_at || now);
}
console.log(`  Password reset tokens: ${jsonDb.password_reset_tokens?.length || 0}`);

// Email Logs
const insertEmail = db.prepare("INSERT INTO email_logs (user_id, email_type, to_address, subject, sent_at) VALUES (?, ?, ?, ?, ?)");
for (const e of jsonDb.email_logs || []) {
  insertEmail.run(e.user_id, e.email_type, e.to_address, e.subject, e.sent_at || now);
}
console.log(`  Email logs: ${jsonDb.email_logs?.length || 0}`);

console.log(`\nMigration complete! ${migrated} users migrated.`);
db.close();
