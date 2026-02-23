/**
 * Migration smoke test for CI.
 *
 * This script creates a fresh in-memory SQLite database and applies every
 * migration file in drizzle/migrations/ to it. If any migration fails —
 * because of a SQL syntax error, a bad constraint, a missing column, or
 * anything else — this script exits with code 1, causing the CI job to fail.
 *
 * Uses :memory: as the database path. SQLite treats this as a signal to create
 * a temporary database that lives only in RAM and vanishes when the process ends.
 * Nothing is written to disk.
 *
 * This is a plain .mjs file (JavaScript, not TypeScript) so Node.js can run it
 * directly without a build step. It imports from node_modules just like the app
 * does at runtime.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// __dirname is not available in ES modules (.mjs files), so we derive it from
// import.meta.url — the URL of the currently executing file.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the drizzle/migrations/ folder, resolved relative to this script's
// location. join(__dirname, '..', 'drizzle', 'migrations') means:
//   start at scripts/
//   go up one level to the project root
//   then down into drizzle/migrations/
const migrationsFolder = join(__dirname, '..', 'drizzle', 'migrations');

// Create a fresh in-memory SQLite database. Nothing on disk is touched.
const sqlite = new Database(':memory:');

// Create a Drizzle client wrapping the in-memory database.
const db = drizzle(sqlite);

// Run all migrations. This is the same call the app makes at startup in
// src/lib/db/index.ts — so if it passes here, it will pass in production.
migrate(db, { migrationsFolder });

console.log('✓ All migrations applied successfully.');

// Close the database connection cleanly.
sqlite.close();
