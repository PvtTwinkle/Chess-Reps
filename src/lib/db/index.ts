// Database connection singleton.
//
// This file does four things when the app first starts:
//   1. Opens (or creates) the SQLite database file on disk
//   2. Runs any pending migrations — creates all tables on first run,
//      applies only new migrations on subsequent runs
//   3. Creates a default user if no user exists yet
//   4. Exports the `db` object that every other file uses to query the database
//
// Because this is a module, Node.js runs it exactly once and caches the result.
// Every file that imports `db` gets the same shared connection — no reconnecting.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { count } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';
import { user } from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration via environment variables
//
// Environment variables are values injected into the running process from
// outside — from your shell, a .env file, or docker-compose.yml.
// The app reads them with process.env.VARIABLE_NAME.
// The ?? operator means "use this default if the variable is not set".
//
// DATABASE_URL:    Path to the SQLite file.
//                 Development default: ./data/db.sqlite (relative to project root)
//                 Docker: set to /app/data/db.sqlite in docker-compose.yml
//
// DEFAULT_USERNAME: Username for the automatically created first user.
//                 Default: "admin"
//
// DEFAULT_PASSWORD: Password for the automatically created first user.
//                 Default: "password"
//                 IMPORTANT: Change this in production via docker-compose.yml.
// ─────────────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? './data/db.sqlite';

// Ensure the directory that will hold the database file exists.
// path.dirname('./data/db.sqlite') returns './data'.
// The { recursive: true } option means: create all parent directories if needed,
// and do nothing if the directory already exists (safe to call every time).
fs.mkdirSync(path.dirname(path.resolve(DATABASE_URL)), { recursive: true });

// Open (or create) the SQLite file. If the file does not exist, SQLite creates it.
const sqlite = new Database(DATABASE_URL);

// WAL = Write-Ahead Logging. A SQLite setting that improves performance for
// web apps: reads and writes can happen at the same time without blocking each other.
sqlite.pragma('journal_mode = WAL');

// SQLite does not enforce foreign key constraints by default. Turn it on so that,
// for example, inserting a user_move with a non-existent repertoire_id fails loudly
// rather than silently inserting bad data.
sqlite.pragma('foreign_keys = ON');

// Create the Drizzle db instance. The schema argument enables type-safe relational
// queries — Drizzle knows the shape of every table.
export const db = drizzle(sqlite, { schema });

// ─────────────────────────────────────────────────────────────────────────────
// Run migrations
//
// migrate() checks which migration files in drizzle/migrations/ have already
// been applied (it tracks this in a __drizzle_migrations table it manages itself)
// and runs only the ones that have not run yet.
//
// On first run:  applies 0000_initial_schema.sql → creates all tables
// On later runs: does nothing if schema is already up to date
// After upgrade: applies only the new migration files added in the new release
// ─────────────────────────────────────────────────────────────────────────────

migrate(db, {
	migrationsFolder: path.join(process.cwd(), 'drizzle', 'migrations')
});

// ─────────────────────────────────────────────────────────────────────────────
// Default user creation
//
// On the very first run, no users exist. We create one automatically so the
// app is immediately accessible without a separate setup step.
//
// The username and password come from environment variables. In docker-compose.yml:
//
//   environment:
//     - DEFAULT_USERNAME=admin
//     - DEFAULT_PASSWORD=changeme
//
// Or in a .env file in the same directory as your docker-compose.yml:
//
//   DEFAULT_USERNAME=admin
//   DEFAULT_PASSWORD=changeme
//
// If neither is set, sensible development defaults are used.
// On subsequent startups, users already exist, so this block is skipped entirely.
// ─────────────────────────────────────────────────────────────────────────────

const existingUserCount = db.select({ count: count() }).from(user).get();

if (existingUserCount && existingUserCount.count === 0) {
	const username = process.env.DEFAULT_USERNAME ?? 'admin';
	const password = process.env.DEFAULT_PASSWORD ?? 'changeme';

	// Hash the password before storing it.
	// A hash is a one-way mathematical transformation — given the hash, you cannot
	// reverse it to get the original password. When the user logs in, we hash what
	// they typed and compare the two hashes. The plain text password is never stored.
	//
	// The number 10 is the "cost factor" — it controls how many times the hashing
	// algorithm loops. Higher = slower to compute = harder for an attacker to brute-force.
	// 10 is the standard default: fast enough that login feels instant, slow enough
	// to make bulk guessing impractical.
	const passwordHash = bcrypt.hashSync(password, 10);

	db.insert(user)
		.values({
			username,
			passwordHash,
			createdAt: new Date()
		})
		.run();

	console.log(`[chess-reps] Default user "${username}" created on first run.`);
	console.log(
		'[chess-reps] Set DEFAULT_USERNAME and DEFAULT_PASSWORD environment variables to customise this.'
	);
}
