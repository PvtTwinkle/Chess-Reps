/**
 * Migration smoke test for CI.
 *
 * This script creates a fresh PostgreSQL database connection and applies every
 * migration file in drizzle/migrations/ to it. If any migration fails —
 * because of a SQL syntax error, a bad constraint, a missing column, or
 * anything else — this script exits with code 1, causing the CI job to fail.
 *
 * Requires a running PostgreSQL instance. In CI this is provided by a GitHub
 * Actions service container. Locally you can point DATABASE_URL at any
 * throwaway PostgreSQL database.
 *
 * This is a plain .mjs file (JavaScript, not TypeScript) so Node.js can run it
 * directly without a build step.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
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

// Connect to PostgreSQL. In CI this comes from the service container.
// Locally you can set DATABASE_URL to point at any test database.
const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://chess_reps:chess_reps@localhost:5432/chess_reps';

const sql = postgres(DATABASE_URL);
const db = drizzle(sql);

try {
	// Run all migrations. This is the same call the app makes at startup in
	// src/lib/db/index.ts — so if it passes here, it will pass in production.
	await migrate(db, { migrationsFolder });

	console.log('✓ All migrations applied successfully.');
} catch (err) {
	console.error('✗ Migration failed:', err);
	process.exit(1);
} finally {
	// Close the connection cleanly so the process can exit.
	await sql.end();
}
